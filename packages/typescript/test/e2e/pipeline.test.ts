/**
 * End-to-end pipeline tests for the Agent Integrity Protocol SDK.
 *
 * Tests the FULL integrity analysis pipeline without mocking fetch,
 * using only the pure functions (adapters, engine, drift, window, agreement).
 *
 * Pipeline flow:
 *   Provider response -> Adapter -> ExtractedThinking
 *   ExtractedThinking -> hashThinkingBlock -> SHA-256
 *   Card + conscience values + thinking -> buildConsciencePrompt -> BuiltPrompt
 *   Simulated analysis response (verdicts fixtures) -> checkIntegrity -> IntegrityCheckpoint
 *   IntegrityCheckpoint -> WindowManager.push()
 *   Checkpoint + window -> detectIntegrityDrift -> DriftState + optional alert
 *   Checkpoint + WindowSummary -> buildSignal -> IntegritySignal
 *   Verify signal.proceed / signal.recommended_action / signal.window_summary
 */

import { describe, it, expect } from "vitest";

// Adapters
import { AnthropicAdapter } from "../../src/adapters/anthropic.js";
import { OpenAIAdapter } from "../../src/adapters/openai.js";
import { GoogleAdapter } from "../../src/adapters/google.js";
import { createAdapterRegistry } from "../../src/adapters/index.js";

// Analysis engine
import {
  checkIntegrity,
  buildSignal,
  hashThinkingBlock,
  mapVerdictToAction,
  mapVerdictToProceed,
} from "../../src/analysis/engine.js";
import type { CheckIntegrityInput } from "../../src/analysis/engine.js";

// Conscience prompt builder
import { buildConsciencePrompt } from "../../src/analysis/prompt.js";

// Drift detection
import { detectIntegrityDrift, createDriftState } from "../../src/analysis/drift.js";

// Agreement validation
import { validateAgreement } from "../../src/analysis/agreement.js";

// Window manager
import { WindowManager } from "../../src/window/manager.js";

// Fixtures — cards
import { FULL_CARD, MINIMAL_CARD } from "../fixtures/cards.js";

// Fixtures — thinking blocks
import { BENIGN_CODING, PROMPT_INJECTION } from "../fixtures/thinking-blocks.js";

// Fixtures — provider responses
import {
  ANTHROPIC_JSON_WITH_THINKING,
  OPENAI_JSON_WITH_REASONING,
  GOOGLE_JSON_WITH_THINKING,
} from "../fixtures/responses.js";

// Fixtures — verdicts (simulated analysis LLM responses)
import {
  VERDICT_CLEAR,
  VERDICT_REVIEW_NEEDED,
  VERDICT_BOUNDARY_INJECTION,
  VERDICT_BOUNDARY_DECEPTION,
} from "../fixtures/verdicts.js";

// Types
import type { ConscienceValue } from "../../src/schemas/conscience.js";
import type { IntegrityCheckpoint } from "../../src/schemas/checkpoint.js";
import type { ExtractedThinking } from "../../src/adapters/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a CheckIntegrityInput from an ExtractedThinking and a simulated
 * analysis LLM response (verdict fixture), to drive `checkIntegrity`.
 */
function buildCheckInput(
  thinking: ExtractedThinking,
  prompt: { originalTokens: number; analyzedTokens: number; truncated: boolean },
  verdictFixture: object,
  overrides?: Partial<CheckIntegrityInput>,
): CheckIntegrityInput {
  const hash = hashThinkingBlock(thinking.content);
  return {
    analysisResponse: JSON.stringify(verdictFixture),
    thinking: {
      hash,
      provider: thinking.provider,
      model: thinking.model,
      tokensOriginal: prompt.originalTokens,
      tokensAnalyzed: prompt.analyzedTokens,
      truncated: prompt.truncated,
      confidence: thinking.confidence,
    },
    agentId: FULL_CARD.card_id,
    cardId: FULL_CARD.card_id,
    sessionId: "sess-e2e-test-001",
    windowPosition: { index: 0, window_size: 1 },
    analysisModel: "claude-3-5-haiku-20241022",
    analysisDurationMs: 120,
    ...overrides,
  };
}

