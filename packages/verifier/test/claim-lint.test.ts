import { describe, it, expect } from "vitest";
import { lintRendering, lintRenderings, LINT_RULES, type Rendering, type RenderedLine } from "../src/claim-lint.js";
import { CLAIM_TABLE, CLAIM_CLASSES, SURFACES, MODE_VERBS, isClaimField } from "../src/claim-table.js";

const cov = { judged: 12, total: 12 };

function rules(r: Rendering | unknown): string[] {
  return lintRendering(r).violations.map((v) => v.rule);
}

/** A record page rendering that passes every rule. */
function cleanRecordPage(): Rendering {
  return {
    surface: "record_page",
    lines: [
      { field: "commits_recorded", class: "measured", text: "14 commits recorded" },
      { field: "model_cost", class: "measured", text: "model cost $3.20" },
      { field: "mu_cost", class: "measured", text: "μ 412" },
      {
        field: "goal",
        class: "verdict",
        text: "goal: flagged 2 of 12 judged",
        mode: "observe",
        goal_mode: "sealed",
        coverage: { judged: 12, total: 12 },
      },
      {
        field: "protection",
        class: "verdict",
        text: "protection: stopped Bash, 12 of 12 judged",
        mode: "enforce",
        tool_name: "Bash",
        tool_arguments: { command: "rm -rf /tmp/x" },
        coverage: cov,
      },
      { field: "outcome", class: "outcome", text: "merged, not reverted in 7 days" },
    ],
  };
}

describe("claim table", () => {
  it("names the five classes and nothing else", () => {
    expect([...CLAIM_CLASSES]).toEqual(["measured", "verdict", "estimate", "benchmark", "outcome"]);
    for (const entry of Object.values(CLAIM_TABLE)) expect(CLAIM_CLASSES).toContain(entry.class);
  });
  it("lets money appear only on model cost, μ and the estimate", () => {
    const moneyFields = Object.entries(CLAIM_TABLE)
      .filter(([, e]) => e.money_allowed)
      .map(([k]) => k)
      .sort();
    expect(moneyFields).toEqual(["model_cost", "mu_cost", "savings_estimate"]);
    expect(CLAIM_TABLE.goal.money_allowed).toBe(false);
    expect(CLAIM_TABLE.protection.money_allowed).toBe(false);
  });
  it("derives the goal and protection verb from the mode", () => {
    expect(CLAIM_TABLE.goal.verb_by_mode).toBe(true);
    expect(CLAIM_TABLE.protection.verb_by_mode).toBe(true);
    expect(MODE_VERBS).toEqual({ off: "not checked", observe: "flagged", nudge: "flagged, agent nudged", enforce: "stopped" });
  });
  it("keeps the estimate off cards and PR comments", () => {
    expect(CLAIM_TABLE.savings_estimate.surfaces).toEqual(["record_page", "check_summary"]);
  });
  it("recognises its own fields only", () => {
    expect(isClaimField("goal")).toBe(true);
    expect(isClaimField("toString")).toBe(false);
    expect(isClaimField(42)).toBe(false);
  });
});

describe("lintRendering: clean renderings pass", () => {
  it("passes a complete record page", () => {
    const r = lintRendering(cleanRecordPage());
    expect(r.violations).toEqual([]);
    expect(r.ok).toBe(true);
  });
  it("passes a share card with measured, outcome and verdict lines and no tool name", () => {
    const card: Rendering = {
      surface: "share_card",
      lines: [
        { field: "commits_recorded", class: "measured", text: "14 commits recorded" },
        { field: "protection", class: "verdict", text: "protection: stopped 1, 12 of 12 judged", mode: "enforce", tool_name: "Bash", coverage: cov },
        { field: "outcome", class: "outcome", text: "merged, not reverted" },
      ],
    };
    expect(rules(card)).toEqual([]);
  });
  it("passes a period card that renders its reverts", () => {
    const card: Rendering = {
      surface: "period_card",
      lines: [
        { field: "commits_recorded", class: "measured", text: "212 commits recorded this week" },
        { field: "outcome", class: "outcome", text: "3 reverted, 209 held" },
      ],
    };
    expect(rules(card)).toEqual([]);
  });
  it("passes a goal-off line that reads not checked", () => {
    const r: Rendering = {
      surface: "check_summary",
      lines: [{ field: "goal", class: "verdict", text: "not checked", mode: "off", goal_mode: "off", coverage: { judged: 0, total: 0 } }],
    };
    expect(rules(r)).toEqual([]);
  });
});

