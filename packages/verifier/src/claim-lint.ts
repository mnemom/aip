/**
 * claim-lint: the mechanical check every rendering passes (criterion K1.17).
 *
 * A rendering is a surface plus the lines shown on it. Each line names its
 * class, its text, and when it comes from a mode-bearing area, the mode stored
 * at the act. The lint returns every violation with a stable rule name; it
 * never rewrites a line.
 *
 * Rules, each from the claim table (T5) and the design's claim rules:
 *   one_class_per_line          class is one of the five, and matches the field's class
 *   forbidden_word              "safe", "correct", "prevented" never appear
 *   money_on_goal_or_protection no dollar figure on a goal or protection line
 *   implicit_goal_sealed        an implicit goal line never says "sealed"
 *   goal_off_not_checked        with goals off the goal line reads "not checked"
 *   estimate_on_forbidden_surface  no estimate or savings on a card or PR comment
 *   verb_mismatch               the verb is the mode's verb, exactly
 *   enforce_without_tool_name   enforce names the tool off-card
 *   tool_name_on_card           a card never shows a tool name
 *   tool_arguments_shown        tool arguments never appear
 *   trust_claim                 no minutes-to-trust, review-time or re-checking claim
 *   savings_percentage          no savings percentage anywhere until the board exists
 *   benchmark_not_published     no benchmark line ships yet
 *   verdict_without_coverage    coverage is always shown on a verdict line
 *   card_class_not_allowed      a card carries measured, outcome and verdict lines only
 *   period_card_without_revert  a period card renders its reverts
 *   field_not_on_surface        the field is not shown on this surface
 */

import {
  CARD_SURFACES,
  CLAIM_CLASSES,
  CLAIM_TABLE,
  ESTIMATE_FORBIDDEN_SURFACES,
  MODES,
  SURFACES,
  isClaimField,
  type ClaimClass,
  type ClaimTableEntry,
  type GoalMode,
  type Mode,
  type Surface,
} from "./claim-table.js";

export interface RenderedLine {
  /** Record field the line renders; when present its class must match the claim table. */
  field?: string;
  class: string;
  text: string;
  /** Mode stored at the act, for goal and protection lines. */
  mode?: Mode;
  /** How the goal was set, for goal lines. */
  goal_mode?: GoalMode;
  /** Tool the enforce decision stopped, when the area is protection and the mode is enforce. */
  tool_name?: string;
  /** Never rendered; present here only so the lint can prove it is absent from the text. */
  tool_arguments?: unknown;
  /** "N of M judged"; required on a verdict line. */
  coverage?: { judged: number; total: number } | null;
  [k: string]: unknown;
}

export interface Rendering {
  surface: Surface;
  lines: RenderedLine[];
  [k: string]: unknown;
}

export const LINT_RULES = {
  one_class_per_line: "one_class_per_line",
  forbidden_word: "forbidden_word",
  money_on_goal_or_protection: "money_on_goal_or_protection",
  implicit_goal_sealed: "implicit_goal_sealed",
  goal_off_not_checked: "goal_off_not_checked",
  estimate_on_forbidden_surface: "estimate_on_forbidden_surface",
  verb_mismatch: "verb_mismatch",
  enforce_without_tool_name: "enforce_without_tool_name",
  tool_name_on_card: "tool_name_on_card",
  tool_arguments_shown: "tool_arguments_shown",
  trust_claim: "trust_claim",
  savings_percentage: "savings_percentage",
  benchmark_not_published: "benchmark_not_published",
  verdict_without_coverage: "verdict_without_coverage",
  card_class_not_allowed: "card_class_not_allowed",
  period_card_without_revert: "period_card_without_revert",
  field_not_on_surface: "field_not_on_surface",
  unknown_surface: "unknown_surface",
} as const;

export type LintRule = (typeof LINT_RULES)[keyof typeof LINT_RULES];

export interface LintViolation {
  rule: LintRule;
  /** Index of the line in the rendering, or -1 for a rendering-level violation. */
  line: number;
  text: string;
}

export interface LintResult {
  ok: boolean;
  violations: LintViolation[];
}

