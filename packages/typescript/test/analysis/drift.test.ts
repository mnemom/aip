import { describe, it, expect } from "vitest";
import {
  detectIntegrityDrift,
  createDriftState,
} from "../../src/analysis/drift.js";
import type { DriftState } from "../../src/analysis/drift.js";
import type { IntegrityCheckpoint } from "../../src/schemas/checkpoint.js";
import type { ConcernCategory } from "../../src/schemas/concern.js";

/** Build a minimal checkpoint with required verdict and optional overrides */
function makeCheckpoint(
  overrides: Partial<IntegrityCheckpoint> &
    Pick<IntegrityCheckpoint, "verdict">,
): IntegrityCheckpoint {
  return {
    checkpoint_id: `ic-${Math.random().toString(36).slice(2)}`,
    agent_id: "smolt-test",
    card_id: "ac-test",
    session_id: "sess-test",
    timestamp: new Date().toISOString(),
    thinking_block_hash: "abc123",
    provider: "anthropic",
    model: "claude-sonnet-4-5-20250514",
    concerns: [],
    reasoning_summary: "Test summary",
    conscience_context: {
      values_checked: [],
      conflicts: [],
      supports: [],
      considerations: [],
      consultation_depth: "surface",
    },
    window_position: { index: 0, window_size: 1 },
    analysis_metadata: {
      analysis_model: "haiku",
      analysis_duration_ms: 100,
      thinking_tokens_original: 50,
      thinking_tokens_analyzed: 50,
      truncated: false,
      extraction_confidence: 1.0,
    },
    linked_trace_id: null,
    ...overrides,
  };
}

/** Build a checkpoint with a single concern of the given category */
function makeNonclearCheckpoint(
  category: ConcernCategory,
  checkpointId?: string,
): IntegrityCheckpoint {
  return makeCheckpoint({
    checkpoint_id: checkpointId ?? `ic-${Math.random().toString(36).slice(2)}`,
    verdict: "review_needed",
    concerns: [
      {
        category,
        severity: "medium",
        description: `Test ${category} concern`,
        evidence: "some evidence",
        relevant_card_field: null,
        relevant_conscience_value: null,
      },
    ],
  });
}

