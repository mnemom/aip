import { describe, it, expect } from "vitest";
import {
  validateRecipeContent,
  normalizeLegacyRecipe,
} from "../../src/analysis/recipe-validation.js";

describe("validateRecipeContent", () => {
  it("accepts valid tier1 content", () => {
    const result = validateRecipeContent({
      tier1: {
        match: "any",
        conditions: [
          { metric: "thinking_output_ratio", operator: "gt", threshold: 0.8, signal: "high_ratio" },
        ],
      },
    });
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.normalized?.tier1?.conditions).toHaveLength(1);
  });

  it("defaults tier1.match to 'any' when omitted", () => {
    const result = validateRecipeContent({
      tier1: {
        conditions: [
          { metric: "output_token_count", operator: "lt", threshold: 10, signal: "terse" },
        ],
      },
    });
    expect(result.valid).toBe(true);
    expect(result.normalized?.tier1?.match).toBe("any");
  });

  it("rejects invalid operator", () => {
    const result = validateRecipeContent({
      tier1: {
        match: "any",
        conditions: [
          { metric: "m", operator: "nope", threshold: 1, signal: "s" },
        ],
      },
    });
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("operator");
  });

  it("rejects empty content", () => {
    const result = validateRecipeContent({});
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("at least one");
  });

  it("rejects non-object content", () => {
    const result = validateRecipeContent("string");
    expect(result.valid).toBe(false);
  });

  it("accepts valid tier2 content", () => {
    const result = validateRecipeContent({
      tier2: {
        trigger: { on_signals: ["high_ratio"] },
        checks: [
          { id: "chk-1", type: "conscience_value", content: "Does output align?" },
        ],
      },
    });
    expect(result.valid).toBe(true);
    expect(result.normalized?.tier2?.checks).toHaveLength(1);
  });

  it("rejects tier2 with missing check fields", () => {
    const result = validateRecipeContent({
      tier2: {
        trigger: { on_signals: [] },
        checks: [{ id: "chk-1" }], // missing type and content
      },
    });
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("type");
  });

  it("accepts valid tier3 content", () => {
    const result = validateRecipeContent({
      tier3: {
        rules: [
          {
            when: { tier1_escalated: true, aip_verdict: "clear" },
            action: "override_to_review",
            reason: "Tier1 flagged but AIP missed it",
          },
        ],
      },
    });
    expect(result.valid).toBe(true);
    expect(result.normalized?.tier3?.rules).toHaveLength(1);
  });

  it("rejects invalid tier3 action", () => {
    const result = validateRecipeContent({
      tier3: {
        rules: [
          {
            when: { tier1_escalated: true, aip_verdict: "clear" },
            action: "destroy",
            reason: "bad",
          },
        ],
      },
    });
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("action");
  });

  it("accepts all three tiers together", () => {
    const result = validateRecipeContent({
      tier1: {
        match: "all",
        conditions: [
          { metric: "hedging_word_count", operator: "gte", threshold: 5, signal: "hedging" },
        ],
      },
      tier2: {
        trigger: { on_signals: ["hedging"] },
        checks: [{ id: "c1", type: "BOUNDARY", content: "Check honesty" }],
      },
      tier3: {
        rules: [
          {
            when: { tier1_escalated: true, aip_verdict: "clear" },
            action: "flag",
            reason: "Suspicious hedging",
          },
        ],
      },
    });
    expect(result.valid).toBe(true);
    expect(result.normalized?.tier1).toBeDefined();
    expect(result.normalized?.tier2).toBeDefined();
    expect(result.normalized?.tier3).toBeDefined();
  });
});

describe("normalizeLegacyRecipe", () => {
  it("maps legacy metrics/value/weight to canonical conditions/threshold/signal", () => {
    const result = normalizeLegacyRecipe({
      tier1: {
        threshold: 0.5,
        metrics: [
          { metric: "thinking_output_ratio", operator: "gt", value: 0.8, weight: 0.7 },
        ],
      },
    });
    expect(result.tier1?.match).toBe("any");
    expect(result.tier1?.conditions[0]).toEqual({
      metric: "thinking_output_ratio",
      operator: "gt",
      threshold: 0.8,
      signal: "0.7",
    });
  });

  it("passes through already-canonical content unchanged", () => {
    const canonical = {
      tier1: {
        match: "all" as const,
        conditions: [
          { metric: "output_token_count", operator: "lt", threshold: 10, signal: "terse" },
        ],
      },
    };
    const result = normalizeLegacyRecipe(canonical);
    expect(result.tier1?.match).toBe("all");
    expect(result.tier1?.conditions[0].threshold).toBe(10);
    expect(result.tier1?.conditions[0].signal).toBe("terse");
  });

  it("normalizes tier2 with missing type field", () => {
    const result = normalizeLegacyRecipe({
      tier2: {
        trigger: { on_signals: ["sig1"] },
        checks: [{ id: "c1", content: "Check this" }],
      },
    });
    expect(result.tier2?.checks[0].type).toBe("conscience_value");
  });

  it("normalizes tier3 with defaults", () => {
    const result = normalizeLegacyRecipe({
      tier3: {
        rules: [{ when: {}, action: "flag", reason: "test" }],
      },
    });
    expect(result.tier3?.rules[0].when.tier1_escalated).toBe(false);
    expect(result.tier3?.rules[0].when.aip_verdict).toBe("clear");
  });
});