const FORBIDDEN_WORD = /\b(safe|safely|unsafe|correct|correctly|incorrect|prevent|prevents|prevented|preventing|prevention)\b/i;
const MONEY = /(?:\$|€|£|¥)\s?\d|\b\d[\d,]*(?:\.\d+)?\s?(?:USD|EUR|GBP|dollars?|cents?)\b/i;
const SEALED = /\bsealed\b/i;
const ESTIMATE_WORDS = /\b(estimate[ds]?|estimation|saving|savings|saved|would have cost|counterfactual)\b/i;
const TRUST_CLAIM =
  /\b(minutes?|seconds?|hours?)\s+to\s+trust\b|\btrust(ed)?\s+in\s+(under\s+|about\s+)?\d+\s*(minutes?|seconds?|hours?|min|s|h)\b|\breview[- ]time\b|\btime\s+to\s+review\b|\bwithout\s+re-?check(ing)?\b|\bno\s+need\s+to\s+(re-?check|review)\b|\btrust(ed)?\s+without\b/i;
const SAVINGS_PERCENTAGE = /\d+(?:\.\d+)?\s?%[^.\n]*\b(sav(e[sd]?|ings?)|cheaper|less|reduction|reduced)\b|\b(sav(e[sd]?|ings?)|cheaper|reduction|reduced)\b[^.\n]*\d+(?:\.\d+)?\s?%/i;
const REVERT = /\brevert(s|ed)?\b/i;
const NOT_CHECKED = /^not checked$/i;

const MODE_VERB_REGEX: Record<Mode, RegExp> = {
  off: NOT_CHECKED,
  observe: /\bflagged\b/i,
  nudge: /\bflagged, agent nudged\b/i,
  enforce: /\bstopped\b/i,
};

