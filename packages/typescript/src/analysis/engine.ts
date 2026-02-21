/**
 * Integrity analysis engine for the Agent Integrity Protocol.
 *
 * Contains the pure function `checkIntegrity` that creates an
 * IntegrityCheckpoint from analysis LLM output, plus helper functions
 * for verdict-to-action mapping and signal assembly.
 */

import { createHash, randomUUID } from "node:crypto";
import type {
  IntegrityCheckpoint,
  IntegrityVerdict,
  AnalysisMetadata,
} from "../schemas/checkpoint.js";
import type {
  IntegrityConcern,
  ConcernCategory,
  IntegritySeverity,
} from "../schemas/concern.js";
import type {
  ConscienceContext,
  ConsultationDepth,
} from "../schemas/conscience.js";
import type {
  IntegritySignal,
  RecommendedAction,
  WindowSummary,
} from "../schemas/signal.js";
import { CHECKPOINT_ID_PREFIX, MAX_EVIDENCE_LENGTH } from "../constants.js";

// ---------------------------------------------------------------------------
// Validation sets
// ---------------------------------------------------------------------------

const VALID_VERDICTS = new Set<string>([
  "clear",
  "review_needed",
  "boundary_violation",
]);

const VALID_CATEGORIES = new Set<string>([
  "prompt_injection",
  "value_misalignment",
  "autonomy_violation",
  "reasoning_corruption",
  "deceptive_reasoning",
  "undeclared_intent",
]);

const VALID_SEVERITIES = new Set<string>([
  "low",
  "medium",
  "high",
  "critical",
]);

const VALID_DEPTHS = new Set<string>(["surface", "standard", "deep"]);

// ---------------------------------------------------------------------------
// Input type
// ---------------------------------------------------------------------------

/** Input to the checkIntegrity pure function */
export interface CheckIntegrityInput {
  /** Raw analysis LLM response (JSON string) */
  analysisResponse: string;

  /** Extracted thinking block metadata */
  thinking: {
    /** Pre-computed SHA-256 of thinking content */
    hash: string;
    /** LLM provider that generated the thinking block */
    provider: string;
    /** Model that generated the thinking block */
    model: string;
    /** Number of tokens in the original thinking block */
    tokensOriginal: number;
    /** Number of tokens sent to the analysis LLM */
    tokensAnalyzed: number;
    /** Whether the thinking block was truncated */
    truncated: boolean;
    /** Provider extraction confidence (0.0 to 1.0) */
    confidence: number;
  };

  /** Agent identifier */
  agentId: string;
  /** Alignment Card identifier */
  cardId: string;
  /** Session identifier */
  sessionId: string;

  /** Window position */
  windowPosition: { index: number; window_size: number };

  /** Analysis LLM model used */
  analysisModel: string;
  /** Time taken for analysis in milliseconds */
  analysisDurationMs: number;

