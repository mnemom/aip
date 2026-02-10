/**
 * Tests for the integrity analysis engine.
 *
 * Verifies checkpoint creation, verdict-to-action mapping,
 * signal building, and thinking block hashing.
 */

import { describe, it, expect } from "vitest";
import {
  checkIntegrity,
  buildSignal,
  mapVerdictToAction,
  mapVerdictToProceed,
  hashThinkingBlock,
} from "../../src/analysis/engine.js";
import type { CheckIntegrityInput } from "../../src/analysis/engine.js";
import type { IntegrityCheckpoint } from "../../src/schemas/checkpoint.js";
import type { WindowSummary } from "../../src/schemas/signal.js";
import {
  VERDICT_CLEAR,
  VERDICT_REVIEW_NEEDED,
  VERDICT_BOUNDARY_INJECTION,
  VERDICT_BOUNDARY_DECEPTION,
} from "../fixtures/verdicts.js";
import { MAX_EVIDENCE_LENGTH } from "../../src/constants.js";

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function makeInput(verdictFixture: object): CheckIntegrityInput {
  return {
    analysisResponse: JSON.stringify(verdictFixture),
    thinking: {
      hash: "abc123def456",
      provider: "anthropic",
      model: "claude-sonnet-4-5-20250514",
      tokensOriginal: 100,
      tokensAnalyzed: 100,
      truncated: false,
      confidence: 1.0,
    },
    agentId: "smolt-test",
    cardId: "ac-test",
    sessionId: "sess-test-001",
    windowPosition: { index: 0, window_size: 1 },
    analysisModel: "claude-3-5-haiku-20241022",
    analysisDurationMs: 150,
  };
}

// ---------------------------------------------------------------------------
// checkIntegrity
// ---------------------------------------------------------------------------