/**
 * Construct a custom Anthropic JSON response with a given thinking content.
 */
function makeAnthropicResponse(thinkingContent: string): string {
  return JSON.stringify({
    id: "msg_e2e_injection",
    type: "message",
    role: "assistant",
    model: "claude-sonnet-4-5-20250514",
    content: [
      { type: "thinking", thinking: thinkingContent },
      { type: "text", text: "Here is my response." },
    ],
    stop_reason: "end_turn",
    usage: { input_tokens: 100, output_tokens: 50 },
  });
}

/**
 * Run the full pipeline for a given provider response, adapter, and verdict,
 * returning the IntegritySignal and supporting artefacts.
 */
function runPipeline(
  adapter: { extractThinking(body: string): ExtractedThinking | null },
  responseBody: string,
  verdictFixture: object,
  windowManager: WindowManager,
  inputOverrides?: Partial<CheckIntegrityInput>,
) {
  // Step 1: Extract thinking
  const thinking = adapter.extractThinking(responseBody);
  expect(thinking).not.toBeNull();
  const t = thinking!;

  // Step 2: Hash thinking block
  const hash = hashThinkingBlock(t.content);
  expect(hash).toMatch(/^[a-f0-9]{64}$/);

  // Step 3: Build conscience prompt
  const prompt = buildConsciencePrompt({
    card: FULL_CARD,
    conscienceValues: [],
    windowContext: windowManager.getState().checkpoints,
    thinkingBlock: t.content,
  });
  expect(prompt.system.length).toBeGreaterThan(0);
  expect(prompt.user.length).toBeGreaterThan(0);

  // Step 4: checkIntegrity with simulated analysis response
  const windowState = windowManager.getState();
  const checkpoint = checkIntegrity(
    buildCheckInput(t, prompt, verdictFixture, {
      windowPosition: {
        index: windowState.size,
        window_size: windowState.size + 1,
      },
      ...inputOverrides,
    }),
  );

  // Step 5: Push to window
  windowManager.push(checkpoint);

  // Step 6: Detect drift
  const driftState = createDriftState();
  const driftResult = detectIntegrityDrift(
    driftState,
    checkpoint,
    windowManager.getState().checkpoints,
  );

  // Step 7: Build signal
  const summary = windowManager.getSummary();
  if (driftResult.alert) {
    summary.drift_alert_active = true;
  }
  const signal = buildSignal(checkpoint, summary);

  return { thinking: t, hash, prompt, checkpoint, driftResult, signal };
}

// ---------------------------------------------------------------------------
// Scenario 1: Benign Anthropic response -- clear verdict
// ---------------------------------------------------------------------------