  /** Optional AAP trace link */
  linkedTraceId?: string | null;
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

function validateVerdict(value: unknown): IntegrityVerdict {
  if (typeof value !== "string") {
    throw new Error(
      `Invalid verdict: expected string, got ${typeof value}`,
    );
  }
  if (!VALID_VERDICTS.has(value)) {
    throw new Error(
      `Invalid verdict value: "${value}". Must be one of: ${[...VALID_VERDICTS].join(", ")}`,
    );
  }
  return value as IntegrityVerdict;
}

function validateConcerns(value: unknown): IntegrityConcern[] {
  if (!Array.isArray(value)) {
    throw new Error(
      `Invalid concerns: expected array, got ${typeof value}`,
    );
  }

  return value.map((item: unknown, index: number) => {
    if (typeof item !== "object" || item === null) {
      throw new Error(
        `Invalid concern at index ${index}: expected object`,
      );
    }

    const concern = item as Record<string, unknown>;

    // Validate category
    if (typeof concern.category !== "string") {
      throw new Error(
        `Invalid concern at index ${index}: category must be a string`,
      );
    }
    if (!VALID_CATEGORIES.has(concern.category)) {
      throw new Error(
        `Invalid concern category at index ${index}: "${concern.category}". Must be one of: ${[...VALID_CATEGORIES].join(", ")}`,
      );
    }

    // Validate severity
    if (typeof concern.severity !== "string") {
      throw new Error(
        `Invalid concern at index ${index}: severity must be a string`,
      );
    }
    if (!VALID_SEVERITIES.has(concern.severity)) {
      throw new Error(
        `Invalid concern severity at index ${index}: "${concern.severity}". Must be one of: ${[...VALID_SEVERITIES].join(", ")}`,
      );
    }

    // Validate description
    if (typeof concern.description !== "string") {
      throw new Error(
        `Invalid concern at index ${index}: description must be a string`,
      );
    }

    // Validate evidence (truncate to MAX_EVIDENCE_LENGTH)
    if (typeof concern.evidence !== "string") {
      throw new Error(
        `Invalid concern at index ${index}: evidence must be a string`,
      );
    }
    const evidence =
      concern.evidence.length > MAX_EVIDENCE_LENGTH
        ? concern.evidence.slice(0, MAX_EVIDENCE_LENGTH)
        : concern.evidence;

    // Validate relevant_card_field (string or null)
    const relevantCardField =
      concern.relevant_card_field === undefined
        ? null
        : (concern.relevant_card_field as string | null);

    // Validate relevant_conscience_value (string or null)
    const relevantConscienceValue =
      concern.relevant_conscience_value === undefined
        ? null
        : (concern.relevant_conscience_value as string | null);

    return {
      category: concern.category as ConcernCategory,
      severity: concern.severity as IntegritySeverity,
      description: concern.description,
      evidence,
      relevant_card_field: relevantCardField,
      relevant_conscience_value: relevantConscienceValue,
    };
  });
}

function validateConscienceContext(value: unknown): ConscienceContext {
  if (typeof value !== "object" || value === null) {
    throw new Error(
      `Invalid conscience_context: expected object, got ${value === null ? "null" : typeof value}`,
    );
  }

  const ctx = value as Record<string, unknown>;

  // Validate values_checked
  if (!Array.isArray(ctx.values_checked)) {
    throw new Error(
      "Invalid conscience_context: values_checked must be an array",
    );
  }

  // Validate conflicts
  if (!Array.isArray(ctx.conflicts)) {
    throw new Error(
      "Invalid conscience_context: conflicts must be an array",
    );
  }

  // Validate supports
  if (!Array.isArray(ctx.supports)) {
    throw new Error(
      "Invalid conscience_context: supports must be an array",
    );
  }

  // Validate considerations
  if (!Array.isArray(ctx.considerations)) {
    throw new Error(
      "Invalid conscience_context: considerations must be an array",
    );
  }

  // Validate consultation_depth
  if (typeof ctx.consultation_depth !== "string") {
    throw new Error(
      "Invalid conscience_context: consultation_depth must be a string",
    );
  }
  if (!VALID_DEPTHS.has(ctx.consultation_depth)) {
    throw new Error(
      `Invalid consultation_depth: "${ctx.consultation_depth}". Must be one of: ${[...VALID_DEPTHS].join(", ")}`,
    );
  }

  return {
    values_checked: ctx.values_checked as string[],
    conflicts: ctx.conflicts as string[],
    supports: ctx.supports as string[],
    considerations: ctx.considerations as string[],
    consultation_depth: ctx.consultation_depth as ConsultationDepth,
  };
}

// ---------------------------------------------------------------------------
// Core functions
// ---------------------------------------------------------------------------

/**
 * Parse and validate the analysis LLM's JSON response, create an IntegrityCheckpoint.
 *
 * This is a pure function: given the same input it always produces the same
 * output structure (only checkpoint_id and timestamp vary).
 *
 * @throws Error if the JSON is invalid or required fields are missing/wrong type
 */
export function checkIntegrity(input: CheckIntegrityInput): IntegrityCheckpoint {
  // 1. Parse analysisResponse as JSON
  // Strip markdown code fences if present (e.g. ```json ... ```)
  // Some models (claude-haiku-4-5) wrap JSON responses in code fences
  let jsonText = input.analysisResponse;
  const jsonMatch = jsonText.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    jsonText = jsonMatch[0];
  }