/** Verbs that must not appear under a mode: another mode's verb read as this one's. */
const OTHER_MODE_VERBS: Record<Mode, RegExp[]> = {
  off: [/\bflagged\b/i, /\bnudged\b/i, /\bstopped\b/i],
  observe: [/\bnudged\b/i, /\bstopped\b/i],
  nudge: [/\bstopped\b/i],
  enforce: [/\bflagged\b/i, /\bnudged\b/i],
};

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function coverageShown(line: RenderedLine): boolean {
  const cov = line.coverage;
  return (
    isObject(cov) &&
    Number.isInteger(cov.judged) &&
    Number.isInteger(cov.total) &&
    (cov.judged as number) >= 0 &&
    (cov.total as number) >= (cov.judged as number)
  );
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function argumentsAppear(text: string, args: unknown): boolean {
  if (args === undefined || args === null) return false;
  const needles: string[] = [];
  const walk = (v: unknown): void => {
    if (typeof v === "string") {
      if (v.length >= 3) needles.push(v);
    } else if (typeof v === "number" || typeof v === "boolean") {
      needles.push(String(v));
    } else if (Array.isArray(v)) {
      v.forEach(walk);
    } else if (isObject(v)) {
      Object.values(v).forEach(walk);
    }
  };
  walk(args);
  if (needles.length === 0) return false;
  try {
    needles.push(JSON.stringify(args));
  } catch {
    /* unserialisable arguments: the walked values are enough */
  }
  return needles.some((n) => n.length > 0 && text.includes(n));
}

function lintLine(surface: Surface, line: RenderedLine, index: number, out: LintViolation[]): void {
  const push = (rule: LintRule): void => {
    out.push({ rule, line: index, text: isObject(line) && typeof line.text === "string" ? line.text : "" });
  };
  if (!isObject(line) || typeof line.text !== "string" || typeof line.class !== "string") {
    push(LINT_RULES.one_class_per_line);
    return;
  }
  const text = line.text;
  const onCard = CARD_SURFACES.includes(surface);

  // one class per line: a known class, and the field's class when the field is named.
  const cls = line.class as ClaimClass;
  if (!(CLAIM_CLASSES as readonly string[]).includes(cls)) {
    push(LINT_RULES.one_class_per_line);
  } else if (line.field !== undefined) {
    if (!isClaimField(line.field)) {
      push(LINT_RULES.one_class_per_line);
    } else {
      const entry: ClaimTableEntry = CLAIM_TABLE[line.field];
      if (entry.class !== cls) push(LINT_RULES.one_class_per_line);
      if (entry.surfaces && !(entry.surfaces as readonly Surface[]).includes(surface)) {
        push(LINT_RULES.field_not_on_surface);
      }
    }
  }
  // A line of one class never borrows another class's words.
  if (cls !== "estimate" && ESTIMATE_WORDS.test(text)) push(LINT_RULES.one_class_per_line);

  if (FORBIDDEN_WORD.test(text)) push(LINT_RULES.forbidden_word);

  const isGoal = line.field === "goal";
  const isProtection = line.field === "protection";
  if ((isGoal || isProtection) && MONEY.test(text)) push(LINT_RULES.money_on_goal_or_protection);
  if (line.field !== undefined && isClaimField(line.field) && !CLAIM_TABLE[line.field].money_allowed) {
    if (!isGoal && !isProtection && MONEY.test(text)) push(LINT_RULES.one_class_per_line);
  }

  if (isGoal) {
    if (line.goal_mode === "implicit" && SEALED.test(text)) push(LINT_RULES.implicit_goal_sealed);
    if (line.goal_mode === "off" && !NOT_CHECKED.test(text.trim())) push(LINT_RULES.goal_off_not_checked);
  }

  if (cls === "estimate" || ESTIMATE_WORDS.test(text)) {
    if (ESTIMATE_FORBIDDEN_SURFACES.includes(surface)) push(LINT_RULES.estimate_on_forbidden_surface);
  }

  if (line.mode !== undefined) {
    if (!(MODES as readonly string[]).includes(line.mode)) {
      push(LINT_RULES.verb_mismatch);
    } else {
      const mode = line.mode;
      if (!MODE_VERB_REGEX[mode].test(mode === "off" ? text.trim() : text)) push(LINT_RULES.verb_mismatch);
      else if (OTHER_MODE_VERBS[mode].some((re) => re.test(text))) push(LINT_RULES.verb_mismatch);
      if (mode === "enforce") {
        const name = typeof line.tool_name === "string" ? line.tool_name.trim() : "";
        const nameShown = name.length > 0 && new RegExp(`(^|[^A-Za-z0-9_])${escapeRegExp(name)}([^A-Za-z0-9_]|$)`).test(text);
        if (onCard) {
          if (nameShown) push(LINT_RULES.tool_name_on_card);
        } else if (!nameShown) {
          push(LINT_RULES.enforce_without_tool_name);
        }
      }
    }
  }
  if (argumentsAppear(text, line.tool_arguments)) push(LINT_RULES.tool_arguments_shown);

  if (TRUST_CLAIM.test(text)) push(LINT_RULES.trust_claim);
  if (SAVINGS_PERCENTAGE.test(text)) push(LINT_RULES.savings_percentage);
  if (cls === "benchmark") push(LINT_RULES.benchmark_not_published);
  if (cls === "verdict" && !coverageShown(line)) push(LINT_RULES.verdict_without_coverage);
  if (onCard && cls !== "measured" && cls !== "verdict" && cls !== "outcome") push(LINT_RULES.card_class_not_allowed);
}

/** Lint one rendering. Never throws; a malformed rendering is a violation. */
export function lintRendering(rendering: unknown): LintResult {
  const violations: LintViolation[] = [];
  if (!isObject(rendering) || !Array.isArray(rendering.lines)) {
    return { ok: false, violations: [{ rule: LINT_RULES.unknown_surface, line: -1, text: "" }] };
  }
  const surface = rendering.surface;
  if (!(SURFACES as readonly unknown[]).includes(surface)) {
    return { ok: false, violations: [{ rule: LINT_RULES.unknown_surface, line: -1, text: String(surface) }] };
  }
  const lines = rendering.lines as RenderedLine[];
  lines.forEach((line, i) => lintLine(surface as Surface, line, i, violations));

  if (surface === "period_card") {
    const hasRevert = lines.some(
      (l) => isObject(l) && l.class === "outcome" && typeof l.text === "string" && REVERT.test(l.text),
    );
    if (!hasRevert) violations.push({ rule: LINT_RULES.period_card_without_revert, line: -1, text: "" });
  }

  return { ok: violations.length === 0, violations };
}

/** Lint several renderings and keep each result keyed by its position. */
export function lintRenderings(renderings: unknown[]): LintResult[] {
  return renderings.map(lintRendering);
}
