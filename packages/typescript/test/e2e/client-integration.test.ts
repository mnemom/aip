/**
 * End-to-end integration tests for the AIP client.
 *
 * Tests the full check() lifecycle with mocked fetch, covering
 * multi-check sessions, state accumulation, drift detection,
 * callback ordering, provider auto-detection, failure recovery,
 * and HMAC signing round-trips.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createClient } from "../../src/sdk/client.js";
import type { AIPClient } from "../../src/sdk/client.js";
import type { AIPConfig } from "../../src/schemas/config.js";
import type { IntegritySignal } from "../../src/schemas/signal.js";
import type { IntegrityDriftAlert } from "../../src/schemas/drift-alert.js";
import { FULL_CARD, FORBIDDEN_ACTIONS_CARD } from "../fixtures/cards.js";
import {
  ANTHROPIC_JSON_WITH_THINKING,
  ANTHROPIC_JSON_NO_THINKING,
  OPENAI_JSON_WITH_REASONING,
} from "../fixtures/responses.js";
import {
  VERDICT_CLEAR,
  VERDICT_REVIEW_NEEDED,
  VERDICT_BOUNDARY_INJECTION,
  VERDICT_BOUNDARY_DECEPTION,
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

function mockFetchWithVerdict(verdict: object) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          content: [{ type: "text", text: JSON.stringify(verdict) }],
        }),
      text: () =>
        Promise.resolve(
          JSON.stringify({
            content: [{ type: "text", text: JSON.stringify(verdict) }],
          }),
        ),
    }),
  );
}

function mockFetchSequence(verdicts: object[]) {
  let callIndex = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation(() => {
      const verdict = verdicts[callIndex] ?? verdicts[verdicts.length - 1];
      callIndex++;
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            content: [{ type: "text", text: JSON.stringify(verdict) }],
          }),
        text: () =>
          Promise.resolve(
            JSON.stringify({
              content: [{ type: "text", text: JSON.stringify(verdict) }],
            }),
          ),
      });
    }),
  );
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Scenario 1: Multi-check session with state accumulation
// ---------------------------------------------------------------------------

describe("Scenario 1: Multi-check session with state accumulation", () => {
  it("accumulates window state across 3 sequential checks", async () => {
    mockFetchSequence([VERDICT_CLEAR, VERDICT_CLEAR, VERDICT_REVIEW_NEEDED]);
    const client = createClient(makeConfig());

    // First check — clear
    const signal1 = await client.check(ANTHROPIC_JSON_WITH_THINKING);
    expect(signal1.window_summary.size).toBe(1);
    expect(signal1.window_summary.integrity_ratio).toBe(1.0);
    expect(signal1.window_summary.verdicts.clear).toBe(1);
    expect(signal1.window_summary.verdicts.review_needed).toBe(0);
    expect(signal1.checkpoint.verdict).toBe("clear");

    // Second check — clear
    const signal2 = await client.check(ANTHROPIC_JSON_WITH_THINKING);
    expect(signal2.window_summary.size).toBe(2);
    expect(signal2.window_summary.integrity_ratio).toBe(1.0);
    expect(signal2.window_summary.verdicts.clear).toBe(2);
    expect(signal2.window_summary.verdicts.review_needed).toBe(0);
    expect(signal2.checkpoint.verdict).toBe("clear");

    // Third check — review_needed
    const signal3 = await client.check(ANTHROPIC_JSON_WITH_THINKING);
    expect(signal3.window_summary.size).toBe(3);
    expect(signal3.window_summary.verdicts.clear).toBe(2);
    expect(signal3.window_summary.verdicts.review_needed).toBe(1);
    // integrity_ratio = 2/3 ≈ 0.667
    expect(signal3.window_summary.integrity_ratio).toBeCloseTo(2 / 3, 3);
    expect(signal3.checkpoint.verdict).toBe("review_needed");
  });

  it("window_position.index increments with each check", async () => {
    mockFetchSequence([VERDICT_CLEAR, VERDICT_CLEAR, VERDICT_CLEAR]);
    const client = createClient(makeConfig());

    const s1 = await client.check(ANTHROPIC_JSON_WITH_THINKING);
    const s2 = await client.check(ANTHROPIC_JSON_WITH_THINKING);
    const s3 = await client.check(ANTHROPIC_JSON_WITH_THINKING);

    // window_position.index is set to the windowState.size at the time
    // of building the checkpoint (before push), so they are 0-indexed
    // relative to the window at checkpoint creation time.
    expect(s1.checkpoint.window_position.index).toBe(0);
    expect(s2.checkpoint.window_position.index).toBe(1);
    expect(s3.checkpoint.window_position.index).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Scenario 2: Drift alert fires after 3 non-clear checks
// ---------------------------------------------------------------------------

describe("Scenario 2: Drift alert fires after 3 non-clear checks", () => {
  it("fires on_drift_alert exactly once on the 3rd non-clear check", async () => {
    const onDriftAlert = vi.fn();
    const onVerdict = vi.fn();
    const client = createClient(
      makeConfig({
        callbacks: {
          on_drift_alert: onDriftAlert,
          on_verdict: onVerdict,
        },
      }),
    );
    mockFetchSequence([
      VERDICT_REVIEW_NEEDED,
      VERDICT_REVIEW_NEEDED,
      VERDICT_REVIEW_NEEDED,
    ]);

    await client.check(ANTHROPIC_JSON_WITH_THINKING);
    expect(onDriftAlert).not.toHaveBeenCalled();

    await client.check(ANTHROPIC_JSON_WITH_THINKING);
    expect(onDriftAlert).not.toHaveBeenCalled();

    await client.check(ANTHROPIC_JSON_WITH_THINKING);
    expect(onDriftAlert).toHaveBeenCalledTimes(1);

    // Verify the alert structure
    const alert: IntegrityDriftAlert = onDriftAlert.mock.calls[0][0];
    expect(alert.sustained_checks).toBe(3);
    expect(alert.alert_type).toBe("informative");
    expect(alert.checkpoint_ids).toHaveLength(3);
    expect(alert.alert_id).toMatch(/^ida-/);
    expect(alert.detection_timestamp).toBeTruthy();
  });

  it("does not fire a second drift alert on 4th non-clear check (same streak)", async () => {
    const onDriftAlert = vi.fn();
    const client = createClient(
      makeConfig({
        callbacks: { on_drift_alert: onDriftAlert },
      }),
    );
    mockFetchSequence([
      VERDICT_REVIEW_NEEDED,
      VERDICT_REVIEW_NEEDED,
      VERDICT_REVIEW_NEEDED,
      VERDICT_REVIEW_NEEDED,
    ]);

    for (let i = 0; i < 4; i++) {
      await client.check(ANTHROPIC_JSON_WITH_THINKING);
    }

    // Alert fires only on the 3rd, not again on the 4th
    expect(onDriftAlert).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Scenario 3: Drift resets after clear verdict
// ---------------------------------------------------------------------------

describe("Scenario 3: Drift resets after clear verdict", () => {
  it("clear verdict at position 3 resets streak; drift fires on 6th check", async () => {
    const onDriftAlert = vi.fn();
    const client = createClient(
      makeConfig({
        callbacks: { on_drift_alert: onDriftAlert },
      }),
    );
    mockFetchSequence([
      VERDICT_REVIEW_NEEDED, // 1 — streak = 1
      VERDICT_REVIEW_NEEDED, // 2 — streak = 2
      VERDICT_CLEAR, // 3 — streak resets to 0
      VERDICT_REVIEW_NEEDED, // 4 — streak = 1
      VERDICT_REVIEW_NEEDED, // 5 — streak = 2
      VERDICT_REVIEW_NEEDED, // 6 — streak = 3 -> alert fires
    ]);

    for (let i = 0; i < 6; i++) {
      await client.check(ANTHROPIC_JSON_WITH_THINKING);
    }

    // Drift alert should fire exactly once — on the 6th check (not the 3rd)
    expect(onDriftAlert).toHaveBeenCalledTimes(1);

    const alert: IntegrityDriftAlert = onDriftAlert.mock.calls[0][0];
    expect(alert.sustained_checks).toBe(3);
    // Checkpoint IDs in the alert should be from checks 4, 5, 6 (the second streak)
    expect(alert.checkpoint_ids).toHaveLength(3);
  });

  it("multiple clear resets: no alert with pattern [R, R, C, R, R, C]", async () => {
    const onDriftAlert = vi.fn();
    const client = createClient(
      makeConfig({
        callbacks: { on_drift_alert: onDriftAlert },
      }),
    );
    mockFetchSequence([
      VERDICT_REVIEW_NEEDED,
      VERDICT_REVIEW_NEEDED,
      VERDICT_CLEAR,
      VERDICT_REVIEW_NEEDED,
      VERDICT_REVIEW_NEEDED,
      VERDICT_CLEAR,
    ]);

    for (let i = 0; i < 6; i++) {
      await client.check(ANTHROPIC_JSON_WITH_THINKING);
    }

    // Streak never reaches 3 — alert should never fire
    expect(onDriftAlert).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Scenario 4: Callback ordering — on_verdict before on_drift_alert
// ---------------------------------------------------------------------------

describe("Scenario 4: Callback ordering", () => {
  it("on_verdict is called before on_drift_alert on the 3rd check", async () => {
    const callOrder: string[] = [];

    const onVerdict = vi.fn().mockImplementation(() => {
      callOrder.push("on_verdict");
    });
    const onDriftAlert = vi.fn().mockImplementation(() => {
      callOrder.push("on_drift_alert");
    });

    const client = createClient(
      makeConfig({
        callbacks: {
          on_verdict: onVerdict,
          on_drift_alert: onDriftAlert,
        },
      }),
    );
    mockFetchSequence([
      VERDICT_REVIEW_NEEDED,
      VERDICT_REVIEW_NEEDED,
      VERDICT_REVIEW_NEEDED,
    ]);

    // First two checks: only on_verdict fires
    await client.check(ANTHROPIC_JSON_WITH_THINKING);
    await client.check(ANTHROPIC_JSON_WITH_THINKING);

    expect(callOrder).toEqual(["on_verdict", "on_verdict"]);

    // Third check: both fire, on_verdict first
    await client.check(ANTHROPIC_JSON_WITH_THINKING);

    expect(callOrder).toEqual([
      "on_verdict",
      "on_verdict",
      "on_verdict",
      "on_drift_alert",
    ]);

    expect(onVerdict).toHaveBeenCalledTimes(3);
    expect(onDriftAlert).toHaveBeenCalledTimes(1);
  });

  it("on_verdict receives the signal and on_drift_alert receives the alert", async () => {
    let verdictSignal: IntegritySignal | undefined;
    let driftAlert: IntegrityDriftAlert | undefined;

    const client = createClient(
      makeConfig({
        callbacks: {
          on_verdict: (signal) => {
            verdictSignal = signal;
          },
          on_drift_alert: (alert) => {
            driftAlert = alert;
          },
        },
      }),
    );
    mockFetchSequence([
      VERDICT_REVIEW_NEEDED,
      VERDICT_REVIEW_NEEDED,
      VERDICT_REVIEW_NEEDED,
    ]);

    for (let i = 0; i < 3; i++) {
      await client.check(ANTHROPIC_JSON_WITH_THINKING);
    }

    expect(verdictSignal).toBeDefined();
    expect(verdictSignal!.checkpoint.verdict).toBe("review_needed");

    expect(driftAlert).toBeDefined();
    expect(driftAlert!.sustained_checks).toBe(3);
    expect(driftAlert!.agent_id).toBe(FULL_CARD.card_id);
  });
});

// ---------------------------------------------------------------------------
// Scenario 5: No thinking block — fast path
// ---------------------------------------------------------------------------

describe("Scenario 5: No thinking block fast path", () => {
  it("returns synthetic clear without calling fetch", async () => {
    // Set up a spy on fetch that should NOT be called
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const client = createClient(makeConfig());

    const signal = await client.check(ANTHROPIC_JSON_NO_THINKING);

    expect(signal.proceed).toBe(true);
    expect(signal.recommended_action).toBe("continue");
    expect(signal.checkpoint.verdict).toBe("clear");
    expect(signal.checkpoint.thinking_block_hash).toBe("none");
    expect(signal.checkpoint.reasoning_summary).toContain(
      "No thinking block found",
    );

    // fetch should NOT have been called — no analysis needed
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("synthetic signals do not enter the window", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const client = createClient(makeConfig());

    await client.check(ANTHROPIC_JSON_NO_THINKING);
    await client.check(ANTHROPIC_JSON_NO_THINKING);
    await client.check(ANTHROPIC_JSON_NO_THINKING);

    // Window should remain empty — synthetic signals are not pushed
    const state = client.getWindowState();
    expect(state.size).toBe(0);
    expect(state.checkpoints).toEqual([]);
    expect(state.stats.total_checks).toBe(0);

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("synthetic signal window_summary reflects empty window", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const client = createClient(makeConfig());

    const signal = await client.check(ANTHROPIC_JSON_NO_THINKING);

    // Summary should show an empty window state
    expect(signal.window_summary.size).toBe(0);
    expect(signal.window_summary.integrity_ratio).toBe(1.0);
  });
});

// ---------------------------------------------------------------------------
// Scenario 6: Provider auto-detection from base_url
// ---------------------------------------------------------------------------

describe("Scenario 6: Provider auto-detection from base_url", () => {
  it("detects Anthropic adapter from anthropic base_url", async () => {
    mockFetchWithVerdict(VERDICT_CLEAR);

    const client = createClient(
      makeConfig({
        analysis_llm: {
          model: "claude-3-5-haiku-20241022",
          base_url: "https://api.anthropic.com",
          api_key: "test-key",
          max_tokens: 1024,
        },
      }),
    );

    const signal = await client.check(ANTHROPIC_JSON_WITH_THINKING);

    expect(signal.checkpoint.verdict).toBe("clear");
    expect(signal.checkpoint.provider).toBe("anthropic");
    expect(signal.proceed).toBe(true);
  });

  it("detects OpenAI adapter from openai base_url", async () => {
    mockFetchWithVerdict(VERDICT_CLEAR);

    const client = createClient(
      makeConfig({
        analysis_llm: {
          model: "claude-3-5-haiku-20241022",
          base_url: "https://api.openai.com",
          api_key: "test-key",
          max_tokens: 1024,
        },
      }),
    );

    const signal = await client.check(OPENAI_JSON_WITH_REASONING);

    expect(signal.checkpoint.verdict).toBe("clear");
    expect(signal.checkpoint.provider).toBe("openai");
    expect(signal.proceed).toBe(true);
  });

  it("both providers produce valid signals with correct model field", async () => {
    mockFetchWithVerdict(VERDICT_CLEAR);

    // Anthropic
    const anthropicClient = createClient(
      makeConfig({
        analysis_llm: {
          model: "claude-3-5-haiku-20241022",
          base_url: "https://api.anthropic.com",
          api_key: "test-key",
          max_tokens: 1024,
        },
      }),
    );
    const anthropicSignal = await anthropicClient.check(
      ANTHROPIC_JSON_WITH_THINKING,
    );
    expect(anthropicSignal.checkpoint.model).toBe("claude-sonnet-4-5-20250514");

    // OpenAI (re-mock fetch since it was consumed)
    mockFetchWithVerdict(VERDICT_CLEAR);
    const openaiClient = createClient(
      makeConfig({
        analysis_llm: {
          model: "claude-3-5-haiku-20241022",
          base_url: "https://api.openai.com",
          api_key: "test-key",
          max_tokens: 1024,
        },
      }),
    );
    const openaiSignal = await openaiClient.check(OPENAI_JSON_WITH_REASONING);
    expect(openaiSignal.checkpoint.model).toBe("o1-preview");
  });
});

// ---------------------------------------------------------------------------
// Scenario 7: Explicit provider override
// ---------------------------------------------------------------------------

describe("Scenario 7: Explicit provider override", () => {
  it("uses explicitly specified provider instead of auto-detecting", async () => {
    mockFetchWithVerdict(VERDICT_CLEAR);

    const client = createClient(makeConfig());

    const signal = await client.check(
      ANTHROPIC_JSON_WITH_THINKING,
      "anthropic",
    );

    expect(signal.checkpoint.provider).toBe("anthropic");
    expect(signal.checkpoint.verdict).toBe("clear");
  });

  it("explicit provider produces a valid checkpoint with all required fields", async () => {
    mockFetchWithVerdict(VERDICT_CLEAR);

    const client = createClient(makeConfig());
    const signal = await client.check(
      ANTHROPIC_JSON_WITH_THINKING,
      "anthropic",
    );

    // Verify all checkpoint fields are present
    expect(signal.checkpoint.checkpoint_id).toMatch(/^ic-/);
    expect(signal.checkpoint.agent_id).toBe(FULL_CARD.card_id);
    expect(signal.checkpoint.card_id).toBe(FULL_CARD.card_id);
    expect(signal.checkpoint.session_id).toBeTruthy();
    expect(signal.checkpoint.timestamp).toBeTruthy();
    expect(signal.checkpoint.thinking_block_hash).toBeTruthy();
    expect(signal.checkpoint.thinking_block_hash).not.toBe("none");
    expect(signal.checkpoint.concerns).toEqual([]);
    expect(signal.checkpoint.conscience_context).toBeDefined();
    expect(signal.checkpoint.analysis_metadata).toBeDefined();
    expect(signal.checkpoint.analysis_metadata.analysis_model).toBe(
      "claude-3-5-haiku-20241022",
    );
  });
});

// ---------------------------------------------------------------------------
// Scenario 8: Window reset clears drift state
// ---------------------------------------------------------------------------

describe("Scenario 8: Window reset clears drift state", () => {
  it("resetWindow clears the non-clear streak", async () => {
    const onDriftAlert = vi.fn();
    const client = createClient(
      makeConfig({
        callbacks: { on_drift_alert: onDriftAlert },
      }),
    );
    mockFetchSequence([
      VERDICT_REVIEW_NEEDED, // streak = 1
      VERDICT_REVIEW_NEEDED, // streak = 2
      // -- resetWindow here --
      VERDICT_REVIEW_NEEDED, // streak = 1 (reset)
      VERDICT_REVIEW_NEEDED, // streak = 2
    ]);

    // Two non-clear checks
    await client.check(ANTHROPIC_JSON_WITH_THINKING);
    await client.check(ANTHROPIC_JSON_WITH_THINKING);
    expect(onDriftAlert).not.toHaveBeenCalled();

    // Reset — clears window AND drift state
    client.resetWindow();

    // Two more non-clear checks
    await client.check(ANTHROPIC_JSON_WITH_THINKING);
    await client.check(ANTHROPIC_JSON_WITH_THINKING);

    // Streak is only 2, not 4 — so no drift alert
    expect(onDriftAlert).not.toHaveBeenCalled();
  });

  it("resetWindow also clears the window checkpoints", async () => {
    mockFetchSequence([VERDICT_CLEAR, VERDICT_CLEAR]);
    const client = createClient(makeConfig());

    await client.check(ANTHROPIC_JSON_WITH_THINKING);
    await client.check(ANTHROPIC_JSON_WITH_THINKING);
    expect(client.getWindowState().size).toBe(2);

    client.resetWindow();

    const state = client.getWindowState();
    expect(state.size).toBe(0);
    expect(state.checkpoints).toEqual([]);
    expect(state.stats.total_checks).toBe(0);
  });

  it("drift alert fires after reset + 3 new non-clear checks", async () => {
    const onDriftAlert = vi.fn();
    const client = createClient(
      makeConfig({
        callbacks: { on_drift_alert: onDriftAlert },
      }),
    );
    mockFetchSequence([
      VERDICT_REVIEW_NEEDED, // streak = 1
      VERDICT_REVIEW_NEEDED, // streak = 2
      // -- resetWindow here --
      VERDICT_REVIEW_NEEDED, // streak = 1
      VERDICT_REVIEW_NEEDED, // streak = 2
      VERDICT_REVIEW_NEEDED, // streak = 3 -> alert
    ]);

    await client.check(ANTHROPIC_JSON_WITH_THINKING);
    await client.check(ANTHROPIC_JSON_WITH_THINKING);
    client.resetWindow();

    await client.check(ANTHROPIC_JSON_WITH_THINKING);
    await client.check(ANTHROPIC_JSON_WITH_THINKING);
    await client.check(ANTHROPIC_JSON_WITH_THINKING);

    expect(onDriftAlert).toHaveBeenCalledTimes(1);
    const alert: IntegrityDriftAlert = onDriftAlert.mock.calls[0][0];
    expect(alert.sustained_checks).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Scenario 9: Concurrent error + recovery
// ---------------------------------------------------------------------------

describe("Scenario 9: Error recovery with fail_open", () => {
  it("first check fails open with synthetic clear, second check succeeds normally", async () => {
    let callCount = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.reject(new Error("Network failure"));
        }
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              content: [
                { type: "text", text: JSON.stringify(VERDICT_CLEAR) },
              ],
            }),
          text: () =>
            Promise.resolve(
              JSON.stringify({
                content: [
                  { type: "text", text: JSON.stringify(VERDICT_CLEAR) },
                ],
              }),
            ),
        });
      }),
    );

    const onError = vi.fn();
    const client = createClient(
      makeConfig({
        failure_policy: { mode: "fail_open", analysis_timeout_ms: 5000 },
        callbacks: { on_error: onError },
      }),
    );

    // First check: fetch throws -> fail_open -> synthetic clear
    const signal1 = await client.check(ANTHROPIC_JSON_WITH_THINKING);
    expect(signal1.checkpoint.verdict).toBe("clear");
    expect(signal1.proceed).toBe(true);
    expect(signal1.checkpoint.thinking_block_hash).toBe("none");
    expect(signal1.checkpoint.reasoning_summary).toContain("fail-open");

    // on_error should have been called
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0].message).toBe("Network failure");

    // Second check: fetch succeeds -> real signal
    const signal2 = await client.check(ANTHROPIC_JSON_WITH_THINKING);
    expect(signal2.checkpoint.verdict).toBe("clear");
    expect(signal2.proceed).toBe(true);
    expect(signal2.checkpoint.thinking_block_hash).not.toBe("none");

    // Synthetic signals do NOT enter the window.
    // Only the real checkpoint from the second check should be in the window.
    const state = client.getWindowState();
    expect(state.size).toBe(1);
    expect(state.checkpoints).toHaveLength(1);
    expect(state.checkpoints[0].thinking_block_hash).not.toBe("none");
  });

  it("fail_closed: error returns synthetic boundary_violation", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("Server unavailable")),
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
    expect(signal.checkpoint.reasoning_summary).toContain("fail-closed");
  });

  it("on_error is not called when no callback is configured", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("Network error")),
    );

    const client = createClient(
      makeConfig({
        failure_policy: { mode: "fail_open", analysis_timeout_ms: 5000 },
        // No callbacks configured
      }),
    );

    // Should not throw despite error
    const signal = await client.check(ANTHROPIC_JSON_WITH_THINKING);
    expect(signal.checkpoint.verdict).toBe("clear");
  });
});

// ---------------------------------------------------------------------------
// Scenario 10: HMAC signing round-trip
// ---------------------------------------------------------------------------

describe("Scenario 10: HMAC signing round-trip", () => {
  // Import the signing functions (dynamic import to avoid hoisting issues)
  let signPayload: (secret: string, payload: string) => string;
  let verifySignature: (
    secret: string,
    payload: string,
    signature: string,
  ) => boolean;

  beforeEach(async () => {
    const httpModule = await import("../../src/sdk/http.js");
    signPayload = httpModule.signPayload;
    verifySignature = httpModule.verifySignature;
  });

  it("sign + verify with correct secret succeeds", () => {
    const secret = "webhook-secret-key-12345";
    const payload = JSON.stringify({
      checkpoint: {
        checkpoint_id: "ic-test-001",
        agent_id: "ac-test-full",
        card_id: "ac-test-full",
        session_id: "sess-test-001",
        timestamp: "2025-01-01T00:00:00.000Z",
        thinking_block_hash: "abc123",
        provider: "anthropic",
        model: "claude-sonnet-4-5-20250514",
        verdict: "clear",
        concerns: [],
        reasoning_summary: "Agent reasoning is aligned.",
        conscience_context: {
          values_checked: ["helpfulness", "safety"],
          conflicts: [],
          supports: ["helpfulness"],
          considerations: [],
          consultation_depth: "surface",
        },
        window_position: { index: 0, window_size: 1 },
        analysis_metadata: {
          analysis_model: "claude-3-5-haiku-20241022",
          analysis_duration_ms: 150,
          thinking_tokens_original: 50,
          thinking_tokens_analyzed: 50,
          truncated: false,
          extraction_confidence: 1.0,
        },
        linked_trace_id: null,
      },
      proceed: true,
      recommended_action: "continue",
      window_summary: {
        size: 1,
        max_size: 10,
        verdicts: { clear: 1, review_needed: 0, boundary_violation: 0 },
        integrity_ratio: 1.0,
        drift_alert_active: false,
      },
    });

    const signature = signPayload(secret, payload);
    expect(signature).toMatch(/^sha256=[a-f0-9]{64}$/);

    const isValid = verifySignature(secret, payload, signature);
    expect(isValid).toBe(true);
  });

  it("verify with wrong secret fails", () => {
    const secret = "correct-secret";
    const wrongSecret = "wrong-secret";
    const payload = JSON.stringify({ verdict: "clear", data: "test-payload" });

    const signature = signPayload(secret, payload);
    const isValid = verifySignature(wrongSecret, payload, signature);
    expect(isValid).toBe(false);
  });

  it("verify with tampered payload fails", () => {
    const secret = "test-secret";
    const originalPayload = JSON.stringify({
      verdict: "clear",
      proceed: true,
    });
    const tamperedPayload = JSON.stringify({
      verdict: "clear",
      proceed: false,
    });

    const signature = signPayload(secret, originalPayload);
    const isValid = verifySignature(secret, tamperedPayload, signature);
    expect(isValid).toBe(false);
  });

  it("sign produces deterministic output for same input", () => {
    const secret = "deterministic-key";
    const payload = '{"test":"data"}';

    const sig1 = signPayload(secret, payload);
    const sig2 = signPayload(secret, payload);
    expect(sig1).toBe(sig2);
  });

  it("sign produces different output for different secrets", () => {
    const payload = '{"test":"data"}';

    const sig1 = signPayload("secret-A", payload);
    const sig2 = signPayload("secret-B", payload);
    expect(sig1).not.toBe(sig2);
  });

  it("handles empty payload correctly", () => {
    const secret = "test-secret";
    const payload = "";

    const signature = signPayload(secret, payload);
    expect(signature).toMatch(/^sha256=[a-f0-9]{64}$/);
    expect(verifySignature(secret, payload, signature)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Additional edge cases
// ---------------------------------------------------------------------------

describe("Edge cases: boundary violation verdicts", () => {
  it("boundary_violation with critical severity maps to deny_and_escalate", async () => {
    mockFetchWithVerdict(VERDICT_BOUNDARY_INJECTION);
    const client = createClient(makeConfig());

    const signal = await client.check(ANTHROPIC_JSON_WITH_THINKING);

    expect(signal.checkpoint.verdict).toBe("boundary_violation");
    expect(signal.proceed).toBe(false);
    expect(signal.recommended_action).toBe("deny_and_escalate");
    expect(signal.checkpoint.concerns.length).toBeGreaterThan(0);
    expect(
      signal.checkpoint.concerns.some((c) => c.severity === "critical"),
    ).toBe(true);
  });

  it("boundary_violation with non-critical severity maps to pause_for_review", async () => {
    mockFetchWithVerdict(VERDICT_BOUNDARY_DECEPTION);
    const client = createClient(makeConfig());

    const signal = await client.check(ANTHROPIC_JSON_WITH_THINKING);

    expect(signal.checkpoint.verdict).toBe("boundary_violation");
    expect(signal.proceed).toBe(false);
    // VERDICT_BOUNDARY_DECEPTION has high severity, not critical
    expect(signal.recommended_action).toBe("pause_for_review");
    expect(signal.checkpoint.concerns.length).toBe(2);
  });
});

describe("Edge cases: destroyed client", () => {
  it("check throws after destroy even with valid response body", async () => {
    mockFetchWithVerdict(VERDICT_CLEAR);
    const client = createClient(makeConfig());

    client.destroy();

    await expect(
      client.check(ANTHROPIC_JSON_WITH_THINKING),
    ).rejects.toThrow("AIP client has been destroyed");
  });

  it("getWindowState still works after destroy", () => {
    const client = createClient(makeConfig());
    client.destroy();

    // getWindowState does not check destroyed flag
    const state = client.getWindowState();
    expect(state.size).toBe(0);
  });
});

describe("Edge cases: mixed verdict types in window", () => {
  it("window tracks all three verdict types correctly", async () => {
    mockFetchSequence([
      VERDICT_CLEAR,
      VERDICT_REVIEW_NEEDED,
      VERDICT_BOUNDARY_INJECTION,
      VERDICT_CLEAR,
    ]);

    const client = createClient(makeConfig());

    await client.check(ANTHROPIC_JSON_WITH_THINKING);
    await client.check(ANTHROPIC_JSON_WITH_THINKING);
    await client.check(ANTHROPIC_JSON_WITH_THINKING);
    const signal4 = await client.check(ANTHROPIC_JSON_WITH_THINKING);

    expect(signal4.window_summary.size).toBe(4);
    expect(signal4.window_summary.verdicts.clear).toBe(2);
    expect(signal4.window_summary.verdicts.review_needed).toBe(1);
    expect(signal4.window_summary.verdicts.boundary_violation).toBe(1);
    expect(signal4.window_summary.integrity_ratio).toBe(0.5);
  });
});

describe("Edge cases: drift_alert_active flag in window_summary", () => {
  it("window_summary.drift_alert_active is true when drift fires", async () => {
    const client = createClient(makeConfig());
    mockFetchSequence([
      VERDICT_REVIEW_NEEDED,
      VERDICT_REVIEW_NEEDED,
      VERDICT_REVIEW_NEEDED,
    ]);

    await client.check(ANTHROPIC_JSON_WITH_THINKING);
    await client.check(ANTHROPIC_JSON_WITH_THINKING);
    const signal3 = await client.check(ANTHROPIC_JSON_WITH_THINKING);

    expect(signal3.window_summary.drift_alert_active).toBe(true);
  });

  it("window_summary.drift_alert_active is false when no drift", async () => {
    const client = createClient(makeConfig());
    mockFetchWithVerdict(VERDICT_CLEAR);

    const signal = await client.check(ANTHROPIC_JSON_WITH_THINKING);

    expect(signal.window_summary.drift_alert_active).toBe(false);
  });
});

describe("Edge cases: fetch called with correct parameters", () => {
  it("sends correct Anthropic API headers and body", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          content: [
            { type: "text", text: JSON.stringify(VERDICT_CLEAR) },
          ],
        }),
      text: () =>
        Promise.resolve(
          JSON.stringify({
            content: [
              { type: "text", text: JSON.stringify(VERDICT_CLEAR) },
            ],
          }),
        ),
    });
    vi.stubGlobal("fetch", fetchSpy);

    const client = createClient(makeConfig());
    await client.check(ANTHROPIC_JSON_WITH_THINKING);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, options] = fetchSpy.mock.calls[0];

    // URL
    expect(url).toBe("https://api.anthropic.com/v1/messages");

    // Headers
    expect(options.method).toBe("POST");
    expect(options.headers["Content-Type"]).toBe("application/json");
    expect(options.headers["x-api-key"]).toBe("test-key");
    expect(options.headers["anthropic-version"]).toBe("2023-06-01");

    // Body
    const body = JSON.parse(options.body);
    expect(body.model).toBe("claude-3-5-haiku-20241022");
    expect(body.max_tokens).toBe(1024);
    expect(body.system).toBeTruthy();
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0].role).toBe("user");
  });
});
