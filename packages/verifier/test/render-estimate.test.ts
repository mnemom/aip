import { describe, it, expect } from "vitest";
import {
  estimateQualifies,
  shouldRenderEstimate,
  ESTIMATE_DISQUALIFIERS,
  ESTIMATE_COUNTING_FLOOR_TOKENS,
  RENDER_ESTIMATE_REASONS,
  type EstimateDescription,
} from "../src/render-estimate.js";
import { lintRendering, LINT_RULES } from "../src/claim-lint.js";
import { SURFACES, ESTIMATE_FORBIDDEN_SURFACES } from "../src/claim-table.js";

/** The estimator as it stands today (design T8): median, 60k floor, gross, clamps at zero. */
const TODAY: EstimateDescription = {
  method: "median",
  counting_floor_tokens: 60_000,
  net_of_mu: false,
  reports_loss: false,
  net_lower_bound: 9.1,
};

/** The estimator T8 requires before anything renders. */
const QUALIFYING: EstimateDescription = {
  method: "lower_bound",
  counting_floor_tokens: 200_000,
  net_of_mu: true,
  reports_loss: true,
  net_lower_bound: 4.2,
};

describe("estimateQualifies", () => {
  it("rejects today's estimator for every one of its four faults", () => {
    const q = estimateQualifies(TODAY);
    expect(q.qualifies).toBe(false);
    expect(q.reasons.sort()).toEqual(
      [
        ESTIMATE_DISQUALIFIERS.method_not_lower_bound,
        ESTIMATE_DISQUALIFIERS.counting_floor_below_200k,
        ESTIMATE_DISQUALIFIERS.not_net_of_mu,
        ESTIMATE_DISQUALIFIERS.never_shows_loss,
      ].sort(),
    );
  });
  it("accepts a conservative net lower bound, including a loss", () => {
    expect(estimateQualifies(QUALIFYING)).toEqual({ qualifies: true, reasons: [] });
    expect(estimateQualifies({ ...QUALIFYING, net_lower_bound: -3 }).qualifies).toBe(true);
  });
  it("the counting floor is the 200k line", () => {
    expect(ESTIMATE_COUNTING_FLOOR_TOKENS).toBe(200_000);
    expect(estimateQualifies({ ...QUALIFYING, counting_floor_tokens: 199_999 }).reasons).toEqual([
      ESTIMATE_DISQUALIFIERS.counting_floor_below_200k,
    ]);
    expect(estimateQualifies({ ...QUALIFYING, counting_floor_tokens: 250_000 }).qualifies).toBe(true);
  });
  it.each([
    ["method mean", { method: "mean" }, ESTIMATE_DISQUALIFIERS.method_not_lower_bound],
    ["not net of μ", { net_of_mu: false }, ESTIMATE_DISQUALIFIERS.not_net_of_mu],
    ["clamps losses", { reports_loss: false }, ESTIMATE_DISQUALIFIERS.never_shows_loss],
    ["missing value", { net_lower_bound: undefined }, ESTIMATE_DISQUALIFIERS.value_not_finite],
    ["NaN value", { net_lower_bound: Number.NaN }, ESTIMATE_DISQUALIFIERS.value_not_finite],
    ["floor as string", { counting_floor_tokens: "200000" as never }, ESTIMATE_DISQUALIFIERS.counting_floor_below_200k],
  ])("one fault at a time: %s", (_name, patch, reason) => {
    const q = estimateQualifies({ ...QUALIFYING, ...patch });
    expect(q.qualifies).toBe(false);
    expect(q.reasons).toEqual([reason]);
  });
  it("never throws on junk", () => {
    for (const junk of [null, undefined, 3, "x", [], true]) {
      expect(estimateQualifies(junk)).toEqual({ qualifies: false, reasons: [ESTIMATE_DISQUALIFIERS.not_an_object] });
    }
  });
});

describe("shouldRenderEstimate", () => {
  it("never renders on a PR comment or a card, even a qualifying estimate", () => {
    for (const surface of ESTIMATE_FORBIDDEN_SURFACES) {
      expect(shouldRenderEstimate(QUALIFYING, surface)).toEqual({
        render: false,
        reasons: [RENDER_ESTIMATE_REASONS.surface_never_shows_estimate],
      });
    }
    expect(ESTIMATE_FORBIDDEN_SURFACES).toEqual(["pr_comment", "share_card", "period_card"]);
  });
  it("does not render today's estimator anywhere", () => {
    for (const surface of SURFACES) {
      const d = shouldRenderEstimate(TODAY, surface);
      expect(d.render).toBe(false);
      expect(d.reasons.length).toBeGreaterThan(0);
    }
  });
  it("renders a qualifying estimate on the record page and the check summary only", () => {
    const allowed = SURFACES.filter((s) => shouldRenderEstimate(QUALIFYING, s).render);
    expect(allowed).toEqual(["record_page", "check_summary"]);
  });
  it("explains why an estimate does not qualify", () => {
    const d = shouldRenderEstimate(TODAY, "record_page");
    expect(d.reasons[0]).toBe(RENDER_ESTIMATE_REASONS.estimate_does_not_qualify);
    expect(d.reasons).toContain(ESTIMATE_DISQUALIFIERS.method_not_lower_bound);
  });
  it("rejects an unknown surface and a missing estimate", () => {
    expect(shouldRenderEstimate(QUALIFYING, "tweet")).toEqual({ render: false, reasons: [RENDER_ESTIMATE_REASONS.unknown_surface] });
    expect(shouldRenderEstimate(undefined, "record_page").render).toBe(false);
  });
});

describe("render-estimate and claim-lint agree", () => {
  it("a renderer that ignores the rule and puts the estimate on a card is caught by the lint", () => {
    for (const surface of ESTIMATE_FORBIDDEN_SURFACES) {
      expect(shouldRenderEstimate(QUALIFYING, surface).render).toBe(false);
      const r = lintRendering({
        surface,
        lines: [{ field: "savings_estimate", class: "estimate", text: "estimated net saving $4.20" }],
      });
      expect(r.ok).toBe(false);
      expect(r.violations.map((v) => v.rule)).toContain(LINT_RULES.estimate_on_forbidden_surface);
    }
  });
  it("a qualifying estimate on the record page passes both", () => {
    expect(shouldRenderEstimate(QUALIFYING, "record_page").render).toBe(true);
    const r = lintRendering({
      surface: "record_page",
      lines: [{ field: "savings_estimate", class: "estimate", text: "estimated net saving $4.20, lower bound, net of μ" }],
    });
    expect(r.violations).toEqual([]);
  });
});