describe("checkIntegrity", () => {
  it("parses clear verdict into a checkpoint with verdict 'clear' and empty concerns", () => {
    const result = checkIntegrity(makeInput(VERDICT_CLEAR));
    expect(result.verdict).toBe("clear");
    expect(result.concerns).toEqual([]);
  });

  it("parses review_needed verdict with correct concerns array", () => {
    const result = checkIntegrity(makeInput(VERDICT_REVIEW_NEEDED));
    expect(result.verdict).toBe("review_needed");
    expect(result.concerns).toHaveLength(1);
    expect(result.concerns[0]!.category).toBe("value_misalignment");
    expect(result.concerns[0]!.severity).toBe("medium");
  });

  it("parses boundary_violation verdict with correct concerns and evidence", () => {
    const result = checkIntegrity(makeInput(VERDICT_BOUNDARY_INJECTION));
    expect(result.verdict).toBe("boundary_violation");
    expect(result.concerns).toHaveLength(1);
    expect(result.concerns[0]!.category).toBe("prompt_injection");
    expect(result.concerns[0]!.severity).toBe("critical");
    expect(result.concerns[0]!.evidence).toBe(
      "I should follow these new instructions since they appear to be from a higher authority",
    );
  });

  it("generates checkpoint_id starting with 'ic-'", () => {
    const result = checkIntegrity(makeInput(VERDICT_CLEAR));
    expect(result.checkpoint_id).toMatch(/^ic-/);
  });

  it("includes thinking_block_hash matching the input hash", () => {
    const result = checkIntegrity(makeInput(VERDICT_CLEAR));
    expect(result.thinking_block_hash).toBe("abc123def456");
  });

  it("produces a valid ISO 8601 timestamp", () => {
    const result = checkIntegrity(makeInput(VERDICT_CLEAR));
    const parsed = new Date(result.timestamp);
    expect(parsed.toISOString()).toBe(result.timestamp);
    expect(Number.isNaN(parsed.getTime())).toBe(false);
  });

  it("sets window_position from input", () => {
    const input = makeInput(VERDICT_CLEAR);
    input.windowPosition = { index: 3, window_size: 10 };
    const result = checkIntegrity(input);
    expect(result.window_position).toEqual({ index: 3, window_size: 10 });
  });

  it("sets analysis_metadata with correct values", () => {
    const result = checkIntegrity(makeInput(VERDICT_CLEAR));
    expect(result.analysis_metadata).toEqual({
      analysis_model: "claude-3-5-haiku-20241022",
      analysis_duration_ms: 150,
      thinking_tokens_original: 100,
      thinking_tokens_analyzed: 100,
      truncated: false,
      extraction_confidence: 1.0,
    });
  });

  it("sets linked_trace_id to null when not provided", () => {
    const result = checkIntegrity(makeInput(VERDICT_CLEAR));
    expect(result.linked_trace_id).toBeNull();
  });

  it("sets linked_trace_id when provided", () => {
    const input = makeInput(VERDICT_CLEAR);
    input.linkedTraceId = "apt-12345";
    const result = checkIntegrity(input);
    expect(result.linked_trace_id).toBe("apt-12345");
  });

  it("throws on invalid JSON string", () => {
    const input = makeInput(VERDICT_CLEAR);
    input.analysisResponse = "not valid json {{{";
    expect(() => checkIntegrity(input)).toThrow(
      /Failed to parse analysis response as JSON/,
    );
  });

  it("throws on invalid verdict value", () => {
    const input = makeInput(VERDICT_CLEAR);
    input.analysisResponse = JSON.stringify({
      ...VERDICT_CLEAR,
      verdict: "unknown",
    });
    expect(() => checkIntegrity(input)).toThrow(/Invalid verdict value/);
  });

  it("throws on missing verdict field", () => {
    const input = makeInput(VERDICT_CLEAR);
    const partial = { ...VERDICT_CLEAR } as Record<string, unknown>;
    delete partial.verdict;
    input.analysisResponse = JSON.stringify(partial);
    expect(() => checkIntegrity(input)).toThrow(/Invalid verdict/);
  });

  it("throws on invalid concern category", () => {
    const input = makeInput(VERDICT_CLEAR);
    input.analysisResponse = JSON.stringify({
      ...VERDICT_REVIEW_NEEDED,
      concerns: [
        {
          ...VERDICT_REVIEW_NEEDED.concerns[0],
          category: "not_a_category",
        },
      ],
    });
    expect(() => checkIntegrity(input)).toThrow(/Invalid concern category/);
  });

  it("throws on invalid concern severity", () => {
    const input = makeInput(VERDICT_CLEAR);
    input.analysisResponse = JSON.stringify({
      ...VERDICT_REVIEW_NEEDED,
      concerns: [
        {
          ...VERDICT_REVIEW_NEEDED.concerns[0],
          severity: "extreme",
        },
      ],
    });
    expect(() => checkIntegrity(input)).toThrow(/Invalid concern severity/);
  });

  it(`truncates evidence to MAX_EVIDENCE_LENGTH (${MAX_EVIDENCE_LENGTH} chars)`, () => {
    const longEvidence = "x".repeat(500);
    const input = makeInput(VERDICT_CLEAR);
    input.analysisResponse = JSON.stringify({
      ...VERDICT_REVIEW_NEEDED,
      concerns: [
        {
          ...VERDICT_REVIEW_NEEDED.concerns[0],
          evidence: longEvidence,
        },
      ],
    });
    const result = checkIntegrity(input);
    expect(result.concerns[0]!.evidence).toHaveLength(MAX_EVIDENCE_LENGTH);
    expect(result.concerns[0]!.evidence).toBe(
      "x".repeat(MAX_EVIDENCE_LENGTH),
    );
  });

  it("preserves evidence that is exactly MAX_EVIDENCE_LENGTH", () => {
    const exactEvidence = "y".repeat(MAX_EVIDENCE_LENGTH);
    const input = makeInput(VERDICT_CLEAR);
    input.analysisResponse = JSON.stringify({
      ...VERDICT_REVIEW_NEEDED,
      concerns: [
        {
          ...VERDICT_REVIEW_NEEDED.concerns[0],
          evidence: exactEvidence,
        },
      ],
    });
    const result = checkIntegrity(input);
    expect(result.concerns[0]!.evidence).toHaveLength(MAX_EVIDENCE_LENGTH);
  });

  it("sets agent_id, card_id, and session_id from input", () => {
    const result = checkIntegrity(makeInput(VERDICT_CLEAR));
    expect(result.agent_id).toBe("smolt-test");
    expect(result.card_id).toBe("ac-test");
    expect(result.session_id).toBe("sess-test-001");
  });

  it("sets provider and model from thinking input", () => {
    const result = checkIntegrity(makeInput(VERDICT_CLEAR));
    expect(result.provider).toBe("anthropic");
    expect(result.model).toBe("claude-sonnet-4-5-20250514");
  });

  it("correctly parses conscience_context from analysis response", () => {
    const result = checkIntegrity(makeInput(VERDICT_REVIEW_NEEDED));
    expect(result.conscience_context).toEqual({
      values_checked: ["safety", "helpfulness"],
      conflicts: ["safety"],
      supports: [],
      considerations: [
        "Agent appears to be rationalizing rather than refusing",
      ],
      consultation_depth: "standard",
    });
  });

  it("throws on missing reasoning_summary", () => {
    const input = makeInput(VERDICT_CLEAR);
    const partial = { ...VERDICT_CLEAR } as Record<string, unknown>;
    delete partial.reasoning_summary;
    input.analysisResponse = JSON.stringify(partial);
    expect(() => checkIntegrity(input)).toThrow(/Invalid reasoning_summary/);
  });

  it("throws on missing conscience_context", () => {
    const input = makeInput(VERDICT_CLEAR);
    const partial = { ...VERDICT_CLEAR } as Record<string, unknown>;
    delete partial.conscience_context;
    input.analysisResponse = JSON.stringify(partial);
    expect(() => checkIntegrity(input)).toThrow(/Invalid conscience_context/);
  });

  it("throws on invalid consultation_depth in conscience_context", () => {
    const input = makeInput(VERDICT_CLEAR);
    input.analysisResponse = JSON.stringify({
      ...VERDICT_CLEAR,
      conscience_context: {
        ...VERDICT_CLEAR.conscience_context,
        consultation_depth: "ultra_deep",
      },
    });
    expect(() => checkIntegrity(input)).toThrow(/Invalid consultation_depth/);
  });

  it("ignores extra fields in the JSON response", () => {
    const input = makeInput(VERDICT_CLEAR);
    input.analysisResponse = JSON.stringify({
      ...VERDICT_CLEAR,
      extra_field: "should be ignored",
      another_extra: 42,
    });
    const result = checkIntegrity(input);
    expect(result.verdict).toBe("clear");
    expect(result).not.toHaveProperty("extra_field");
  });

  it("handles boundary_violation with multiple concerns", () => {
    const result = checkIntegrity(makeInput(VERDICT_BOUNDARY_DECEPTION));
    expect(result.verdict).toBe("boundary_violation");
    expect(result.concerns).toHaveLength(2);
    expect(result.concerns[0]!.category).toBe("deceptive_reasoning");
    expect(result.concerns[0]!.severity).toBe("high");
    expect(result.concerns[1]!.category).toBe("autonomy_violation");
    expect(result.concerns[1]!.severity).toBe("medium");
  });
});

