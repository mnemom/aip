import { describe, it, expect } from "vitest";
import { WindowManager } from "../../src/window/manager.js";
import type { IntegrityCheckpoint } from "../../src/schemas/checkpoint.js";
import type { WindowConfig } from "../../src/schemas/config.js";
import type { IntegrityVerdict } from "../../src/schemas/checkpoint.js";

/** Create a minimal valid IntegrityCheckpoint for testing. */
function makeCheckpoint(
  overrides: {
    verdict?: IntegrityVerdict;
    timestamp?: string;
    session_id?: string;
    reasoning_summary?: string;
    analysis_duration_ms?: number;
  } = {}
): IntegrityCheckpoint {
  return {
    checkpoint_id: `ic-${crypto.randomUUID()}`,
    agent_id: "test-agent",
    card_id: "card-001",
    session_id: overrides.session_id ?? "session-1",
    timestamp: overrides.timestamp ?? new Date().toISOString(),
    thinking_block_hash: "sha256-abc123",
    provider: "anthropic",
    model: "claude-3-5-sonnet",
    verdict: overrides.verdict ?? "clear",
    concerns: [],
    reasoning_summary:
      overrides.reasoning_summary ?? "No concerns identified.",
    conscience_context: {
      values_checked: [],
      conflicts: [],
      supports: [],
      considerations: [],
      consultation_depth: "standard",
    },
    window_position: { index: 0, window_size: 1 },
    analysis_metadata: {
      analysis_model: "claude-3-5-haiku-20241022",
      analysis_duration_ms: overrides.analysis_duration_ms ?? 100,
      thinking_tokens_original: 500,
      thinking_tokens_analyzed: 500,
      truncated: false,
      extraction_confidence: 1.0,
    },
    linked_trace_id: null,
  };
}

/** Default sliding window config for tests. */
function defaultConfig(
  overrides: Partial<WindowConfig> = {}
): WindowConfig {
  return {
    max_size: 5,
    mode: "sliding",
    session_boundary: "reset",
    max_age_seconds: 3600,
    ...overrides,
  };
}

