/**
 * The claim table (design decision T5): one table mapping record fields to
 * the claim class they may be rendered as and, for goal and protection lines,
 * the verb each mode produces. Every renderer and the verifier read this
 * table; copy is never written per renderer.
 *
 * Rules the table encodes (design "Claim classes and verbs", "Cost",
 * "Share cards"):
 * - A line is exactly one class. "Safe", "correct" and "prevented" never appear.
 * - No protection or goal line carries a dollar figure.
 * - An implicit goal line never says "sealed"; goals off read "not checked".
 * - The verb comes from the area's mode at the time of the act and, for a
 *   protection act, its verdict. "Stopped" shows the tool name and never its
 *   arguments; on a card, no tool name at all.
 * - Cards carry measured, outcome and covered verdict lines only. Estimates
 *   and savings never appear on a card or a PR comment (T8).
 * - No benchmark line ships until the head-to-head is published with its
 *   losing arms; no savings percentage appears anywhere until then.
 */

export const CLAIM_CLASSES = ["measured", "verdict", "estimate", "benchmark", "outcome"] as const;
export type ClaimClass = (typeof CLAIM_CLASSES)[number];

/**
 * Where a rendering is shown. Cards are the share card and the period card.
 * `share_card` is the `AAP-ShareCard/v1` record statement's lines
 * (`RecordShareCardLine`, statements.ts: `{class, text, coverage}`), the shape
 * `verify` checks; not the MNE-9022 numeric card (sharecard.ts `ShareCardLine`).
 */
export const SURFACES = ["record_page", "check_summary", "pr_comment", "share_card", "period_card"] as const;
export type Surface = (typeof SURFACES)[number];

export const CARD_SURFACES: readonly Surface[] = ["share_card", "period_card"];

/** Surfaces that never show the savings estimate, even once it qualifies (T8). */
export const ESTIMATE_FORBIDDEN_SURFACES: readonly Surface[] = ["pr_comment", "share_card", "period_card"];

/** Protection and goal area modes, as stored at the act. */
export const MODES = ["off", "observe", "nudge", "enforce"] as const;
export type Mode = (typeof MODES)[number];

/**
 * The verb each mode produces at its strongest verdict. `off` produces no line, or
 * "not checked". A protection act's verb also depends on its verdict: see
 * `protectionVerb`.
 */
export const MODE_VERBS: Record<Mode, string> = {
  off: "not checked",
  observe: "flagged",
  nudge: "flagged, agent nudged",
  enforce: "stopped",
};

/** A protection act's verdict, as stored at the act (mnemom-api `ProtectionVerdict`). */
export const PROTECTION_VERDICTS = ["pass", "warn", "nudge", "quarantine", "block"] as const;
export type ProtectionVerdict = (typeof PROTECTION_VERDICTS)[number];

/**
 * The verb one protection act produces, from the mode and verdict stored at the act; null
 * means the act has no line (mode off, or a pass). Mirrors mnemom-api
 * `src/record/claims.ts` `protectionVerb`: under enforce only a block or quarantine
 * "stopped" anything and anything else is "flagged"; under nudge only a nudge verdict
 * reads "flagged, agent nudged".
 */
export function protectionVerb(mode: Mode, verdict: ProtectionVerdict): string | null {
  if (mode === "off" || verdict === "pass") return null;
  if (mode === "observe") return MODE_VERBS.observe;
  if (mode === "nudge") return verdict === "nudge" ? MODE_VERBS.nudge : MODE_VERBS.observe;
  return verdict === "block" || verdict === "quarantine" ? MODE_VERBS.enforce : MODE_VERBS.observe;
}

/** How the goal was set. An implicit goal is never read as sealed (T16). */
export const GOAL_MODES = ["sealed", "implicit", "off"] as const;
export type GoalMode = (typeof GOAL_MODES)[number];

export interface ClaimTableEntry {
  class: ClaimClass;
  /** True for the goal and protection areas: the verb comes from the mode. */
  verb_by_mode: boolean;
  /** True when the line may carry a money figure (model cost and μ only). */
  money_allowed: boolean;
  /** Surfaces this field may appear on; absent means every surface. */
  surfaces?: readonly Surface[];
}

export const CLAIM_TABLE = {
  commits_recorded: { class: "measured", verb_by_mode: false, money_allowed: false },
  messages_from_person: { class: "measured", verb_by_mode: false, money_allowed: false },
  compactions: { class: "measured", verb_by_mode: false, money_allowed: false },
  tokens_sent_vs_reaching: { class: "measured", verb_by_mode: false, money_allowed: false },
  peak_context: { class: "measured", verb_by_mode: false, money_allowed: false },
  model_cost: { class: "measured", verb_by_mode: false, money_allowed: true },
  mu_cost: { class: "measured", verb_by_mode: false, money_allowed: true },
  approval: { class: "measured", verb_by_mode: false, money_allowed: false },
  /** How the goal was set: "sealed contract", "implicit goal" or "not checked" (M7: its own measured line). */
  goal_mode: { class: "measured", verb_by_mode: false, money_allowed: false },
  goal: { class: "verdict", verb_by_mode: true, money_allowed: false },
  /** The protection area's mode when no act is shown: "not checked" under off. */
  protection_mode: { class: "measured", verb_by_mode: false, money_allowed: false },
  protection: { class: "verdict", verb_by_mode: true, money_allowed: false },
  autonomy: { class: "measured", verb_by_mode: false, money_allowed: false },
  savings_estimate: {
    class: "estimate",
    verb_by_mode: false,
    money_allowed: true,
    surfaces: ["record_page", "check_summary"],
  },
  benchmark: { class: "benchmark", verb_by_mode: false, money_allowed: false },
  outcome: { class: "outcome", verb_by_mode: false, money_allowed: false },
} as const satisfies Record<string, ClaimTableEntry>;

export type ClaimField = keyof typeof CLAIM_TABLE;

export function isClaimField(field: unknown): field is ClaimField {
  return typeof field === "string" && Object.prototype.hasOwnProperty.call(CLAIM_TABLE, field);
}

/**
 * Line keys the builder (mnemom-api `src/record/claims.ts`) writes on a
 * statement's `lines[]`, mapped to the claim-table field each one renders
 * (cross-lane pick M6). `protection.act.<n>` maps to `protection` for any n.
 */
export const LINE_KEY_FIELDS: Readonly<Record<string, ClaimField>> = {
  "cost.model": "model_cost",
  "cost.mu": "mu_cost",
  "goal.mode": "goal_mode",
  "goal.verdict": "goal",
  "protection.mode": "protection_mode",
  "people.messages": "messages_from_person",
  "context.compactions": "compactions",
};

const PROTECTION_ACT_KEY = /^protection\.act\.\d+$/;

/** The claim-table field a statement line key renders, or undefined for a key the table does not know. */
export function fieldForLineKey(key: unknown): ClaimField | undefined {
  if (typeof key !== "string") return undefined;
  if (PROTECTION_ACT_KEY.test(key)) return "protection";
  return Object.prototype.hasOwnProperty.call(LINE_KEY_FIELDS, key) ? LINE_KEY_FIELDS[key] : undefined;
}
