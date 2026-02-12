/**
 * High-level AIP client that orchestrates the full integrity check lifecycle.
 *
 * Validates card-conscience agreement at creation time, then provides
 * a simple `check(responseBody)` method that extracts thinking blocks,
 * calls the analysis LLM, creates checkpoints, detects drift, and
 * delivers signals.
 */

import type { AIPConfig } from "../schemas/config.js";
import type { IntegritySignal } from "../schemas/signal.js";
import { WindowManager } from "../window/manager.js";
import type { WindowState } from "../window/state.js";
import { createAdapterRegistry } from "../adapters/index.js";
import { validateAgreement } from "../analysis/agreement.js";
import { buildConsciencePrompt } from "../analysis/prompt.js";
import { checkIntegrity, buildSignal, hashThinkingBlock } from "../analysis/engine.js";
import { detectIntegrityDrift, createDriftState } from "../analysis/drift.js";
import type { DriftState } from "../analysis/drift.js";
import {
  DEFAULT_ANALYSIS_TIMEOUT_MS,
} from "../constants.js";

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

/** Public AIP client interface */
export interface AIPClient {
  /** Perform an integrity check on a provider response body */
  check(responseBody: string, provider?: string): Promise<IntegritySignal>;
  /** Get current window state */
  getWindowState(): WindowState;
  /** Reset the session window */
  resetWindow(): void;
  /** Clean up resources */
  destroy(): void;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create an AIP client instance.
 *
 * Validates card-conscience agreement at creation time.
 * Throws if agreement has conflicts.
 */
export function createClient(config: AIPConfig): AIPClient {
  // 1. Validate card-conscience agreement
  const conscienceValues = config.conscience_values ?? [];
  const agreement = validateAgreement(config.card, conscienceValues);
  if (!agreement.valid) {
    const conflictDescs = agreement.conflicts.map((c) => c.description).join("; ");
    throw new Error(`Card-conscience agreement validation failed: ${conflictDescs}`);
  }

  // 2. Initialize components
  const sessionId = generateSessionId(config.card.card_id);
  const window = new WindowManager(config.window, sessionId);
  const registry = createAdapterRegistry();
  let driftState: DriftState = createDriftState();
  let destroyed = false;

  // 3. Resolve failure policy
  const failureMode = config.failure_policy?.mode ?? "fail_open";
  const analysisTimeout =
    config.failure_policy?.analysis_timeout_ms ?? DEFAULT_ANALYSIS_TIMEOUT_MS;

  return {
    async check(
      responseBody: string,
      provider?: string,
    ): Promise<IntegritySignal> {
      if (destroyed) throw new Error("AIP client has been destroyed");

      // 1. Extract thinking block
      const adapter = provider
        ? registry.get(provider)
        : registry.detectFromUrl(config.analysis_llm.base_url);

      // Try non-streaming JSON extraction first, then SSE stream extraction
      const thinking =
        adapter.extractThinking(responseBody) ??
        adapter.extractThinkingFromStream(responseBody);

      if (!thinking) {
        // No thinking block found — return synthetic clear signal.
        // This is normal for providers/responses without thinking.
        return buildSyntheticSignal(config, window, "clear");
      }

      // 2. Build conscience prompt
      const prompt = buildConsciencePrompt({
        card: config.card,
        conscienceValues,
        windowContext: window.getState().checkpoints,
        thinkingBlock: thinking.content,
      });

      // 3. Call analysis LLM
      const startTime = Date.now();
      let analysisResponseText: string;

      try {
        analysisResponseText = await callAnalysisLLM(
          config.analysis_llm,
          prompt.system,
          prompt.user,
          analysisTimeout,
        );
      } catch (error) {
        // Analysis failed — apply failure policy
        if (config.callbacks?.on_error) {
          await config.callbacks.on_error(
            error instanceof Error ? error : new Error(String(error)),
          );
        }

        if (failureMode === "fail_closed") {
          return buildSyntheticSignal(config, window, "boundary_violation");
        }
        // fail_open: return synthetic clear
        return buildSyntheticSignal(config, window, "clear");
      }

      const analysisDurationMs = Date.now() - startTime;

      // 4. Parse analysis and create checkpoint
      const thinkingHash = hashThinkingBlock(thinking.content);
      const windowState = window.getState();

      const checkpoint = checkIntegrity({
        analysisResponse: analysisResponseText,
        thinking: {
          hash: thinkingHash,
          provider: thinking.provider,
          model: thinking.model,
          tokensOriginal: prompt.originalTokens,
          tokensAnalyzed: prompt.analyzedTokens,
          truncated: prompt.truncated,
          confidence: thinking.confidence,
        },
        agentId: config.agent_id ?? config.card.card_id,
        cardId: config.card.card_id,
        sessionId: window.getSessionId(),
        windowPosition: {
          index: windowState.size,
          window_size: windowState.size + 1,
        },
        analysisModel: config.analysis_llm.model,
        analysisDurationMs,
      });

      // 5. Update window
      window.push(checkpoint);

      // 6. Detect drift
      const driftResult = detectIntegrityDrift(
        driftState,
        checkpoint,
        window.getState().checkpoints,
      );
      driftState = driftResult.state;

      // 7. Build signal
      const summary = window.getSummary();
      if (driftResult.alert) {
        summary.drift_alert_active = true;
      }
      const signal = buildSignal(checkpoint, summary);

      // 8. Invoke callbacks
      if (config.callbacks?.on_verdict) {
        await config.callbacks.on_verdict(signal);
      }
      if (driftResult.alert && config.callbacks?.on_drift_alert) {
        await config.callbacks.on_drift_alert(driftResult.alert);
      }

      return signal;
    },

    getWindowState(): WindowState {
      return window.getState();
    },

    resetWindow(): void {
      window.reset();
      driftState = createDriftState();
    },

    destroy(): void {
      destroyed = true;
    },
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function generateSessionId(cardId: string): string {
  const hash = cardId.slice(0, 8);
  const hourBucket = Math.floor(Date.now() / 3600000);
  return `sess-${hash}-${hourBucket}`;
}

/**
 * Call the analysis LLM with the conscience prompt.
 * This is the only network call in the SDK.
 */
async function callAnalysisLLM(
  llmConfig: AIPConfig["analysis_llm"],
  system: string,
  user: string,
  timeoutMs: number,
): Promise<string> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    // Use Anthropic Messages API format by default
    const response = await fetch(`${llmConfig.base_url}/v1/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": llmConfig.api_key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: llmConfig.model,
        max_tokens: llmConfig.max_tokens,
        system,
        messages: [{ role: "user", content: user }],
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(
        `Analysis LLM returned ${response.status}: ${await response.text()}`,
      );
    }

    const body = (await response.json()) as Record<string, unknown>;
    const content = body.content as
      | Array<Record<string, unknown>>
      | undefined;

    if (!content || content.length === 0) {
      throw new Error("Analysis LLM returned empty content");
    }

    // Extract text from first text block
    const textBlock = content.find((b) => b.type === "text");
    if (!textBlock || typeof textBlock.text !== "string") {
      throw new Error("Analysis LLM returned no text content");
    }

    return textBlock.text;
  } finally {
    clearTimeout(timeoutId);
  }
}

function buildSyntheticSignal(
  config: AIPConfig,
  window: WindowManager,
  verdict: "clear" | "boundary_violation",
): IntegritySignal {
  const summary = window.getSummary();

  return {
    checkpoint: {
      checkpoint_id: `ic-synthetic-${Date.now()}`,
      agent_id: config.agent_id ?? config.card.card_id,
      card_id: config.card.card_id,
      session_id: window.getSessionId(),
      timestamp: new Date().toISOString(),
      thinking_block_hash: "none",
      provider: "none",
      model: "none",
      verdict,
      concerns: [],
      reasoning_summary:
        verdict === "clear"
          ? "No thinking block found or analysis unavailable (fail-open)"
          : "Analysis failed and failure policy is fail-closed",
      conscience_context: {
        values_checked: [],
        conflicts: [],
        supports: [],
        considerations: [],
        consultation_depth: "surface",
      },
      window_position: {
        index: summary.size,
        window_size: summary.size,
      },
      analysis_metadata: {
        analysis_model: "none",
        analysis_duration_ms: 0,
        thinking_tokens_original: 0,
        thinking_tokens_analyzed: 0,
        truncated: false,
        extraction_confidence: 0,
      },
      linked_trace_id: null,
    },
    proceed: verdict === "clear",
    recommended_action:
      verdict === "clear" ? "continue" : "deny_and_escalate",
    window_summary: summary,
  };
}