describe("lintRendering: each rule rejects", () => {
  const base = (line: Partial<RenderedLine>, surface: Rendering["surface"] = "record_page"): Rendering => ({
    surface,
    lines: [{ class: "measured", text: "x", ...line } as RenderedLine],
  });

  it("one_class_per_line: unknown class", () => {
    expect(rules(base({ class: "safe-ish" }))).toContain(LINT_RULES.one_class_per_line);
  });
  it("one_class_per_line: class disagrees with the field's class", () => {
    expect(rules(base({ field: "goal", class: "measured", text: "goal held" }))).toContain(LINT_RULES.one_class_per_line);
  });
  it("one_class_per_line: a measured line borrowing estimate words", () => {
    expect(rules(base({ field: "model_cost", class: "measured", text: "model cost $3.20, estimated savings $9" }))).toContain(
      LINT_RULES.one_class_per_line,
    );
  });
  it("one_class_per_line: unknown field", () => {
    expect(rules(base({ field: "vibes", class: "measured" }))).toContain(LINT_RULES.one_class_per_line);
  });
  it("one_class_per_line: money on a field that never carries money", () => {
    expect(rules(base({ field: "commits_recorded", class: "measured", text: "14 commits, $2 each" }))).toContain(
      LINT_RULES.one_class_per_line,
    );
  });
  it.each(["safe", "Safe to merge", "correct", "correctly", "prevented a leak", "prevents", "unsafe"])(
    "forbidden_word: %s",
    (word) => {
      expect(rules(base({ text: `this run was ${word}` }))).toContain(LINT_RULES.forbidden_word);
    },
  );
  it("forbidden_word: does not fire on 'safe-house' as a tool name fragment inside another word", () => {
    expect(rules(base({ text: "stopped safehouse_write" }))).not.toContain(LINT_RULES.forbidden_word);
  });
  it.each([
    ["goal", "$12 of goal work", "sealed" as const],
    ["protection", "protection stopped Bash, saved $40", undefined],
    ["protection", "protection: stopped Bash (12 USD)", undefined],
  ])("money_on_goal_or_protection: %s %s", (field, text, goal_mode) => {
    const r = rules(
      base({ field, class: "verdict", text, mode: field === "goal" ? "observe" : "enforce", goal_mode, tool_name: "Bash", coverage: cov }),
    );
    expect(r).toContain(LINT_RULES.money_on_goal_or_protection);
  });
  it("implicit_goal_sealed", () => {
    const r = rules(base({ field: "goal", class: "verdict", text: "sealed goal: flagged 1, 12 of 12 judged", mode: "observe", goal_mode: "implicit", coverage: cov }));
    expect(r).toContain(LINT_RULES.implicit_goal_sealed);
    const ok = rules(base({ field: "goal", class: "verdict", text: "sealed goal: flagged 1", mode: "observe", goal_mode: "sealed", coverage: cov }));
    expect(ok).not.toContain(LINT_RULES.implicit_goal_sealed);
  });
  it("goal_off_not_checked", () => {
    const r = rules(base({ field: "goal", class: "verdict", text: "goal held", mode: "off", goal_mode: "off", coverage: cov }));
    expect(r).toContain(LINT_RULES.goal_off_not_checked);
  });
  it.each(["pr_comment", "share_card", "period_card"] as const)("estimate_on_forbidden_surface: %s", (surface) => {
    const r = rules(base({ field: "savings_estimate", class: "estimate", text: "estimated saving $9.10" }, surface));
    expect(r).toContain(LINT_RULES.estimate_on_forbidden_surface);
    expect(r).toContain(LINT_RULES.field_not_on_surface);
  });
  it("estimate_on_forbidden_surface: savings words on a card under another class", () => {
    const r = rules(base({ field: "model_cost", class: "measured", text: "model cost $3.20, savings $9" }, "share_card"));
    expect(r).toContain(LINT_RULES.estimate_on_forbidden_surface);
  });
  it("estimate allowed on the record page and check summary", () => {
    for (const surface of ["record_page", "check_summary"] as const) {
      const r = rules(base({ field: "savings_estimate", class: "estimate", text: "estimated net saving $9.10 (lower bound)" }, surface));
      expect(r).not.toContain(LINT_RULES.estimate_on_forbidden_surface);
      expect(r).not.toContain(LINT_RULES.field_not_on_surface);
    }
  });
  it.each([
    ["observe", "protection: stopped Bash"],
    ["nudge", "protection: flagged"],
    ["nudge", "protection: stopped"],
    ["enforce", "protection: flagged Bash"],
    ["enforce", "protection: flagged, agent nudged"],
    ["off", "protection: flagged"],
  ] as const)("verb_mismatch: mode %s text %s", (mode, text) => {
    const r = rules(base({ field: "protection", class: "verdict", text, mode, tool_name: "Bash", coverage: cov }));
    expect(r).toContain(LINT_RULES.verb_mismatch);
  });
  it("verb_mismatch: unknown mode", () => {
    const r = rules(base({ field: "protection", class: "verdict", text: "protection: stopped", mode: "yolo" as never, coverage: cov }));
    expect(r).toContain(LINT_RULES.verb_mismatch);
  });
  it("verb accepted when it matches the mode", () => {
    const cases = [
      ["observe", "protection: flagged 2 of 12 judged"],
      ["nudge", "protection: flagged, agent nudged; 12 of 12 judged"],
      ["enforce", "protection: stopped Bash; 12 of 12 judged"],
    ] as const;
    for (const [mode, text] of cases) {
      expect(rules(base({ field: "protection", class: "verdict", text, mode, tool_name: "Bash", coverage: cov }))).not.toContain(
        LINT_RULES.verb_mismatch,
      );
    }
  });
  it("enforce_without_tool_name off-card", () => {
    const r = rules(base({ field: "protection", class: "verdict", text: "protection: stopped 1", mode: "enforce", tool_name: "Bash", coverage: cov }));
    expect(r).toContain(LINT_RULES.enforce_without_tool_name);
    const none = rules(base({ field: "protection", class: "verdict", text: "protection: stopped 1", mode: "enforce", coverage: cov }));
    expect(none).toContain(LINT_RULES.enforce_without_tool_name);
  });
  it("tool_name_on_card", () => {
    const r = rules(
      base({ field: "protection", class: "verdict", text: "protection: stopped Bash", mode: "enforce", tool_name: "Bash", coverage: cov }, "share_card"),
    );
    expect(r).toContain(LINT_RULES.tool_name_on_card);
    expect(r).not.toContain(LINT_RULES.enforce_without_tool_name);
  });
  it("tool_arguments_shown", () => {
    const r = rules(
      base({
        field: "protection",
        class: "verdict",
        text: "protection: stopped Bash rm -rf /tmp/x",
        mode: "enforce",
        tool_name: "Bash",
        tool_arguments: { command: "rm -rf /tmp/x" },
        coverage: cov,
      }),
    );
    expect(r).toContain(LINT_RULES.tool_arguments_shown);
  });
  it.each([
    "trusted in 3 minutes",
    "3 minutes to trust",
    "review time cut",
    "merge without re-checking",
    "no need to review",
    "trusted without reading",
  ])("trust_claim: %s", (text) => {
    expect(rules(base({ text }))).toContain(LINT_RULES.trust_claim);
  });
  it.each(["saves 38%", "38% cheaper", "a 40 % reduction in cost", "savings of 12.5%"])("savings_percentage: %s", (text) => {
    expect(rules(base({ text }))).toContain(LINT_RULES.savings_percentage);
  });
  it("savings_percentage: a plain percentage that is not a saving passes", () => {
    expect(rules(base({ field: "approval", class: "measured", text: "approval 80% of acts" }))).not.toContain(LINT_RULES.savings_percentage);
  });
  it("benchmark_not_published", () => {
    expect(rules(base({ field: "benchmark", class: "benchmark", text: "beats arm B" }))).toContain(LINT_RULES.benchmark_not_published);
  });
  it("verdict_without_coverage", () => {
    const r = rules(base({ field: "goal", class: "verdict", text: "goal: flagged 0", mode: "observe", goal_mode: "sealed" }));
    expect(r).toContain(LINT_RULES.verdict_without_coverage);
    const bad = rules(base({ field: "goal", class: "verdict", text: "goal: flagged 0", mode: "observe", goal_mode: "sealed", coverage: { judged: 13, total: 12 } }));
    expect(bad).toContain(LINT_RULES.verdict_without_coverage);
  });
  it.each(["estimate", "benchmark"] as const)("card_class_not_allowed: %s on a share card", (cls) => {
    const r = rules(base({ class: cls, text: "x" }, "share_card"));
    expect(r).toContain(LINT_RULES.card_class_not_allowed);
  });
  it("period_card_without_revert", () => {
    const r = lintRendering({ surface: "period_card", lines: [{ field: "commits_recorded", class: "measured", text: "212 commits" }] });
    expect(r.violations).toEqual([{ rule: LINT_RULES.period_card_without_revert, line: -1, text: "" }]);
  });
  it("unknown_surface and malformed input never throw", () => {
    expect(rules({ surface: "billboard", lines: [] })).toEqual([LINT_RULES.unknown_surface]);
    expect(rules(null)).toEqual([LINT_RULES.unknown_surface]);
    expect(rules("x")).toEqual([LINT_RULES.unknown_surface]);
    expect(rules({ surface: "record_page", lines: [null, 3, { class: 1, text: 2 }] })).toEqual([
      LINT_RULES.one_class_per_line,
      LINT_RULES.one_class_per_line,
      LINT_RULES.one_class_per_line,
    ]);
  });
  it("reports the line index and text for each violation", () => {
    const r = lintRendering({
      surface: "record_page",
      lines: [
        { field: "commits_recorded", class: "measured", text: "14 commits" },
        { field: "outcome", class: "outcome", text: "safe to merge" },
      ],
    });
    expect(r.violations).toEqual([{ rule: LINT_RULES.forbidden_word, line: 1, text: "safe to merge" }]);
  });
  it("lintRenderings keeps results in order", () => {
    const out = lintRenderings([cleanRecordPage(), { surface: "nope", lines: [] }]);
    expect(out.map((r) => r.ok)).toEqual([true, false]);
  });
  it("covers every surface the table knows", () => {
    for (const surface of SURFACES) {
      const r = lintRendering({ surface, lines: [{ field: "commits_recorded", class: "measured", text: "1 commit" }] });
      const expected = surface === "period_card" ? [LINT_RULES.period_card_without_revert] : [];
      expect(r.violations.map((v) => v.rule)).toEqual(expected);
    }
  });
});