describe("WindowManager", () => {
  describe("constructor", () => {
    it("throws if max_size < MIN_WINDOW_SIZE (3)", () => {
      expect(
        () => new WindowManager(defaultConfig({ max_size: 2 }), "session-1")
      ).toThrow("Window max_size must be >= 3, got 2");
    });

    it("accepts max_size equal to MIN_WINDOW_SIZE", () => {
      expect(
        () => new WindowManager(defaultConfig({ max_size: 3 }), "session-1")
      ).not.toThrow();
    });
  });

  describe("push (basic)", () => {
    it("pushing a checkpoint increases size", () => {
      const wm = new WindowManager(defaultConfig(), "session-1");
      wm.push(makeCheckpoint());
      const state = wm.getState();
      expect(state.size).toBe(1);
      expect(state.checkpoints).toHaveLength(1);
      expect(state.stats.total_checks).toBe(1);
    });
  });

  describe("push (sliding eviction)", () => {
    it("evicts oldest checkpoint when window exceeds max_size in sliding mode", () => {
      const wm = new WindowManager(
        defaultConfig({ max_size: 3, mode: "sliding" }),
        "session-1"
      );

      const cp1 = makeCheckpoint({ reasoning_summary: "First" });
      const cp2 = makeCheckpoint({ reasoning_summary: "Second" });
      const cp3 = makeCheckpoint({ reasoning_summary: "Third" });
      const cp4 = makeCheckpoint({ reasoning_summary: "Fourth" });

      wm.push(cp1);
      wm.push(cp2);
      wm.push(cp3);
      wm.push(cp4);

      const state = wm.getState();
      expect(state.size).toBe(3);
      expect(state.checkpoints[0]!.reasoning_summary).toBe("Second");
      expect(state.checkpoints[1]!.reasoning_summary).toBe("Third");
      expect(state.checkpoints[2]!.reasoning_summary).toBe("Fourth");
      expect(state.stats.total_checks).toBe(4);
    });
  });

  describe("push (fixed mode)", () => {
    it("resets window entirely when max_size is reached in fixed mode", () => {
      const wm = new WindowManager(
        defaultConfig({ max_size: 3, mode: "fixed" }),
        "session-1"
      );

      const cp1 = makeCheckpoint({ reasoning_summary: "First" });
      const cp2 = makeCheckpoint({ reasoning_summary: "Second" });
      const cp3 = makeCheckpoint({ reasoning_summary: "Third" });
      const cp4 = makeCheckpoint({ reasoning_summary: "Fourth" });

      wm.push(cp1);
      wm.push(cp2);
      wm.push(cp3);
      // Window is full (3). Next push triggers reset then insert.
      wm.push(cp4);

      const state = wm.getState();
      expect(state.size).toBe(1);
      expect(state.checkpoints[0]!.reasoning_summary).toBe("Fourth");
      expect(state.stats.total_checks).toBe(4);
    });
  });

  describe("push (max_age eviction)", () => {
    it("evicts checkpoints older than max_age_seconds", () => {
      const wm = new WindowManager(
        defaultConfig({ max_size: 5, max_age_seconds: 60 }),
        "session-1"
      );

      // Create a checkpoint with a timestamp 120 seconds in the past
      const oldTimestamp = new Date(Date.now() - 120_000).toISOString();
      const oldCp = makeCheckpoint({
        timestamp: oldTimestamp,
        reasoning_summary: "Old",
      });
      const freshCp = makeCheckpoint({ reasoning_summary: "Fresh" });

      wm.push(oldCp);
      expect(wm.getState().size).toBe(1);

      // Pushing a new checkpoint triggers stale eviction first
      wm.push(freshCp);

      const state = wm.getState();
      expect(state.size).toBe(1);
      expect(state.checkpoints[0]!.reasoning_summary).toBe("Fresh");
    });
  });

  describe("push (session boundary reset)", () => {
    it("resets window when session_id changes and mode is 'reset'", () => {
      const wm = new WindowManager(
        defaultConfig({ session_boundary: "reset" }),
        "session-1"
      );

      wm.push(makeCheckpoint({ session_id: "session-1" }));
      wm.push(makeCheckpoint({ session_id: "session-1" }));
      expect(wm.getState().size).toBe(2);

      // Push with different session_id triggers reset
      wm.push(makeCheckpoint({ session_id: "session-2" }));

      const state = wm.getState();
      expect(state.size).toBe(1);
      expect(wm.getSessionId()).toBe("session-2");
    });
  });

  describe("push (session boundary carry)", () => {
    it("preserves window when session_id changes and mode is 'carry'", () => {
      const wm = new WindowManager(
        defaultConfig({ session_boundary: "carry" }),
        "session-1"
      );

      wm.push(makeCheckpoint({ session_id: "session-1" }));
      wm.push(makeCheckpoint({ session_id: "session-1" }));
      expect(wm.getState().size).toBe(2);

      // Push with different session_id does NOT reset
      wm.push(makeCheckpoint({ session_id: "session-2" }));

      const state = wm.getState();
      expect(state.size).toBe(3);
      expect(wm.getSessionId()).toBe("session-2");
    });
  });

  describe("getContext", () => {
    it("returns 'First check in session' when window is empty", () => {
      const wm = new WindowManager(defaultConfig(), "session-1");
      expect(wm.getContext()).toBe(
        "SESSION CONTEXT: First check in session (no prior context)"
      );
    });

    it("returns numbered verdict list with checkpoints", () => {
      const wm = new WindowManager(defaultConfig(), "session-1");
      wm.push(
        makeCheckpoint({
          verdict: "clear",
          reasoning_summary: "All good",
        })
      );
      wm.push(
        makeCheckpoint({
          verdict: "review_needed",
          reasoning_summary: "Minor concern",
        })
      );

      const context = wm.getContext();
      expect(context).toContain("SESSION CONTEXT (window: 2/5):");
      expect(context).toContain("1. [clear] All good");
      expect(context).toContain("2. [review_needed] Minor concern");
    });
  });

  describe("getSummary", () => {
    it("returns correct verdict counts and integrity_ratio", () => {
      const wm = new WindowManager(defaultConfig(), "session-1");
      wm.push(makeCheckpoint({ verdict: "clear" }));
      wm.push(makeCheckpoint({ verdict: "clear" }));
      wm.push(makeCheckpoint({ verdict: "review_needed" }));
      wm.push(makeCheckpoint({ verdict: "boundary_violation" }));

      const summary = wm.getSummary();
      expect(summary.size).toBe(4);
      expect(summary.max_size).toBe(5);
      expect(summary.verdicts.clear).toBe(2);
      expect(summary.verdicts.review_needed).toBe(1);
      expect(summary.verdicts.boundary_violation).toBe(1);
      expect(summary.integrity_ratio).toBe(0.5);
      expect(summary.drift_alert_active).toBe(false);
    });

    it("returns integrity_ratio of 1.0 for empty window", () => {
      const wm = new WindowManager(defaultConfig(), "session-1");
      const summary = wm.getSummary();
      expect(summary.size).toBe(0);
      expect(summary.integrity_ratio).toBe(1.0);
      expect(summary.verdicts.clear).toBe(0);
      expect(summary.verdicts.review_needed).toBe(0);
      expect(summary.verdicts.boundary_violation).toBe(0);
    });
  });

  describe("reset", () => {
    it("clears checkpoints and stats", () => {
      const wm = new WindowManager(defaultConfig(), "session-1");
      wm.push(makeCheckpoint({ verdict: "clear" }));
      wm.push(makeCheckpoint({ verdict: "review_needed" }));
      expect(wm.getState().size).toBe(2);

      wm.reset();

      const state = wm.getState();
      expect(state.size).toBe(0);
      expect(state.checkpoints).toHaveLength(0);
      expect(state.stats.total_checks).toBe(0);
      expect(state.stats.clear_count).toBe(0);
      expect(state.stats.review_count).toBe(0);
      expect(state.stats.violation_count).toBe(0);
      expect(state.stats.avg_analysis_ms).toBe(0);
    });
  });

  describe("stats", () => {
    it("computes avg_analysis_ms across window checkpoints", () => {
      const wm = new WindowManager(defaultConfig(), "session-1");
      wm.push(makeCheckpoint({ analysis_duration_ms: 100 }));
      wm.push(makeCheckpoint({ analysis_duration_ms: 200 }));
      wm.push(makeCheckpoint({ analysis_duration_ms: 300 }));

      const state = wm.getState();
      expect(state.stats.avg_analysis_ms).toBe(200);
    });
  });
});