describe("detectIntegrityDrift", () => {
  // ── Streak tracking ──────────────────────────────────────────────

  describe("streak tracking", () => {
    it("resets sustained count to 0 on clear verdict", () => {
      let state = createDriftState();

      // Build up a non-clear streak
      const nc1 = makeNonclearCheckpoint("prompt_injection");
      const nc2 = makeNonclearCheckpoint("prompt_injection");
      ({ state } = detectIntegrityDrift(state, nc1, [nc1]));
      ({ state } = detectIntegrityDrift(state, nc2, [nc1, nc2]));
      expect(state.sustainedNonclear).toBe(2);

      // Clear verdict resets
      const clear = makeCheckpoint({ verdict: "clear" });
      ({ state } = detectIntegrityDrift(state, clear, [nc1, nc2, clear]));
      expect(state.sustainedNonclear).toBe(0);
      expect(state.alertFired).toBe(false);
      expect(state.streakCheckpointIds).toHaveLength(0);
      expect(state.streakCategories).toHaveLength(0);
    });

    it("increments sustained count on non-clear verdict", () => {
      let state = createDriftState();

      const nc1 = makeNonclearCheckpoint("value_misalignment");
      ({ state } = detectIntegrityDrift(state, nc1, [nc1]));
      expect(state.sustainedNonclear).toBe(1);

      const nc2 = makeNonclearCheckpoint("value_misalignment");
      ({ state } = detectIntegrityDrift(state, nc2, [nc1, nc2]));
      expect(state.sustainedNonclear).toBe(2);
    });

    it("resets streak after a clear verdict mid-streak", () => {
      let state = createDriftState();

      // Two non-clear
      const nc1 = makeNonclearCheckpoint("prompt_injection");
      const nc2 = makeNonclearCheckpoint("prompt_injection");
      ({ state } = detectIntegrityDrift(state, nc1, [nc1]));
      ({ state } = detectIntegrityDrift(state, nc2, [nc1, nc2]));
      expect(state.sustainedNonclear).toBe(2);

      // Clear resets
      const clear = makeCheckpoint({ verdict: "clear" });
      ({ state } = detectIntegrityDrift(state, clear, []));
      expect(state.sustainedNonclear).toBe(0);

      // New non-clear starts fresh
      const nc3 = makeNonclearCheckpoint("autonomy_violation");
      ({ state } = detectIntegrityDrift(state, nc3, [nc3]));
      expect(state.sustainedNonclear).toBe(1);
    });
  });

  // ── Alert generation ─────────────────────────────────────────────

  describe("alert generation", () => {
    it("does not fire alert below threshold", () => {
      let state = createDriftState();

      const nc1 = makeNonclearCheckpoint("prompt_injection");
      const nc2 = makeNonclearCheckpoint("prompt_injection");

      let alert: ReturnType<typeof detectIntegrityDrift>["alert"];
      ({ state, alert } = detectIntegrityDrift(state, nc1, [nc1]));
      expect(alert).toBeNull();

      ({ state, alert } = detectIntegrityDrift(state, nc2, [nc1, nc2]));
      expect(alert).toBeNull();
      expect(state.sustainedNonclear).toBe(2);
    });

    it("fires alert exactly at threshold (3 consecutive non-clear)", () => {
      let state = createDriftState();

      const nc1 = makeNonclearCheckpoint("prompt_injection");
      const nc2 = makeNonclearCheckpoint("prompt_injection");
      const nc3 = makeNonclearCheckpoint("prompt_injection");

      ({ state } = detectIntegrityDrift(state, nc1, [nc1]));
      ({ state } = detectIntegrityDrift(state, nc2, [nc1, nc2]));

      let alert: ReturnType<typeof detectIntegrityDrift>["alert"];
      ({ state, alert } = detectIntegrityDrift(state, nc3, [nc1, nc2, nc3]));
      expect(alert).not.toBeNull();
      expect(state.alertFired).toBe(true);
    });

    it("fires alert only once per streak (4th non-clear does not fire again)", () => {
      let state = createDriftState();

      const ncs = Array.from({ length: 4 }, () =>
        makeNonclearCheckpoint("prompt_injection"),
      );

      let alert: ReturnType<typeof detectIntegrityDrift>["alert"];
      ({ state } = detectIntegrityDrift(state, ncs[0]!, [ncs[0]!]));
      ({ state } = detectIntegrityDrift(state, ncs[1]!, [ncs[0]!, ncs[1]!]));
      ({ state, alert } = detectIntegrityDrift(state, ncs[2]!, [
        ncs[0]!,
        ncs[1]!,
        ncs[2]!,
      ]));
      expect(alert).not.toBeNull();

      // 4th non-clear should NOT fire another alert
      ({ state, alert } = detectIntegrityDrift(state, ncs[3]!, [
        ncs[0]!,
        ncs[1]!,
        ncs[2]!,
        ncs[3]!,
      ]));
      expect(alert).toBeNull();
      expect(state.sustainedNonclear).toBe(4);
    });

    it("fires a new alert after streak resets and builds up again", () => {
      let state = createDriftState();

      // First streak of 3 -> alert
      const batch1 = Array.from({ length: 3 }, () =>
        makeNonclearCheckpoint("prompt_injection"),
      );
      let alert: ReturnType<typeof detectIntegrityDrift>["alert"];
      ({ state } = detectIntegrityDrift(state, batch1[0]!, [batch1[0]!]));
      ({ state } = detectIntegrityDrift(state, batch1[1]!, [
        batch1[0]!,
        batch1[1]!,
      ]));
      ({ state, alert } = detectIntegrityDrift(state, batch1[2]!, [
        batch1[0]!,
        batch1[1]!,
        batch1[2]!,
      ]));
      expect(alert).not.toBeNull();

      // Clear resets
      const clear = makeCheckpoint({ verdict: "clear" });
      ({ state } = detectIntegrityDrift(state, clear, []));
      expect(state.alertFired).toBe(false);

      // Second streak of 3 -> new alert
      const batch2 = Array.from({ length: 3 }, () =>
        makeNonclearCheckpoint("value_misalignment"),
      );
      ({ state } = detectIntegrityDrift(state, batch2[0]!, [batch2[0]!]));
      ({ state } = detectIntegrityDrift(state, batch2[1]!, [
        batch2[0]!,
        batch2[1]!,
      ]));
      ({ state, alert } = detectIntegrityDrift(state, batch2[2]!, [
        batch2[0]!,
        batch2[1]!,
        batch2[2]!,
      ]));
      expect(alert).not.toBeNull();
    });
  });

  // ── Severity ──────────────────────────────────────────────────────

  describe("severity derivation", () => {
    function triggerAlertWithWindow(
      windowCheckpoints: IntegrityCheckpoint[],
    ): ReturnType<typeof detectIntegrityDrift> {
      let state = createDriftState();

      const ncs = Array.from({ length: 3 }, () =>
        makeNonclearCheckpoint("prompt_injection"),
      );
      ({ state } = detectIntegrityDrift(state, ncs[0]!, windowCheckpoints));
      ({ state } = detectIntegrityDrift(state, ncs[1]!, windowCheckpoints));
      return detectIntegrityDrift(state, ncs[2]!, windowCheckpoints);
    }

    it("assigns severity 'low' when integrity_similarity >= 0.7", () => {
      // 8 clear out of 10 => 0.8
      const window = [
        ...Array.from({ length: 8 }, () =>
          makeCheckpoint({ verdict: "clear" }),
        ),
        ...Array.from({ length: 2 }, () =>
          makeNonclearCheckpoint("prompt_injection"),
        ),
      ];
      const { alert } = triggerAlertWithWindow(window);
      expect(alert).not.toBeNull();
      expect(alert!.severity).toBe("low");
      expect(alert!.integrity_similarity).toBeCloseTo(0.8);
    });

    it("assigns severity 'medium' when integrity_similarity is between 0.4 and 0.7", () => {
      // 5 clear out of 10 => 0.5
      const window = [
        ...Array.from({ length: 5 }, () =>
          makeCheckpoint({ verdict: "clear" }),
        ),
        ...Array.from({ length: 5 }, () =>
          makeNonclearCheckpoint("prompt_injection"),
        ),
      ];
      const { alert } = triggerAlertWithWindow(window);
      expect(alert).not.toBeNull();
      expect(alert!.severity).toBe("medium");
      expect(alert!.integrity_similarity).toBeCloseTo(0.5);
    });

    it("assigns severity 'high' when integrity_similarity < 0.4", () => {
      // 1 clear out of 10 => 0.1
      const window = [
        ...Array.from({ length: 1 }, () =>
          makeCheckpoint({ verdict: "clear" }),
        ),
        ...Array.from({ length: 9 }, () =>
          makeNonclearCheckpoint("prompt_injection"),
        ),
      ];
      const { alert } = triggerAlertWithWindow(window);
      expect(alert).not.toBeNull();
      expect(alert!.severity).toBe("high");
      expect(alert!.integrity_similarity).toBeCloseTo(0.1);
    });
  });

  // ── Direction inference ───────────────────────────────────────────

  describe("direction inference", () => {
    function triggerAlertWithCategories(
      categories: ConcernCategory[],
    ): ReturnType<typeof detectIntegrityDrift> {
      let state = createDriftState();
      const window: IntegrityCheckpoint[] = [];

      // Feed one checkpoint per category so the streak accumulates the categories
      for (let i = 0; i < categories.length; i++) {
        const cp = makeNonclearCheckpoint(categories[i]!);
        window.push(cp);
        const result = detectIntegrityDrift(state, cp, window);
        state = result.state;
        if (result.alert) return result;
      }

      // If categories.length < threshold, pad to reach threshold
      while (state.sustainedNonclear < 3) {
        const lastCat = categories[categories.length - 1]!;
        const cp = makeNonclearCheckpoint(lastCat);
        window.push(cp);
        const result = detectIntegrityDrift(state, cp, window);
        state = result.state;
        if (result.alert) return result;
      }

      return { state, alert: null };
    }

    it("infers 'injection_pattern' from majority prompt_injection", () => {
      const { alert } = triggerAlertWithCategories([
        "prompt_injection",
        "prompt_injection",
        "prompt_injection",
      ]);
      expect(alert).not.toBeNull();
      expect(alert!.drift_direction).toBe("injection_pattern");
    });

    it("infers 'value_erosion' from majority value_misalignment", () => {
      const { alert } = triggerAlertWithCategories([
        "value_misalignment",
        "value_misalignment",
        "value_misalignment",
      ]);
      expect(alert).not.toBeNull();
      expect(alert!.drift_direction).toBe("value_erosion");
    });

    it("infers 'autonomy_creep' from majority autonomy_violation", () => {
      const { alert } = triggerAlertWithCategories([
        "autonomy_violation",
        "autonomy_violation",
        "autonomy_violation",
      ]);
      expect(alert).not.toBeNull();
      expect(alert!.drift_direction).toBe("autonomy_creep");
    });

    it("infers 'deception_pattern' from majority deceptive_reasoning", () => {
      const { alert } = triggerAlertWithCategories([
        "deceptive_reasoning",
        "deceptive_reasoning",
        "deceptive_reasoning",
      ]);
      expect(alert).not.toBeNull();
      expect(alert!.drift_direction).toBe("deception_pattern");
    });

    it("returns 'unknown' when no majority exists", () => {
      // Three different categories — no strict majority
      const { alert } = triggerAlertWithCategories([
        "prompt_injection",
        "value_misalignment",
        "autonomy_violation",
      ]);
      expect(alert).not.toBeNull();
      expect(alert!.drift_direction).toBe("unknown");
    });

    it("returns 'unknown' for even split of categories", () => {
      // Even split: 2 prompt_injection, 2 value_misalignment (using threshold=4)
      let state = createDriftState();
      const window: IntegrityCheckpoint[] = [];

      const cats: ConcernCategory[] = [
        "prompt_injection",
        "prompt_injection",
        "value_misalignment",
        "value_misalignment",
      ];

      let alert: ReturnType<typeof detectIntegrityDrift>["alert"] = null;
      for (const cat of cats) {
        const cp = makeNonclearCheckpoint(cat);
        window.push(cp);
        const result = detectIntegrityDrift(state, cp, window, 4);
        state = result.state;
        if (result.alert) alert = result.alert;
      }

      expect(alert).not.toBeNull();
      expect(alert!.drift_direction).toBe("unknown");
    });
  });

  // ── Alert structure ───────────────────────────────────────────────

  describe("alert structure", () => {
    function triggerAlert(): ReturnType<typeof detectIntegrityDrift> {
      let state = createDriftState();
      const ncs = Array.from({ length: 3 }, (_, i) =>
        makeNonclearCheckpoint("prompt_injection", `ic-streak-${i}`),
      );

      ({ state } = detectIntegrityDrift(state, ncs[0]!, ncs));
      ({ state } = detectIntegrityDrift(state, ncs[1]!, ncs));
      return detectIntegrityDrift(state, ncs[2]!, ncs);
    }

    it("alert_id starts with 'ida-'", () => {
      const { alert } = triggerAlert();
      expect(alert).not.toBeNull();
      expect(alert!.alert_id).toMatch(/^ida-/);
    });

    it("checkpoint_ids contains all streak checkpoint IDs", () => {
      const { alert } = triggerAlert();
      expect(alert).not.toBeNull();
      expect(alert!.checkpoint_ids).toContain("ic-streak-0");
      expect(alert!.checkpoint_ids).toContain("ic-streak-1");
      expect(alert!.checkpoint_ids).toContain("ic-streak-2");
      expect(alert!.checkpoint_ids).toHaveLength(3);
    });

    it("sustained_checks matches streak length", () => {
      const { alert } = triggerAlert();
      expect(alert).not.toBeNull();
      expect(alert!.sustained_checks).toBe(3);
    });

    it("alert_type is 'informative'", () => {
      const { alert } = triggerAlert();
      expect(alert).not.toBeNull();
      expect(alert!.alert_type).toBe("informative");
    });

    it("message is a descriptive string", () => {
      const { alert } = triggerAlert();
      expect(alert).not.toBeNull();
      expect(typeof alert!.message).toBe("string");
      expect(alert!.message.length).toBeGreaterThan(0);
      expect(alert!.message).toContain("consecutive");
    });

    it("detection_timestamp is valid ISO 8601", () => {
      const before = new Date().toISOString();
      const { alert } = triggerAlert();
      const after = new Date().toISOString();

      expect(alert).not.toBeNull();
      const parsed = new Date(alert!.detection_timestamp);
      expect(parsed.toISOString()).toBe(alert!.detection_timestamp);
      expect(alert!.detection_timestamp >= before).toBe(true);
      expect(alert!.detection_timestamp <= after).toBe(true);
    });
  });

  // ── Custom threshold ──────────────────────────────────────────────

  describe("custom threshold", () => {
    it("fires alert after 2 non-clear checks with threshold=2", () => {
      let state = createDriftState();

      const nc1 = makeNonclearCheckpoint("prompt_injection");
      const nc2 = makeNonclearCheckpoint("prompt_injection");

      let alert: ReturnType<typeof detectIntegrityDrift>["alert"];
      ({ state, alert } = detectIntegrityDrift(state, nc1, [nc1], 2));
      expect(alert).toBeNull();

      ({ state, alert } = detectIntegrityDrift(state, nc2, [nc1, nc2], 2));
      expect(alert).not.toBeNull();
      expect(alert!.sustained_checks).toBe(2);
    });
  });

  // ── createDriftState ──────────────────────────────────────────────

  describe("createDriftState", () => {
    it("returns a fresh state with all counters at zero", () => {
      const state = createDriftState();
      expect(state.sustainedNonclear).toBe(0);
      expect(state.alertFired).toBe(false);
      expect(state.streakCheckpointIds).toHaveLength(0);
      expect(state.streakCategories).toHaveLength(0);
    });
  });
});