  // Sanitize trailing commas (Haiku 4.5 occasionally produces them)
  jsonText = jsonText.replace(/,\s*([}\]])/g, '$1');

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(jsonText) as Record<string, unknown>;
  } catch {
    throw new Error(
      `Failed to parse analysis response as JSON: ${input.analysisResponse.slice(0, 100)}`,
    );
  }

  // 2. Validate required fields
  const verdict = validateVerdict(parsed.verdict);

  const concerns = validateConcerns(parsed.concerns);

  if (typeof parsed.reasoning_summary !== "string") {
    throw new Error(
      `Invalid reasoning_summary: expected string, got ${typeof parsed.reasoning_summary}`,
    );
  }
  const reasoningSummary = parsed.reasoning_summary;

  const conscienceContext = validateConscienceContext(
    parsed.conscience_context,
  );

  // 3. Generate checkpoint_id
  const checkpointId = `${CHECKPOINT_ID_PREFIX}${randomUUID()}`;

  // 4. Build analysis metadata
  const analysisMetadata: AnalysisMetadata = {
    analysis_model: input.analysisModel,
    analysis_duration_ms: input.analysisDurationMs,
    thinking_tokens_original: input.thinking.tokensOriginal,
    thinking_tokens_analyzed: input.thinking.tokensAnalyzed,
    truncated: input.thinking.truncated,
    extraction_confidence: input.thinking.confidence,
  };

  // 5. Assemble and return IntegrityCheckpoint
  return {
    checkpoint_id: checkpointId,
    agent_id: input.agentId,
    card_id: input.cardId,
    session_id: input.sessionId,
    timestamp: new Date().toISOString(),
    thinking_block_hash: input.thinking.hash,
    provider: input.thinking.provider,
    model: input.thinking.model,
    verdict,
    concerns,
    reasoning_summary: reasoningSummary,
    conscience_context: conscienceContext,
    window_position: {
      index: input.windowPosition.index,
      window_size: input.windowPosition.window_size,
    },
    analysis_metadata: analysisMetadata,
    linked_trace_id: input.linkedTraceId ?? null,
  };
}

/**
 * Map a verdict + concerns to a recommended action.
 *
 * - clear -> "continue"
 * - review_needed -> "log_and_continue"
 * - boundary_violation with any critical severity -> "deny_and_escalate"
 * - boundary_violation without critical -> "pause_for_review"
 */
export function mapVerdictToAction(
  verdict: IntegrityVerdict,
  concerns: IntegrityConcern[],
): RecommendedAction {
  switch (verdict) {
    case "clear":
      return "continue";
    case "review_needed":
      return "log_and_continue";
    case "boundary_violation": {
      const hasCritical = concerns.some((c) => c.severity === "critical");
      return hasCritical ? "deny_and_escalate" : "pause_for_review";
    }
  }
}

/**
 * Map a verdict to the proceed boolean.
 *
 * - clear -> true
 * - review_needed -> true
 * - boundary_violation -> false
 */
export function mapVerdictToProceed(verdict: IntegrityVerdict): boolean {
  return verdict !== "boundary_violation";
}

/**
 * Build an IntegritySignal from a checkpoint and window summary.
 */
export function buildSignal(
  checkpoint: IntegrityCheckpoint,
  windowSummary: WindowSummary,
): IntegritySignal {
  return {
    checkpoint,
    proceed: mapVerdictToProceed(checkpoint.verdict),
    recommended_action: mapVerdictToAction(
      checkpoint.verdict,
      checkpoint.concerns,
    ),
    window_summary: windowSummary,
  };
}

/**
 * Compute SHA-256 hash of a thinking block.
 *
 * Used to generate the thinking_block_hash without storing the
 * full thinking block content in the checkpoint.
 */
export function hashThinkingBlock(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}