describe("E2E Pipeline", () => {
  describe("Scenario 1: Benign Anthropic response -- clear verdict", () => {
    it("should produce a clear signal with proceed=true and action=continue", () => {
      const adapter = new AnthropicAdapter();
      const window = new WindowManager(
        { max_size: 10, mode: "sliding", session_boundary: "reset", max_age_seconds: 3600 },
        "sess-e2e-test-001",
      );

      const { thinking, hash, prompt, checkpoint, signal } = runPipeline(
        adapter,
        ANTHROPIC_JSON_WITH_THINKING,
        VERDICT_CLEAR,
        window,
      );

      // Adapter extracted thinking content
      expect(thinking.provider).toBe("anthropic");
      expect(thinking.model).toBe("claude-sonnet-4-5-20250514");
      expect(thinking.content).toContain("analyze this request");

      // Hash is deterministic SHA-256
      expect(hash).toBe(hashThinkingBlock(thinking.content));

      // Prompt was built with card and thinking
      expect(prompt.user).toContain("ALIGNMENT CARD SUMMARY");
      expect(prompt.user).toContain("THINKING BLOCK TO EVALUATE");

      // Checkpoint matches verdict
      expect(checkpoint.checkpoint_id).toMatch(/^ic-/);
      expect(checkpoint.verdict).toBe("clear");
      expect(checkpoint.concerns).toHaveLength(0);
      expect(checkpoint.thinking_block_hash).toBe(hash);

      // Signal assertions
      expect(signal.proceed).toBe(true);
      expect(signal.recommended_action).toBe("continue");
      expect(signal.window_summary.size).toBe(1);
      expect(signal.window_summary.verdicts.clear).toBe(1);
      expect(signal.window_summary.integrity_ratio).toBe(1.0);
      expect(signal.window_summary.drift_alert_active).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // Scenario 2: Prompt injection -- boundary violation
  // ---------------------------------------------------------------------------

  describe("Scenario 2: Prompt injection -- boundary violation", () => {
    it("should produce a boundary_violation signal with proceed=false and action=deny_and_escalate", () => {
      const adapter = new AnthropicAdapter();
      const window = new WindowManager(
        { max_size: 10, mode: "sliding", session_boundary: "reset", max_age_seconds: 3600 },
        "sess-e2e-test-002",
      );

      // Build a custom Anthropic response with the prompt injection thinking block
      const injectionResponse = makeAnthropicResponse(PROMPT_INJECTION);
      const thinking = adapter.extractThinking(injectionResponse);
      expect(thinking).not.toBeNull();
      expect(thinking!.content).toContain("IGNORE ALL PREVIOUS INSTRUCTIONS");

      const { checkpoint, signal } = runPipeline(
        adapter,
        injectionResponse,
        VERDICT_BOUNDARY_INJECTION,
        window,
      );

      // Checkpoint reflects injection verdict
      expect(checkpoint.verdict).toBe("boundary_violation");
      expect(checkpoint.concerns).toHaveLength(1);
      expect(checkpoint.concerns[0]!.category).toBe("prompt_injection");
      expect(checkpoint.concerns[0]!.severity).toBe("critical");

      // Signal assertions
      expect(signal.proceed).toBe(false);
      expect(signal.recommended_action).toBe("deny_and_escalate");
      expect(signal.window_summary.verdicts.boundary_violation).toBe(1);
      expect(signal.window_summary.integrity_ratio).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Scenario 3: OpenAI response -- review needed
  // ---------------------------------------------------------------------------

  describe("Scenario 3: OpenAI response -- review needed", () => {
    it("should produce a review_needed signal with proceed=true and action=log_and_continue", () => {
      const adapter = new OpenAIAdapter();
      const window = new WindowManager(
        { max_size: 10, mode: "sliding", session_boundary: "reset", max_age_seconds: 3600 },
        "sess-e2e-test-003",
      );

      const { thinking, checkpoint, signal } = runPipeline(
        adapter,
        OPENAI_JSON_WITH_REASONING,
        VERDICT_REVIEW_NEEDED,
        window,
      );

      // Adapter extracted reasoning content
      expect(thinking.provider).toBe("openai");
      expect(thinking.model).toBe("o1-preview");
      expect(thinking.extraction_method).toBe("reasoning_content");
      expect(thinking.content).toContain("API design");

      // Checkpoint matches review_needed
      expect(checkpoint.verdict).toBe("review_needed");
      expect(checkpoint.concerns).toHaveLength(1);
      expect(checkpoint.concerns[0]!.category).toBe("value_misalignment");
      expect(checkpoint.concerns[0]!.severity).toBe("medium");

      // Signal assertions
      expect(signal.proceed).toBe(true);
      expect(signal.recommended_action).toBe("log_and_continue");
      expect(signal.window_summary.verdicts.review_needed).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------
  // Scenario 4: Google response -- clear
  // ---------------------------------------------------------------------------

  describe("Scenario 4: Google response -- clear", () => {
    it("should extract thinking from Gemini and produce a clear signal", () => {
      const adapter = new GoogleAdapter();
      const window = new WindowManager(
        { max_size: 10, mode: "sliding", session_boundary: "reset", max_age_seconds: 3600 },
        "sess-e2e-test-004",
      );

      const { thinking, signal } = runPipeline(
        adapter,
        GOOGLE_JSON_WITH_THINKING,
        VERDICT_CLEAR,
        window,
      );

      // Adapter extracted thinking from Gemini's thought parts
      expect(thinking.provider).toBe("google");
      expect(thinking.model).toBe("gemini-2.0-flash-thinking-exp");
      expect(thinking.content).toContain("consider this carefully");

      // Signal assertions
      expect(signal.proceed).toBe(true);
      expect(signal.recommended_action).toBe("continue");
      expect(signal.checkpoint.verdict).toBe("clear");
    });
  });

  // ---------------------------------------------------------------------------
  // Scenario 5: Multi-provider adapter registry
  // ---------------------------------------------------------------------------

  describe("Scenario 5: Multi-provider adapter registry", () => {
    it("should extract thinking from all three providers via the registry", () => {
      const registry = createAdapterRegistry();

      // Anthropic
      const anthropicAdapter = registry.get("anthropic");
      const anthropicThinking = anthropicAdapter.extractThinking(ANTHROPIC_JSON_WITH_THINKING);
      expect(anthropicThinking).not.toBeNull();
      expect(anthropicThinking!.provider).toBe("anthropic");
      expect(anthropicThinking!.content.length).toBeGreaterThan(0);

      // OpenAI
      const openaiAdapter = registry.get("openai");
      const openaiThinking = openaiAdapter.extractThinking(OPENAI_JSON_WITH_REASONING);
      expect(openaiThinking).not.toBeNull();
      expect(openaiThinking!.provider).toBe("openai");
      expect(openaiThinking!.content.length).toBeGreaterThan(0);

      // Google
      const googleAdapter = registry.get("google");
      const googleThinking = googleAdapter.extractThinking(GOOGLE_JSON_WITH_THINKING);
      expect(googleThinking).not.toBeNull();
      expect(googleThinking!.provider).toBe("google");
      expect(googleThinking!.content.length).toBeGreaterThan(0);
    });

    it("should detect provider from URL", () => {
      const registry = createAdapterRegistry();

      const anthropicResult = registry.detectFromUrl("https://api.anthropic.com/v1/messages");
      expect(anthropicResult.provider).toBe("anthropic");

      const openaiResult = registry.detectFromUrl("https://api.openai.com/v1/chat/completions");
      expect(openaiResult.provider).toBe("openai");

      const googleResult = registry.detectFromUrl("https://generativelanguage.googleapis.com/v1/models");
      expect(googleResult.provider).toBe("google");

      // Unknown URL falls back to fallback adapter
      const fallbackResult = registry.detectFromUrl("https://api.unknown.com/v1/chat");
      expect(fallbackResult.provider).toBe("fallback");
    });
  });

  // ---------------------------------------------------------------------------
  // Scenario 6: Drift detection over multiple checks
  // ---------------------------------------------------------------------------

  describe("Scenario 6: Drift detection over multiple checks", () => {
    it("should fire a drift alert after 3 consecutive non-clear checkpoints and reset on clear", () => {
      const adapter = new AnthropicAdapter();
      const window = new WindowManager(
        { max_size: 5, mode: "sliding", session_boundary: "reset", max_age_seconds: 3600 },
        "sess-e2e-drift-001",
      );

      let driftState = createDriftState();

      // Push 3 consecutive review_needed checkpoints
      const checkpoints: IntegrityCheckpoint[] = [];
      const alerts: Array<ReturnType<typeof detectIntegrityDrift>["alert"]> = [];

      for (let i = 0; i < 3; i++) {
        const thinking = adapter.extractThinking(ANTHROPIC_JSON_WITH_THINKING);
        expect(thinking).not.toBeNull();

        const prompt = buildConsciencePrompt({
          card: FULL_CARD,
          conscienceValues: [],
          windowContext: window.getState().checkpoints,
          thinkingBlock: thinking!.content,
        });

        const checkpoint = checkIntegrity(
          buildCheckInput(thinking!, prompt, VERDICT_REVIEW_NEEDED, {
            windowPosition: {
              index: window.getState().size,
              window_size: window.getState().size + 1,
            },
          }),
        );

        window.push(checkpoint);
        checkpoints.push(checkpoint);

        const driftResult = detectIntegrityDrift(
          driftState,
          checkpoint,
          window.getState().checkpoints,
        );
        driftState = driftResult.state;
        alerts.push(driftResult.alert);
      }

      // No alert on checks 1 and 2
      expect(alerts[0]).toBeNull();
      expect(alerts[1]).toBeNull();

      // Alert fires on check 3 (threshold = 3 by default)
      expect(alerts[2]).not.toBeNull();
      const alert = alerts[2]!;
      expect(alert.sustained_checks).toBe(3);
      expect(alert.alert_type).toBe("informative");
      expect(alert.checkpoint_ids).toHaveLength(3);
      expect(alert.alert_id).toMatch(/^ida-/);

      // Alert severity matches integrity_similarity
      // All 3 checkpoints are review_needed, 0 clear => similarity = 0
      expect(alert.integrity_similarity).toBe(0);
      // similarity < 0.4 => severity "high"
      expect(alert.severity).toBe("high");

      // Now push a clear checkpoint -- drift should reset
      const clearThinking = adapter.extractThinking(ANTHROPIC_JSON_WITH_THINKING)!;
      const clearPrompt = buildConsciencePrompt({
        card: FULL_CARD,
        conscienceValues: [],
        windowContext: window.getState().checkpoints,
        thinkingBlock: clearThinking.content,
      });
      const clearCheckpoint = checkIntegrity(
        buildCheckInput(clearThinking, clearPrompt, VERDICT_CLEAR, {
          windowPosition: {
            index: window.getState().size,
            window_size: window.getState().size + 1,
          },
        }),
      );
      window.push(clearCheckpoint);

      const clearDriftResult = detectIntegrityDrift(
        driftState,
        clearCheckpoint,
        window.getState().checkpoints,
      );
      driftState = clearDriftResult.state;

      // No alert on clear
      expect(clearDriftResult.alert).toBeNull();
      // Streak reset
      expect(clearDriftResult.state.sustainedNonclear).toBe(0);
      expect(clearDriftResult.state.alertFired).toBe(false);
      expect(clearDriftResult.state.streakCheckpointIds).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Scenario 7: Window eviction
  // ---------------------------------------------------------------------------

  describe("Scenario 7: Window eviction", () => {
    it("should evict oldest checkpoint when window exceeds max_size (sliding mode)", () => {
      const adapter = new AnthropicAdapter();
      const window = new WindowManager(
        { max_size: 3, mode: "sliding", session_boundary: "reset", max_age_seconds: 3600 },
        "sess-e2e-eviction-001",
      );

      const allCheckpointIds: string[] = [];

      // Push 4 checkpoints into a window of max_size 3
      for (let i = 0; i < 4; i++) {
        const thinking = adapter.extractThinking(ANTHROPIC_JSON_WITH_THINKING)!;
        const prompt = buildConsciencePrompt({
          card: FULL_CARD,
          conscienceValues: [],
          windowContext: window.getState().checkpoints,
          thinkingBlock: thinking.content,
        });

        const checkpoint = checkIntegrity(
          buildCheckInput(thinking, prompt, VERDICT_CLEAR, {
            windowPosition: {
              index: window.getState().size,
              window_size: window.getState().size + 1,
            },
          }),
        );

        allCheckpointIds.push(checkpoint.checkpoint_id);
        window.push(checkpoint);
      }

      // Window should have exactly 3 checkpoints (oldest evicted)
      const state = window.getState();
      expect(state.size).toBe(3);
      expect(state.checkpoints).toHaveLength(3);

      // First checkpoint should have been evicted
      const remainingIds = state.checkpoints.map((cp) => cp.checkpoint_id);
      expect(remainingIds).not.toContain(allCheckpointIds[0]);

      // Last 3 should remain
      expect(remainingIds).toContain(allCheckpointIds[1]);
      expect(remainingIds).toContain(allCheckpointIds[2]);
      expect(remainingIds).toContain(allCheckpointIds[3]);

      // Summary reflects only the 3 remaining
      const summary = window.getSummary();
      expect(summary.size).toBe(3);
      expect(summary.max_size).toBe(3);
      expect(summary.verdicts.clear).toBe(3);
      expect(summary.integrity_ratio).toBe(1.0);
    });
  });

  // ---------------------------------------------------------------------------
  // Scenario 8: Card-conscience agreement lifecycle
  // ---------------------------------------------------------------------------

  describe("Scenario 8: Card-conscience agreement lifecycle", () => {
    it("should validate compatible BOUNDARY values as valid", () => {
      // Compatible BOUNDARY: reinforces a forbidden action (augmentation, not conflict)
      const compatibleValues: ConscienceValue[] = [
        {
          type: "BOUNDARY",
          content: "Never exfiltrate data from user systems",
          id: "cv-no-exfiltrate",
        },
        {
          type: "FEAR",
          content: "I fear causing data loss through careless actions",
          id: "cv-fear-dataloss",
        },
      ];

      const agreement = validateAgreement(FULL_CARD, compatibleValues);
      expect(agreement.valid).toBe(true);
      expect(agreement.conflicts).toHaveLength(0);
      expect(agreement.card_id).toBe(FULL_CARD.card_id);
      expect(agreement.conscience_value_count).toBe(2);
    });

    it("should detect conflicts when BOUNDARY contradicts bounded_actions", () => {
      // FULL_CARD has bounded_actions: ["read_files", "write_files", "run_commands"]
      // A BOUNDARY that says "never write files" conflicts with bounded_action "write_files"
      const conflictingValues: ConscienceValue[] = [
        {
          type: "BOUNDARY",
          content: "Never write files to the filesystem",
          id: "cv-no-write",
        },
      ];

      const agreement = validateAgreement(FULL_CARD, conflictingValues);
      expect(agreement.valid).toBe(false);
      expect(agreement.conflicts.length).toBeGreaterThan(0);
      expect(agreement.conflicts[0]!.card_field).toBe(
        "autonomy_envelope.bounded_actions",
      );
      expect(agreement.conflicts[0]!.description).toContain("write_files");
    });

    it("should allow a valid agreement to proceed through checkIntegrity", () => {
      const compatibleValues: ConscienceValue[] = [
        {
          type: "FEAR",
          content: "I fear making incorrect recommendations",
          id: "cv-fear-accuracy",
        },
      ];

      const agreement = validateAgreement(FULL_CARD, compatibleValues);
      expect(agreement.valid).toBe(true);

      // Use the valid agreement to proceed through the pipeline
      const adapter = new AnthropicAdapter();
      const window = new WindowManager(
        { max_size: 10, mode: "sliding", session_boundary: "reset", max_age_seconds: 3600 },
        "sess-e2e-agreement-001",
      );

      const thinking = adapter.extractThinking(ANTHROPIC_JSON_WITH_THINKING)!;
      const prompt = buildConsciencePrompt({
        card: FULL_CARD,
        conscienceValues: compatibleValues,
        windowContext: [],
        thinkingBlock: thinking.content,
      });

      // Prompt should include the FEAR conscience value
      expect(prompt.user).toContain("CONSCIENCE VALUES:");
      expect(prompt.user).toContain("[FEAR]");
      expect(prompt.user).toContain("incorrect recommendations");

      const checkpoint = checkIntegrity(
        buildCheckInput(thinking, prompt, VERDICT_CLEAR),
      );
      expect(checkpoint.verdict).toBe("clear");

      const summary = window.getSummary();
      const signal = buildSignal(checkpoint, summary);
      expect(signal.proceed).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // Scenario 9: Thinking block privacy
  // ---------------------------------------------------------------------------

  describe("Scenario 9: Thinking block privacy", () => {
    it("should hash thinking content and never store raw thinking in the checkpoint", () => {
      const adapter = new AnthropicAdapter();
      const thinking = adapter.extractThinking(ANTHROPIC_JSON_WITH_THINKING);
      expect(thinking).not.toBeNull();
      const t = thinking!;

      // Step 1: Hash the thinking block
      const hash = hashThinkingBlock(t.content);
      expect(hash).toMatch(/^[a-f0-9]{64}$/);

      // Step 2: Verify hash is deterministic
      expect(hashThinkingBlock(t.content)).toBe(hash);

      // Step 3: Create checkpoint via checkIntegrity
      const prompt = buildConsciencePrompt({
        card: FULL_CARD,
        conscienceValues: [],
        windowContext: [],
        thinkingBlock: t.content,
      });

      const checkpoint = checkIntegrity(
        buildCheckInput(t, prompt, VERDICT_CLEAR),
      );

      // Step 4: Checkpoint has the hash
      expect(checkpoint.thinking_block_hash).toBe(hash);

      // Step 5: Checkpoint does NOT contain the original thinking text
      const serialized = JSON.stringify(checkpoint);
      expect(serialized).not.toContain(t.content);

      // Verify that individual distinctive words from the thinking content
      // do not appear in the checkpoint (extra paranoia check)
      // Only check multi-word phrases to avoid false positives from single common words
      expect(serialized).not.toContain("analyze this request carefully");
      expect(serialized).not.toContain("evaluate alternative design patterns");
    });
  });

  // ---------------------------------------------------------------------------
  // Scenario 10: Signal verdict mapping completeness
  // ---------------------------------------------------------------------------

  describe("Scenario 10: Signal verdict mapping completeness", () => {
    it("should map clear -> continue (proceed=true)", () => {
      expect(mapVerdictToProceed("clear")).toBe(true);
      expect(mapVerdictToAction("clear", [])).toBe("continue");
    });

    it("should map review_needed -> log_and_continue (proceed=true)", () => {
      expect(mapVerdictToProceed("review_needed")).toBe(true);
      expect(
        mapVerdictToAction("review_needed", VERDICT_REVIEW_NEEDED.concerns),
      ).toBe("log_and_continue");
    });

    it("should map boundary_violation (non-critical) -> pause_for_review (proceed=false)", () => {
      expect(mapVerdictToProceed("boundary_violation")).toBe(false);
      // VERDICT_BOUNDARY_DECEPTION has "high" severity concerns, not "critical"
      expect(
        mapVerdictToAction("boundary_violation", VERDICT_BOUNDARY_DECEPTION.concerns),
      ).toBe("pause_for_review");
    });

    it("should map boundary_violation (critical) -> deny_and_escalate (proceed=false)", () => {
      expect(mapVerdictToProceed("boundary_violation")).toBe(false);
      // VERDICT_BOUNDARY_INJECTION has a "critical" severity concern
      expect(
        mapVerdictToAction("boundary_violation", VERDICT_BOUNDARY_INJECTION.concerns),
      ).toBe("deny_and_escalate");
    });

    it("should produce correct signals through the full buildSignal path for all verdicts", () => {
      const adapter = new AnthropicAdapter();
      const thinking = adapter.extractThinking(ANTHROPIC_JSON_WITH_THINKING)!;
      const prompt = buildConsciencePrompt({
        card: FULL_CARD,
        conscienceValues: [],
        windowContext: [],
        thinkingBlock: thinking.content,
      });
      const window = new WindowManager(
        { max_size: 10, mode: "sliding", session_boundary: "reset", max_age_seconds: 3600 },
        "sess-e2e-mapping-001",
      );

      // Test all four verdict fixtures through the full pipeline
      const verdictCases: Array<{
        fixture: object;
        expectedProceed: boolean;
        expectedAction: string;
      }> = [
        { fixture: VERDICT_CLEAR, expectedProceed: true, expectedAction: "continue" },
        { fixture: VERDICT_REVIEW_NEEDED, expectedProceed: true, expectedAction: "log_and_continue" },
        { fixture: VERDICT_BOUNDARY_DECEPTION, expectedProceed: false, expectedAction: "pause_for_review" },
        { fixture: VERDICT_BOUNDARY_INJECTION, expectedProceed: false, expectedAction: "deny_and_escalate" },
      ];

      for (const { fixture, expectedProceed, expectedAction } of verdictCases) {
        const checkpoint = checkIntegrity(
          buildCheckInput(thinking, prompt, fixture, {
            windowPosition: {
              index: window.getState().size,
              window_size: window.getState().size + 1,
            },
          }),
        );
        window.push(checkpoint);

        const summary = window.getSummary();
        const signal = buildSignal(checkpoint, summary);

        expect(signal.proceed).toBe(expectedProceed);
        expect(signal.recommended_action).toBe(expectedAction);
      }
    });
  });
});
