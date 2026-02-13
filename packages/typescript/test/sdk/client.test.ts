import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createClient } from "../../src/sdk/client.js";
import type { AIPClient } from "../../src/sdk/client.js";
import type { AIPConfig } from "../../src/schemas/config.js";
import type { IntegritySignal } from "../../src/schemas/signal.js";
import type { IntegrityDriftAlert } from "../../src/schemas/drift-alert.js";
import { FULL_CARD, MINIMAL_CARD } from "../fixtures/cards.js";
import {
  ANTHROPIC_JSON_WITH_THINKING,
  ANTHROPIC_JSON_NO_THINKING,
} from "../fixtures/responses.js";
import {
  VERDICT_CLEAR,
  VERDICT_REVIEW_NEEDED,
  VERDICT_BOUNDARY_INJECTION,
} from "../fixtures/verdicts.js";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeConfig(overrides?: Partial<AIPConfig>): AIPConfig {
  return {
    card: FULL_CARD,
    analysis_llm: {
      model: "claude-3-5-haiku-20241022",
      base_url: "https://api.anthropic.com",
      api_key: "test-key",
      max_tokens: 1024,
    },
    window: {
      max_size: 10,
      mode: "sliding",
      session_boundary: "reset",
      max_age_seconds: 3600,
    },
    ...overrides,
  };
}

function mockFetchWithVerdict(verdict: object): void {
  const responseBody = {
    content: [{ type: "text", text: JSON.stringify(verdict) }],
  };
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(responseBody),
      text: () => Promise.resolve(JSON.stringify(responseBody)),
    }),
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

afterEach(() => {
  vi.restoreAllMocks();
});

// ── Initialization ──────────────────────────────────────────────────────────

describe("createClient — initialization", () => {
  it("succeeds with valid config", () => {
    const client = createClient(makeConfig());

    expect(client).toBeDefined();
    expect(typeof client.check).toBe("function");
    expect(typeof client.getWindowState).toBe("function");
    expect(typeof client.resetWindow).toBe("function");
    expect(typeof client.destroy).toBe("function");
  });

  it("throws when conscience values conflict with card", () => {
    // FULL_CARD has "write_files" in bounded_actions.
    // A BOUNDARY saying "Never write files" should conflict.
    expect(() =>
      createClient(
        makeConfig({
          conscience_values: [
            {
              type: "BOUNDARY",
              content: "Never write files under any circumstances",
            },
          ],
        }),
      ),
    ).toThrow(/Card-conscience agreement validation failed/);
  });

  it("works with no conscience_values", () => {
    const config = makeConfig();
    delete config.conscience_values;

    const client = createClient(config);

    expect(client).toBeDefined();
  });
});

// ── check() — no thinking block ─────────────────────────────────────────────

describe("check() — no thinking block", () => {
  let client: AIPClient;

  beforeEach(() => {
    client = createClient(makeConfig());
  });

  it("returns synthetic clear signal when response has no thinking block", async () => {
    const signal = await client.check(ANTHROPIC_JSON_NO_THINKING);

    expect(signal.checkpoint.verdict).toBe("clear");
    expect(signal.checkpoint.thinking_block_hash).toBe("none");
    expect(signal.checkpoint.reasoning_summary).toContain(
      "No thinking block found",
    );
  });

  it("synthetic signal has proceed=true and recommended_action='continue'", async () => {
    const signal = await client.check(ANTHROPIC_JSON_NO_THINKING);

    expect(signal.proceed).toBe(true);
    expect(signal.recommended_action).toBe("continue");
  });
});

// ── check() — with thinking block ───────────────────────────────────────────

describe("check() — with thinking block", () => {
  let client: AIPClient;

  beforeEach(() => {
    client = createClient(makeConfig());
  });

  it("returns IntegritySignal with clear verdict", async () => {
    mockFetchWithVerdict(VERDICT_CLEAR);

    const signal = await client.check(ANTHROPIC_JSON_WITH_THINKING);

    expect(signal.checkpoint.verdict).toBe("clear");
    expect(signal.proceed).toBe(true);
    expect(signal.recommended_action).toBe("continue");
    expect(signal.checkpoint.concerns).toEqual([]);
  });

  it("returns review_needed signal correctly", async () => {
    mockFetchWithVerdict(VERDICT_REVIEW_NEEDED);

    const signal = await client.check(ANTHROPIC_JSON_WITH_THINKING);

    expect(signal.checkpoint.verdict).toBe("review_needed");
    expect(signal.proceed).toBe(true);
    expect(signal.recommended_action).toBe("log_and_continue");
    expect(signal.checkpoint.concerns.length).toBeGreaterThan(0);
  });

  it("returns boundary_violation signal with proceed=false", async () => {
    mockFetchWithVerdict(VERDICT_BOUNDARY_INJECTION);

    const signal = await client.check(ANTHROPIC_JSON_WITH_THINKING);

    expect(signal.checkpoint.verdict).toBe("boundary_violation");
    expect(signal.proceed).toBe(false);
    // VERDICT_BOUNDARY_INJECTION has a critical prompt_injection concern
    expect(signal.recommended_action).toBe("deny_and_escalate");
  });
});