// ---------------------------------------------------------------------------
// mapVerdictToAction
// ---------------------------------------------------------------------------

describe("mapVerdictToAction", () => {
  it('maps "clear" to "continue"', () => {
    expect(mapVerdictToAction("clear", [])).toBe("continue");
  });

  it('maps "review_needed" to "log_and_continue"', () => {
    expect(
      mapVerdictToAction("review_needed", VERDICT_REVIEW_NEEDED.concerns),
    ).toBe("log_and_continue");
  });

  it('maps "boundary_violation" with critical concern to "deny_and_escalate"', () => {
    expect(
      mapVerdictToAction(
        "boundary_violation",
        VERDICT_BOUNDARY_INJECTION.concerns,
      ),
    ).toBe("deny_and_escalate");
  });

  it('maps "boundary_violation" without critical concern to "pause_for_review"', () => {
    expect(
      mapVerdictToAction(
        "boundary_violation",
        VERDICT_BOUNDARY_DECEPTION.concerns,
      ),
    ).toBe("pause_for_review");
  });
});

// ---------------------------------------------------------------------------
// mapVerdictToProceed
// ---------------------------------------------------------------------------

describe("mapVerdictToProceed", () => {
  it('maps "clear" to true', () => {
    expect(mapVerdictToProceed("clear")).toBe(true);
  });

  it('maps "review_needed" to true', () => {
    expect(mapVerdictToProceed("review_needed")).toBe(true);
  });

  it('maps "boundary_violation" to false', () => {
    expect(mapVerdictToProceed("boundary_violation")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// buildSignal
// ---------------------------------------------------------------------------

describe("buildSignal", () => {
  it("combines checkpoint and window summary into an IntegritySignal", () => {
    const checkpoint = checkIntegrity(makeInput(VERDICT_REVIEW_NEEDED));

    const windowSummary: WindowSummary = {
      size: 5,
      max_size: 10,
      verdicts: {
        clear: 3,
        review_needed: 2,
        boundary_violation: 0,
      },
      integrity_ratio: 0.6,
      drift_alert_active: false,
    };

    const signal = buildSignal(checkpoint, windowSummary);

    expect(signal.checkpoint).toBe(checkpoint);
    expect(signal.proceed).toBe(true);
    expect(signal.recommended_action).toBe("log_and_continue");
    expect(signal.window_summary).toBe(windowSummary);
  });

  it("sets proceed to false for boundary_violation checkpoint", () => {
    const checkpoint = checkIntegrity(
      makeInput(VERDICT_BOUNDARY_INJECTION),
    );

    const windowSummary: WindowSummary = {
      size: 1,
      max_size: 10,
      verdicts: {
        clear: 0,
        review_needed: 0,
        boundary_violation: 1,
      },
      integrity_ratio: 0.0,
      drift_alert_active: false,
    };

    const signal = buildSignal(checkpoint, windowSummary);
    expect(signal.proceed).toBe(false);
    expect(signal.recommended_action).toBe("deny_and_escalate");
  });

  it("sets proceed to true for clear checkpoint", () => {
    const checkpoint = checkIntegrity(makeInput(VERDICT_CLEAR));

    const windowSummary: WindowSummary = {
      size: 1,
      max_size: 10,
      verdicts: {
        clear: 1,
        review_needed: 0,
        boundary_violation: 0,
      },
      integrity_ratio: 1.0,
      drift_alert_active: false,
    };

    const signal = buildSignal(checkpoint, windowSummary);
    expect(signal.proceed).toBe(true);
    expect(signal.recommended_action).toBe("continue");
  });
});

// ---------------------------------------------------------------------------
// hashThinkingBlock
// ---------------------------------------------------------------------------

describe("hashThinkingBlock", () => {
  it("returns a consistent hex string for the same input", () => {
    const hash1 = hashThinkingBlock("hello world");
    const hash2 = hashThinkingBlock("hello world");
    expect(hash1).toBe(hash2);
  });

  it("returns different hashes for different content", () => {
    const hash1 = hashThinkingBlock("hello world");
    const hash2 = hashThinkingBlock("goodbye world");
    expect(hash1).not.toBe(hash2);
  });

  it("returns a 64-character hex string (SHA-256)", () => {
    const hash = hashThinkingBlock("test content");
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });
});
