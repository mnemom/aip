import { describe, it, expect } from "vitest";
import { REASONS } from "../src/statements.js";
import { verifyStatement } from "../src/verify-record.js";
import { TEST_KID, signStatement, testJwks } from "./helpers/sign.js";
import {
  lintRendering,
  lintRenderings,
  attachLineContext,
  LINT_RULES,
  type Rendering,
  type RenderedLine,
  type StatementLine,
} from "../src/claim-lint.js";
import { CLAIM_TABLE, CLAIM_CLASSES, SURFACES, MODE_VERBS, MODES, PROTECTION_VERDICTS, isClaimField, fieldForLineKey, protectionVerb } from "../src/claim-table.js";

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
        verdict: "block",
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
  it("derives a protection act's verb from its mode and verdict, as mnemom-api protectionVerb does", () => {
    const table = Object.fromEntries(MODES.map((m) => [m, Object.fromEntries(PROTECTION_VERDICTS.map((v) => [v, protectionVerb(m, v)]))]));
    expect(table).toEqual({
      off: { pass: null, warn: null, nudge: null, quarantine: null, block: null },
      observe: { pass: null, warn: "flagged", nudge: "flagged", quarantine: "flagged", block: "flagged" },
      nudge: { pass: null, warn: "flagged", nudge: "flagged, agent nudged", quarantine: "flagged", block: "flagged" },
      enforce: { pass: null, warn: "flagged", nudge: "flagged", quarantine: "stopped", block: "stopped" },
    });
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
        { field: "protection", class: "verdict", text: "protection: stopped 1, 12 of 12 judged", mode: "enforce", verdict: "block", tool_name: "Bash", coverage: cov },
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
      base({ field, class: "verdict", text, mode: field === "goal" ? "observe" : "enforce", verdict: field === "goal" ? undefined : "block", goal_mode, tool_name: "Bash", coverage: cov }),
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
    ["observe", "warn", "protection: stopped Bash"],
    ["observe", undefined, "protection: flagged, agent nudged"],
    ["nudge", "nudge", "protection: flagged"],
    ["nudge", "warn", "protection: flagged, agent nudged"],
    ["nudge", "block", "protection: stopped"],
    ["enforce", "block", "protection: flagged"],
    ["enforce", "quarantine", "protection: flagged, agent nudged"],
    ["enforce", "warn", "protection: stopped Bash"],
    ["enforce", "nudge", "protection: flagged, agent nudged"],
    // A tool name follows "stopped" only.
    ["enforce", "warn", "protection: flagged Bash"],
    ["nudge", "warn", "protection: flagged Bash"],
    // nudge and enforce each have two verbs, so the verdict decides; without it the line cannot pass.
    ["enforce", undefined, "protection: stopped Bash"],
    ["nudge", undefined, "protection: flagged, agent nudged"],
    // A pass produces no line, and an unknown verdict no verb.
    ["enforce", "pass", "protection: flagged"],
    ["enforce", "allow", "protection: flagged"],
    ["off", undefined, "protection: flagged"],
  ] as const)("verb_mismatch: mode %s verdict %s text %s", (mode, verdict, text) => {
    const r = rules(base({ field: "protection", class: "verdict", text, mode, verdict: verdict as never, tool_name: "Bash", coverage: cov }));
    expect(r).toContain(LINT_RULES.verb_mismatch);
  });
  it("verb_mismatch: unknown mode", () => {
    const r = rules(base({ field: "protection", class: "verdict", text: "protection: stopped", mode: "yolo" as never, coverage: cov }));
    expect(r).toContain(LINT_RULES.verb_mismatch);
  });
  it("verb accepted when it matches the mode", () => {
    const cases = [
      ["observe", undefined, "protection: flagged 2 of 12 judged"],
      ["observe", "block", "protection: flagged"],
      ["nudge", "nudge", "protection: flagged, agent nudged; 12 of 12 judged"],
      ["nudge", "warn", "protection: flagged"],
      ["nudge", "block", "protection: flagged"],
      ["enforce", "block", "protection: stopped Bash; 12 of 12 judged"],
      ["enforce", "quarantine", "protection: stopped Bash"],
      ["enforce", "warn", "protection: flagged"],
      ["enforce", "nudge", "protection: flagged"],
    ] as const;
    for (const [mode, verdict, text] of cases) {
      expect(rules(base({ field: "protection", class: "verdict", text, mode, verdict, tool_name: "Bash", coverage: cov }))).toEqual([]);
    }
  });
  it("enforce_without_tool_name off-card", () => {
    const r = rules(base({ field: "protection", class: "verdict", text: "protection: stopped 1", mode: "enforce", verdict: "block", tool_name: "Bash", coverage: cov }));
    expect(r).toContain(LINT_RULES.enforce_without_tool_name);
    const none = rules(base({ field: "protection", class: "verdict", text: "protection: stopped 1", mode: "enforce", verdict: "block", coverage: cov }));
    expect(none).toContain(LINT_RULES.enforce_without_tool_name);
    // An enforce act that only warned reads "flagged" and names no tool.
    const warned = rules(base({ field: "protection", class: "verdict", text: "flagged", mode: "enforce", verdict: "warn", tool_name: "Bash", coverage: cov }));
    expect(warned).toEqual([]);
  });
  it("tool_name_on_card", () => {
    const r = rules(
      base({ field: "protection", class: "verdict", text: "protection: stopped Bash", mode: "enforce", verdict: "block", tool_name: "Bash", coverage: cov }, "share_card"),
    );
    expect(r).toContain(LINT_RULES.tool_name_on_card);
    expect(r).not.toContain(LINT_RULES.enforce_without_tool_name);
    const flagged = rules(
      base({ field: "protection", class: "verdict", text: "flagged Edit", mode: "nudge", verdict: "warn", tool_name: "Edit", coverage: cov }, "share_card"),
    );
    expect(flagged).toEqual([LINT_RULES.tool_name_on_card]);
  });
  it("tool_arguments_shown", () => {
    const r = rules(
      base({
        field: "protection",
        class: "verdict",
        text: "protection: stopped Bash rm -rf /tmp/x",
        mode: "enforce",
        verdict: "block",
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
  it.each(["share_card", "period_card"] as const)("verdict_without_coverage: a card verdict line needs the coverage object (%s)", (surface) => {
    // The builder's words are not enough on a card: `verify` reads the object only.
    const words = rules(base({ class: "verdict", key: "goal.verdict", text: "3 of 4 judged turns on goal, 4 of 12 turns judged", goal_mode: "sealed" }, surface));
    expect(words).toContain(LINT_RULES.verdict_without_coverage);
    const act = rules(base({ class: "verdict", key: "protection.act.0", text: "flagged", mode: "observe", verdict: "warn" }, surface));
    expect(act).toContain(LINT_RULES.verdict_without_coverage);
    const covered = rules(base({ class: "verdict", key: "protection.act.0", text: "flagged", mode: "observe", verdict: "warn", coverage: cov }, surface));
    expect(covered).not.toContain(LINT_RULES.verdict_without_coverage);
  });
  it.each(["estimate", "benchmark"] as const)("card_class_not_allowed: %s on a share card", (cls) => {
    const r = rules(base({ class: cls, text: "x" }, "share_card"));
    expect(r).toContain(LINT_RULES.card_class_not_allowed);
  });
  it("provisional_mu_on_card: a provisional μ amount never reaches a share or period card (A-S-001, K1.17)", () => {
    for (const surface of ["share_card", "period_card"] as const) {
      for (const text of ["≈ 50000 mmu (pending)", "≈ 50 μ (pending)", "µ 50000 mmu pending", "about 50000 mmu"]) {
        const r = rules(base({ key: "cost.mu", class: "measured", text }, surface));
        expect(r, `${surface}: ${text}`).toContain(LINT_RULES.provisional_mu_on_card);
        expect(r).not.toContain(LINT_RULES.provisional_mu_off_cost_line);
      }
    }
  });
  it("provisional_mu allowed on the μ cost line off-card, and plain μ pending allowed everywhere (K1.4)", () => {
    for (const surface of ["record_page", "check_summary", "pr_comment"] as const) {
      expect(rules(base({ key: "cost.mu", class: "measured", text: "≈ 50000 mmu (pending)" }, surface))).toEqual([]);
    }
    for (const surface of SURFACES) {
      for (const text of ["µ pending", "not charged", "µ 50000 mmu"]) {
        const r = rules(base({ key: "cost.mu", class: "measured", text }, surface)).filter((x) => x.startsWith("provisional_mu"));
        expect(r, `${surface}: ${text}`).toEqual([]);
      }
    }
  });
  it("provisional_mu_off_cost_line: a provisional μ amount on any other line", () => {
    const r = rules(base({ field: "model_cost", class: "measured", text: "model cost ≈ 1250000 mmu (pending)" }));
    expect(r).toContain(LINT_RULES.provisional_mu_off_cost_line);
    expect(r).not.toContain(LINT_RULES.provisional_mu_on_card);
    expect(rules(base({ field: "outcome", class: "outcome", text: "merged, ≈ 50 μ pending" }, "share_card"))).toEqual(
      expect.arrayContaining([LINT_RULES.provisional_mu_on_card, LINT_RULES.provisional_mu_off_cost_line]),
    );
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

// CodeQL js/polynomial-redos (alert 25): the clause rules and the money figure must read a
// line in time linear in its length, and keep the clause semantics they had as regexes.
describe("lintRendering: clause rules", () => {
  const line = (text: string, field = "commits_recorded"): Rendering => ({
    surface: "record_page",
    lines: [{ field, class: "measured", text } as RenderedLine],
  });
  it.each([
    ["saved 1.2.3%", false],
    ["1.2.3% saved", true],
    ["saved money. 38% of acts", false],
    ["38% of acts, less churn", true],
    ["less churn, 38% of acts", false],
    ["savings of 12.5\n% overall", true],
  ] as const)("savings_percentage: %j is %s", (text, hit) => {
    expect(rules(line(text)).includes(LINT_RULES.savings_percentage)).toBe(hit);
  });
  it.each([
    ["≈ 1,200.5 mmu", true],
    ["about 50 μ", true],
    ["50 mu, pending", true],
    ["pending: 50 mu", true],
    ["pending 1.5,5 mu", false],
    ["50 mu charged. pending review", false],
    ["µ pending", false],
  ] as const)("provisional μ: %j is %s", (text, hit) => {
    expect(rules(line(text)).includes(LINT_RULES.provisional_mu_off_cost_line)).toBe(hit);
  });
  it.each([
    ["goal: flagged, 1,500 USD", true],
    ["goal: flagged, ,5 dollars", true],
    ["goal: flagged, 1.5.5 cents", true],
    ["goal: flagged, 9,9 apples", false],
  ] as const)("money on a goal line: %j is %s", (text, hit) => {
    expect(rules(line(text, "goal")).includes(LINT_RULES.money_on_goal_or_protection)).toBe(hit);
  });
  it.each(["9", "0", "9,", ",,9", "9.", "1%", "~9", "saved ", "9 mu ", "pending 9"])(
    "lints a 50k-character run of %j in linear time",
    (unit) => {
      const text = unit.repeat(Math.ceil(50_000 / unit.length));
      const start = performance.now();
      lintRendering(line(text, "goal"));
      expect(performance.now() - start).toBeLessThan(1000);
    },
  );
});

// Cross-lane picks M6 and M7: lines as the builder (mnemom-api src/record/claims.ts)
// signs them, `{class, key, text}`, with the words its three fixtures carry.
describe("builder line shape (M6, M7)", () => {
  const base = (line: Partial<RenderedLine>, surface: Rendering["surface"] = "record_page"): Rendering => ({
    surface,
    lines: [{ class: "measured", text: "x", ...line } as RenderedLine],
  });
  const sealedLines: StatementLine[] = [
    { class: "measured", key: "cost.model", text: "model cost 1250000 mmu" },
    { class: "measured", key: "cost.mu", text: "µ 50000 mmu" },
    { class: "measured", key: "goal.mode", text: "sealed contract" },
    { class: "verdict", key: "goal.verdict", text: "3 of 4 judged turns on goal, 4 of 12 turns judged" },
    { class: "verdict", key: "protection.act.0", text: "stopped Bash" },
    { class: "verdict", key: "protection.act.1", text: "flagged" },
    // mnemom-api protectionActLine: enforce + warn and nudge + warn read "flagged" with no tool
    // name; act 4 passed and has no line; enforce + quarantine "stopped" names the tool.
    { class: "verdict", key: "protection.act.2", text: "flagged" },
    { class: "verdict", key: "protection.act.3", text: "flagged" },
    { class: "verdict", key: "protection.act.5", text: "stopped Bash" },
    { class: "measured", key: "people.messages", text: "5 messages from a person" },
    { class: "measured", key: "context.compactions", text: "1 compactions" },
  ];
  const sealedGoal = { mode: "sealed" as const };
  const sealedProtection = {
    acts: [
      { mode: "enforce" as const, tool_name: "Bash", verdict: "block" as const },
      { mode: "observe" as const, tool_name: null, verdict: "warn" as const },
      { mode: "enforce" as const, tool_name: "Write", verdict: "warn" as const },
      { mode: "nudge" as const, tool_name: "Edit", verdict: "warn" as const },
      { mode: "enforce" as const, tool_name: "Read", verdict: "pass" as const },
      { mode: "enforce" as const, tool_name: "Bash", verdict: "quarantine" as const },
    ],
  };
  const nudgeLines: StatementLine[] = [
    { class: "measured", key: "cost.model", text: "model cost 1250000 mmu" },
    { class: "measured", key: "cost.mu", text: "µ pending" },
    { class: "measured", key: "goal.mode", text: "implicit goal" },
    { class: "verdict", key: "goal.verdict", text: "1 of 2 judged turns on goal, 2 of 6 turns judged" },
    { class: "verdict", key: "protection.act.0", text: "flagged, agent nudged" },
    { class: "measured", key: "people.messages", text: "messages from a person: unclassified" },
    { class: "measured", key: "context.compactions", text: "0 compactions" },
  ];
  const offLines: StatementLine[] = [
    { class: "measured", key: "cost.model", text: "model cost 0 mmu" },
    { class: "measured", key: "cost.mu", text: "not charged" },
    { class: "measured", key: "goal.mode", text: "not checked" },
    { class: "measured", key: "protection.mode", text: "not checked" },
    { class: "measured", key: "people.messages", text: "0 messages from a person" },
    { class: "measured", key: "context.compactions", text: "0 compactions" },
  ];

  it("maps every builder key to a claim-table field", () => {
    expect(fieldForLineKey("cost.model")).toBe("model_cost");
    expect(fieldForLineKey("cost.mu")).toBe("mu_cost");
    expect(fieldForLineKey("goal.mode")).toBe("goal_mode");
    expect(fieldForLineKey("goal.verdict")).toBe("goal");
    expect(fieldForLineKey("protection.act.0")).toBe("protection");
    expect(fieldForLineKey("protection.act.17")).toBe("protection");
    expect(fieldForLineKey("protection.mode")).toBe("protection_mode");
    expect(fieldForLineKey("people.messages")).toBe("messages_from_person");
    expect(fieldForLineKey("context.compactions")).toBe("compactions");
    expect(fieldForLineKey("protection.act.x")).toBeUndefined();
    expect(fieldForLineKey("toString")).toBeUndefined();
    expect(fieldForLineKey(3)).toBeUndefined();
  });
  it("keeps goal_mode and protection_mode as measured fields (M7)", () => {
    expect(CLAIM_TABLE.goal_mode.class).toBe("measured");
    expect(CLAIM_TABLE.protection_mode.class).toBe("measured");
    expect(CLAIM_TABLE.goal.class).toBe("verdict");
  });
  it("attachLineContext adds goal_mode, mode, verdict and tool_name without touching the text", () => {
    const lines = attachLineContext(sealedLines, sealedGoal, sealedProtection);
    expect(lines.map((l) => l.text)).toEqual(sealedLines.map((l) => l.text));
    expect(lines[2]).toMatchObject({ key: "goal.mode", goal_mode: "sealed" });
    expect(lines[3]).toMatchObject({ key: "goal.verdict", goal_mode: "sealed" });
    expect(lines[3].mode).toBeUndefined();
    expect(lines[4]).toMatchObject({ mode: "enforce", verdict: "block", tool_name: "Bash" });
    expect(lines[5]).toMatchObject({ mode: "observe", verdict: "warn" });
    expect(lines[5].tool_name).toBeUndefined();
    expect(lines[6]).toMatchObject({ key: "protection.act.2", mode: "enforce", verdict: "warn", tool_name: "Write" });
    expect(lines[7]).toMatchObject({ key: "protection.act.3", mode: "nudge", verdict: "warn", tool_name: "Edit" });
    expect(lines[8]).toMatchObject({ key: "protection.act.5", mode: "enforce", verdict: "quarantine", tool_name: "Bash" });
    const off = attachLineContext(offLines, { mode: "off" }, { acts: [{ mode: "off", verdict: "pass", tool_name: null }] });
    expect(off[2]).toMatchObject({ goal_mode: "off" });
    expect(off[3]).toMatchObject({ mode: "off" });
  });
  it.each([
    ["sealed, enforce, final µ", sealedLines, sealedGoal, sealedProtection],
    ["implicit, nudge, pending µ", nudgeLines, { mode: "implicit" as const }, { acts: [{ mode: "nudge" as const, verdict: "nudge" as const, tool_name: "Edit" }] }],
    ["off, not charged", offLines, { mode: "off" as const }, { acts: [{ mode: "off" as const, verdict: "pass" as const, tool_name: null }] }],
  ])("the builder's fixture lines pass on the record page: %s", (_name, lines, goal, protection) => {
    const r = lintRendering({ surface: "record_page", lines: attachLineContext(lines, goal, protection) });
    expect(r.violations).toEqual([]);
  });
  // A card renderer drops tool names (nameTools=false) and attaches each verdict line's coverage object.
  const cardLines = (): RenderedLine[] =>
    attachLineContext(sealedLines, sealedGoal, sealedProtection).map((l) => {
      const text = l.text.startsWith("stopped ") ? "stopped" : l.text;
      return l.class === "verdict" ? { ...l, text, coverage: { judged: 4, total: 12 } } : { ...l, text };
    });
  it("the builder's card lines pass on a share card with the tool name dropped and coverage attached", () => {
    expect(lintRendering({ surface: "share_card", lines: cardLines() }).violations).toEqual([]);
    const withName = attachLineContext(sealedLines, sealedGoal, sealedProtection).map((l) =>
      l.class === "verdict" ? { ...l, coverage: { judged: 4, total: 12 } } : l,
    );
    expect(rules({ surface: "share_card", lines: withName })).toContain(LINT_RULES.tool_name_on_card);
    const uncovered = attachLineContext(sealedLines, sealedGoal, sealedProtection).map((l) =>
      l.text.startsWith("stopped ") ? { ...l, text: "stopped" } : l,
    );
    expect(rules({ surface: "share_card", lines: uncovered })).toContain(LINT_RULES.verdict_without_coverage);
  });
  it("a share card the lint passes is one verify accepts, and a card it fails on coverage verify rejects", async () => {
    const jwks = await testJwks();
    const uncovered = cardLines().map((l) => (l.key === "protection.act.1" ? { ...l, coverage: undefined } : l));
    const textOnly = cardLines().map((l) => (l.key === "goal.verdict" ? { ...l, coverage: undefined } : l));
    for (const lines of [cardLines(), uncovered, textOnly]) {
      const lintRules = rules({ surface: "share_card", lines });
      const signed = await signStatement({
        typ: "AAP-ShareCard/v1",
        signing_key_id: TEST_KID,
        lines: JSON.parse(JSON.stringify(lines)) as unknown[],
      });
      const res = await verifyStatement(signed, jwks);
      expect(lintRules.includes(LINT_RULES.verdict_without_coverage)).toBe(res.reasons.includes(REASONS.card_verdict_without_coverage));
      expect(lintRules.length === 0).toBe(res.valid);
    }
  });
  it("reads a verdict's coverage from the builder's words, and still demands it", () => {
    const ok = rules(base({ class: "verdict", key: "goal.verdict", text: "3 of 4 judged turns on goal, 4 of 12 turns judged", goal_mode: "sealed" }));
    expect(ok).not.toContain(LINT_RULES.verdict_without_coverage);
    const missing = rules(base({ class: "verdict", key: "goal.verdict", text: "3 of 4 judged turns on goal", goal_mode: "sealed" }));
    expect(missing).toContain(LINT_RULES.verdict_without_coverage);
    const inverted = rules(base({ class: "verdict", key: "goal.verdict", text: "13 of 12 turns judged", goal_mode: "sealed" }));
    expect(inverted).toContain(LINT_RULES.verdict_without_coverage);
    const nulled = rules(base({ class: "verdict", key: "goal.verdict", text: "4 of 12 turns judged", goal_mode: "sealed", coverage: null }));
    expect(nulled).toContain(LINT_RULES.verdict_without_coverage);
    // Off a card a protection act is one recorded decision; it has no coverage to show.
    expect(rules(base({ class: "verdict", key: "protection.act.0", text: "flagged", mode: "observe", verdict: "warn" }))).toEqual([]);
    // A verdict line with no field at all still has to show it.
    expect(rules(base({ class: "verdict", text: "held" }))).toContain(LINT_RULES.verdict_without_coverage);
  });
  it("a key resolves the field, so class and money checks fire on builder lines", () => {
    expect(rules(base({ class: "verdict", key: "goal.mode", text: "sealed contract", goal_mode: "sealed" }))).toContain(LINT_RULES.one_class_per_line);
    expect(rules(base({ class: "measured", key: "goal.verdict", text: "4 of 12 turns judged", goal_mode: "sealed" }))).toContain(LINT_RULES.one_class_per_line);
    expect(rules(base({ class: "measured", key: "goal.mode", text: "sealed contract $3", goal_mode: "sealed" }))).toContain(LINT_RULES.money_on_goal_or_protection);
    expect(rules(base({ class: "measured", key: "context.compactions", text: "$1 compactions" }))).toContain(LINT_RULES.one_class_per_line);
    expect(rules(base({ class: "measured", key: "goal.mode", text: "sealed contract", goal_mode: "implicit" }))).toContain(LINT_RULES.implicit_goal_sealed);
    expect(rules(base({ class: "measured", key: "goal.mode", text: "implicit goal", goal_mode: "off" }))).toContain(LINT_RULES.goal_off_not_checked);
    expect(rules(base({ class: "verdict", key: "protection.act.0", text: "flagged", mode: "enforce", verdict: "block" }))).toContain(LINT_RULES.verb_mismatch);
    expect(rules(base({ class: "verdict", key: "protection.act.0", text: "flagged", mode: "enforce", verdict: "warn" }))).toEqual([]);
    expect(rules(base({ class: "verdict", key: "protection.act.0", text: "flagged", mode: "nudge", verdict: "warn" }))).toEqual([]);
  });
  it("an explicit field wins over the key", () => {
    const r = rules(base({ field: "compactions", class: "measured", key: "goal.mode", text: "1 compactions" }));
    expect(r).toEqual([]);
  });
});