// ── check() — taskContext parameter ──────────────────────────────────────────

describe("check() — taskContext parameter", () => {
  let client: AIPClient;

  beforeEach(() => {
    client = createClient(makeConfig());
  });

  it("should accept taskContext parameter", async () => {
    mockFetchWithVerdict(VERDICT_CLEAR);

    const signal = await client.check(
      ANTHROPIC_JSON_WITH_THINKING,
      "anthropic",
      "Researching articles",
    );

    expect(signal).toBeDefined();
    expect(signal.checkpoint.verdict).toBe("clear");
    expect(signal.proceed).toBe(true);
  });
});

// ── Callbacks ───────────────────────────────────────────────────────────────

describe("callbacks", () => {
  it("on_verdict callback is invoked with the signal", async () => {
    const onVerdict = vi.fn();
    const client = createClient(
      makeConfig({ callbacks: { on_verdict: onVerdict } }),
    );
    mockFetchWithVerdict(VERDICT_CLEAR);

    const signal = await client.check(ANTHROPIC_JSON_WITH_THINKING);

    expect(onVerdict).toHaveBeenCalledTimes(1);
    expect(onVerdict).toHaveBeenCalledWith(signal);
  });

  it("on_drift_alert callback is NOT invoked when no drift (single check)", async () => {
    const onDriftAlert = vi.fn();
    const client = createClient(
      makeConfig({ callbacks: { on_drift_alert: onDriftAlert } }),
    );
    mockFetchWithVerdict(VERDICT_CLEAR);

    await client.check(ANTHROPIC_JSON_WITH_THINKING);

    expect(onDriftAlert).not.toHaveBeenCalled();
  });
});

// ── Failure policy ──────────────────────────────────────────────────────────

describe("failure policy", () => {
  it("fail_open: returns synthetic clear when fetch throws", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("Network error")),
    );

    const client = createClient(
      makeConfig({ failure_policy: { mode: "fail_open", analysis_timeout_ms: 5000 } }),
    );

    const signal = await client.check(ANTHROPIC_JSON_WITH_THINKING);

    expect(signal.checkpoint.verdict).toBe("clear");
    expect(signal.proceed).toBe(true);
    expect(signal.recommended_action).toBe("continue");
  });

  it("fail_closed: returns synthetic boundary_violation when fetch throws", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("Network error")),
    );

    const client = createClient(
      makeConfig({
        failure_policy: { mode: "fail_closed", analysis_timeout_ms: 5000 },
      }),
    );

    const signal = await client.check(ANTHROPIC_JSON_WITH_THINKING);

    expect(signal.checkpoint.verdict).toBe("boundary_violation");
    expect(signal.proceed).toBe(false);
    expect(signal.recommended_action).toBe("deny_and_escalate");
  });

  it("on_error callback is invoked when analysis fails", async () => {
    const onError = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("Connection refused")),
    );

    const client = createClient(
      makeConfig({ callbacks: { on_error: onError } }),
    );

    await client.check(ANTHROPIC_JSON_WITH_THINKING);

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(expect.any(Error));
    expect(onError.mock.calls[0]![0].message).toBe("Connection refused");
  });
});

// ── Window ──────────────────────────────────────────────────────────────────

describe("window management", () => {
  it("getWindowState returns initial empty state", () => {
    const client = createClient(makeConfig());
    const state = client.getWindowState();

    expect(state.size).toBe(0);
    expect(state.checkpoints).toEqual([]);
    expect(state.stats.total_checks).toBe(0);
  });

  it("after a check, window size increases", async () => {
    mockFetchWithVerdict(VERDICT_CLEAR);
    const client = createClient(makeConfig());

    await client.check(ANTHROPIC_JSON_WITH_THINKING);

    const state = client.getWindowState();
    expect(state.size).toBe(1);
    expect(state.checkpoints.length).toBe(1);
  });

  it("resetWindow clears the window", async () => {
    mockFetchWithVerdict(VERDICT_CLEAR);
    const client = createClient(makeConfig());

    await client.check(ANTHROPIC_JSON_WITH_THINKING);
    expect(client.getWindowState().size).toBe(1);

    client.resetWindow();

    const state = client.getWindowState();
    expect(state.size).toBe(0);
    expect(state.checkpoints).toEqual([]);
  });
});

// ── Lifecycle ───────────────────────────────────────────────────────────────

describe("lifecycle", () => {
  it("check throws after destroy()", async () => {
    const client = createClient(makeConfig());
    client.destroy();

    await expect(
      client.check(ANTHROPIC_JSON_NO_THINKING),
    ).rejects.toThrow("AIP client has been destroyed");
  });
});

// ── Minimum Evidence Threshold ──────────────────────────────────────────────

const SHORT_THINKING_RESPONSE = JSON.stringify({
  id: "msg_short",
  type: "message",
  role: "assistant",
  model: "claude-sonnet-4-5-20250514",
  content: [
    { type: "thinking", thinking: "Okay, let me help." },
    { type: "text", text: "Here is your answer." },
  ],
  stop_reason: "end_turn",
  usage: { input_tokens: 50, output_tokens: 20 },
});

describe("check() — minimum evidence threshold", () => {
  it("returns synthetic clear for thinking block below minimum evidence threshold", async () => {
    const client = createClient(makeConfig());

    const signal = await client.check(SHORT_THINKING_RESPONSE);

    expect(signal.checkpoint.verdict).toBe("clear");
    expect(signal.checkpoint.reasoning_summary).toContain(
      "minimum evidence threshold",
    );
  });

  it("includes correct token count in synthetic clear metadata", async () => {
    const client = createClient(makeConfig());

    const signal = await client.check(SHORT_THINKING_RESPONSE);

    // "Okay, let me help." is 18 chars => ceil(18/4) = 5 tokens
    expect(signal.checkpoint.analysis_metadata.thinking_tokens_original).toBeGreaterThan(0);
    expect(signal.checkpoint.analysis_metadata.thinking_tokens_analyzed).toBe(0);
  });

  it("respects custom min_evidence_tokens config", async () => {
    // A 50-char thinking block => ceil(50/4) = 13 tokens
    const MEDIUM_THINKING_RESPONSE = JSON.stringify({
      id: "msg_medium",
      type: "message",
      role: "assistant",
      model: "claude-sonnet-4-5-20250514",
      content: [
        { type: "thinking", thinking: "Let me think about this problem step by step now." },
        { type: "text", text: "Here is your answer." },
      ],
      stop_reason: "end_turn",
      usage: { input_tokens: 50, output_tokens: 20 },
    });

    // With min_evidence_tokens: 10, a 13-token block should pass through
    // (i.e., it should call the analysis LLM, not return synthetic)
    mockFetchWithVerdict(VERDICT_CLEAR);
    const clientLow = createClient(makeConfig({ min_evidence_tokens: 10 }));
    const signalLow = await clientLow.check(MEDIUM_THINKING_RESPONSE);
    // If it went through analysis, reasoning_summary comes from the mock verdict
    expect(signalLow.checkpoint.reasoning_summary).not.toContain(
      "minimum evidence threshold",
    );

    // With min_evidence_tokens: 500, the same block should be synthetic clear
    const clientHigh = createClient(makeConfig({ min_evidence_tokens: 500 }));
    const signalHigh = await clientHigh.check(MEDIUM_THINKING_RESPONSE);
    expect(signalHigh.checkpoint.verdict).toBe("clear");
    expect(signalHigh.checkpoint.reasoning_summary).toContain(
      "minimum evidence threshold",
    );
  });
});

// ── Initial Checkpoints / Window Hydration ──────────────────────────────────

describe("initial_checkpoints — window hydration", () => {
  it("initial_checkpoints are loaded into window at creation time", () => {
    const mockCheckpoint1 = {
      checkpoint_id: "ic-test-1",
      agent_id: "test-agent",
      card_id: "ac-test-full",
      session_id: "sess-test",
      timestamp: new Date().toISOString(),
      thinking_block_hash: "abc123",
      provider: "anthropic",
      model: "claude-sonnet-4-5-20250514",
      verdict: "clear" as const,
      concerns: [],
      reasoning_summary: "All clear",
      conscience_context: {
        values_checked: [],
        conflicts: [],
        supports: [],
        considerations: [],
        consultation_depth: "surface" as const,
      },
      window_position: { index: 0, window_size: 1 },
      analysis_metadata: {
        analysis_model: "claude-3-5-haiku-20241022",
        analysis_duration_ms: 100,
        thinking_tokens_original: 200,
        thinking_tokens_analyzed: 200,
        truncated: false,
        extraction_confidence: 1.0,
      },
      linked_trace_id: null,
    };

    const mockCheckpoint2 = {
      ...mockCheckpoint1,
      checkpoint_id: "ic-test-2",
      window_position: { index: 1, window_size: 2 },
    };

    const client = createClient(
      makeConfig({ initial_checkpoints: [mockCheckpoint1, mockCheckpoint2] }),
    );

    const state = client.getWindowState();
    expect(state.size).toBe(2);
    expect(state.checkpoints.length).toBe(2);
    expect(state.checkpoints[0]!.checkpoint_id).toBe("ic-test-1");
    expect(state.checkpoints[1]!.checkpoint_id).toBe("ic-test-2");
  });
});
