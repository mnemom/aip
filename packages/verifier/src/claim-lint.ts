/**
 * claim-lint: the mechanical check every rendering passes (criterion K1.17).
 *
 * A rendering is a surface plus the lines shown on it. Each line names its
 * class, its text, and when it comes from a mode-bearing area, the mode stored
 * at the act. The lint returns every violation with a stable rule name; it
 * never rewrites a line.
 *
 * Line shape (cross-lane pick M6): a signed statement carries
 * `{class, key, text}` per line, with the builder's keys (`cost.model`,
 * `goal.verdict`, `protection.act.0`, ...). The renderer attaches `mode`,
 * `verdict`, `goal_mode`, `tool_name` and `coverage` from the statement's
 * `goal` and `protection` blocks before linting. The lint resolves `field`
 * from `key` when `field` is absent, and off a card reads a verdict line's
 * coverage from the "<n> of <m> turns judged" words when no `coverage` object
 * is attached.
 *
 * Rules, each from the claim table (T5) and the design's claim rules:
 *   one_class_per_line          class is one of the five, and matches the field's class
 *   forbidden_word              "safe", "correct", "prevented" never appear
 *   money_on_goal_or_protection no dollar figure on a goal or protection line
 *   implicit_goal_sealed        an implicit goal line never says "sealed"
 *   goal_off_not_checked        with goals off the goal line reads "not checked"
 *   estimate_on_forbidden_surface  no estimate or savings on a card or PR comment
 *   verb_mismatch               the verb is the one the mode and the act's verdict produce, exactly
 *                               (mnemom-api `protectionVerb`); a tool name follows "stopped" only
 *   enforce_without_tool_name   "stopped" names the tool off-card
 *   tool_name_on_card           a card never shows a tool name
 *   tool_arguments_shown        tool arguments never appear
 *   trust_claim                 no minutes-to-trust, review-time or re-checking claim
 *   savings_percentage          no savings percentage anywhere until the board exists
 *   benchmark_not_published     no benchmark line ships yet
 *   verdict_without_coverage    off a card, a goal verdict always shows its coverage ("N of M turns
 *                               judged") and a protection act, one recorded decision, carries none;
 *                               on a card every verdict line carries a `coverage` object, as
 *                               `verify` requires (`card_verdict_without_coverage`)
 *   card_class_not_allowed      a card carries measured, outcome and verdict lines only
 *   period_card_without_revert  a period card renders its reverts
 *   field_not_on_surface        the field is not shown on this surface
 *   provisional_mu_on_card      a provisional μ amount ("≈ N μ (pending)", A-S-001) never appears on a card:
 *                               cards keep K1.17 and read "μ pending" at most
 *   provisional_mu_off_cost_line a provisional μ amount appears on the μ cost line and nowhere else
 */

import {
  CARD_SURFACES,
  CLAIM_CLASSES,
  CLAIM_TABLE,
  ESTIMATE_FORBIDDEN_SURFACES,
  MODES,
  MODE_VERBS,
  PROTECTION_VERDICTS,
  SURFACES,
  fieldForLineKey,
  isClaimField,
  protectionVerb,
  type ClaimClass,
  type ClaimTableEntry,
  type GoalMode,
  type Mode,
  type ProtectionVerdict,
  type Surface,
} from "./claim-table.js";

export interface RenderedLine {
  /** Record field the line renders; when present its class must match the claim table. */
  field?: string;
  /** Builder line key (`cost.model`, `goal.verdict`, `protection.act.0`, ...); resolves `field` when that is absent. */
  key?: string;
  class: string;
  text: string;
  /** Mode stored at the act, for goal and protection lines. */
  mode?: Mode;
  /** Verdict stored at a protection act; required with nudge and enforce, whose verb depends on it. */
  verdict?: ProtectionVerdict;
  /** How the goal was set, for goal lines. */
  goal_mode?: GoalMode;
  /** Tool the act concerned; shown only after "stopped", and never on a card. */
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
  provisional_mu_on_card: "provisional_mu_on_card",
  provisional_mu_off_cost_line: "provisional_mu_off_cost_line",
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

/**
 * A rule about two things in one clause ("38% … cheaper", "50 mmu … pending"), read in a
 * single left-to-right pass so the cost stays linear in the line's length; a regex bridge
 * such as `\d+%[^.\n]*\bword\b` re-scans the clause from every start (CodeQL
 * js/polynomial-redos). `tokens` is global; its named groups are the tokens, `brk` (a
 * full stop or newline outside a number) ends the clause. A number is one token: its digit
 * run always matches and its tail ("%", "mmu") is an optional named group, so no match can
 * fail after reading digits and no number is re-read from inside its run.
 */
interface ClauseRule {
  tokens: RegExp;
  /** [first, then]: the rule holds when `then` follows `first` in one clause. */
  pairs: ReadonlyArray<readonly [string, string]>;
  /** Tokens that make the rule hold on their own. */
  alone?: readonly string[];
}

function clauseHas(text: string, rule: ClauseRule): boolean {
  const seen = new Set<string>();
  for (const m of text.matchAll(rule.tokens)) {
    const kind = Object.entries(m.groups ?? {}).find(([, v]) => v !== undefined)?.[0];
    if (kind === undefined) continue;
    if (kind === "brk") {
      seen.clear();
      continue;
    }
    if (rule.alone?.includes(kind)) return true;
    if (rule.pairs.some(([first, then]) => then === kind && seen.has(first))) return true;
    seen.add(kind);
  }
  return false;
}

const FORBIDDEN_WORD = /\b(safe|safely|unsafe|correct|correctly|incorrect|prevent|prevents|prevented|preventing|prevention)\b/i;
/**
 * A currency figure. A spelled-out amount is read from the first digit of its run only
 * (`(?<!\d,+)`), so a long "9,9,9,…" is scanned once rather than from every digit.
 */
const MONEY = /(?:\$|€|£|¥)\s?\d|\b(?<!\d,+)\d[\d,]*(?:\.\d+)?\s?(?:USD|EUR|GBP|dollars?|cents?)\b/i;
const SEALED = /\bsealed\b/i;
const ESTIMATE_WORDS = /\b(estimate[ds]?|estimation|saving|savings|saved|would have cost|counterfactual)\b/i;
const TRUST_CLAIM =
  /\b(minutes?|seconds?|hours?)\s+to\s+trust\b|\btrust(ed)?\s+in\s+(under\s+|about\s+)?\d+\s*(minutes?|seconds?|hours?|min|s|h)\b|\breview[- ]time\b|\btime\s+to\s+review\b|\bwithout\s+re-?check(ing)?\b|\bno\s+need\s+to\s+(re-?check|review)\b|\btrust(ed)?\s+without\b/i;
/** A savings percentage: a percent and a saving word in one clause, either order ("less" only after). */
const SAVINGS_PERCENTAGE: ClauseRule = {
  tokens:
    /\d+(?<percent>(?:\.\d+)?\s?%)?|\b(?<less>less)\b|\b(?<saving>sav(?:e[sd]?|ings?)|cheaper|reduction|reduced)\b|(?<brk>[.\n])/gi,
  pairs: [
    ["percent", "saving"],
    ["percent", "less"],
    ["saving", "percent"],
  ],
};
const REVERT = /\brevert(s|ed)?\b/i;
/**
 * A provisional μ amount (A-S-001): an approximate figure with a pending marker,
 * "≈ 50000 mmu (pending)" or "≈ 50 μ (pending)". A bare "μ pending" (K1.4) carries no
 * amount and is not provisional. Either half alone is enough to count: a "≈" before a
 * figure, or a figure with "pending" beside it, so a renderer cannot shed one marker to
 * slip the amount onto a card.
 */
const PROVISIONAL_MU: ClauseRule = {
  tokens:
    /(?<approx>(?:≈|~|\bapprox(?:\.|imately)?\b|\babout\b)\s*\d[\d,]*(?:\.\d+)?\s*(?:mmu\b|mu\b|μ|µ))|\d[\d,]*(?<amount>(?:\.\d+)?\s*(?:mmu\b|mu\b|μ|µ))?|\b(?<pending>pending)\b|(?<brk>[.\n])/gi,
  alone: ["approx"],
  pairs: [
    ["amount", "pending"],
    ["pending", "amount"],
  ],
};
const NOT_CHECKED = /^not checked$/i;
/** Coverage written into a verdict line's words by the builder: "4 of 12 turns judged". */
const COVERAGE_IN_TEXT = /\b(\d+)\s+of\s+(\d+)\s+turns\s+judged\b/i;

/** Each verb's words, keyed by the mode whose `MODE_VERBS` entry it is. */
const MODE_VERB_REGEX: Record<Mode, RegExp> = {
  off: NOT_CHECKED,
  observe: /\bflagged\b/i,
  nudge: /\bflagged, agent nudged\b/i,
  enforce: /\bstopped\b/i,
};

/** Verbs that must not appear beside a verb: another verb read as this one. */
const OTHER_MODE_VERBS: Record<Mode, RegExp[]> = {
  off: [/\bflagged\b/i, /\bnudged\b/i, /\bstopped\b/i],
  observe: [/\bnudged\b/i, /\bstopped\b/i],
  nudge: [/\bstopped\b/i],
  enforce: [/\bflagged\b/i, /\bnudged\b/i],
};

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** A `coverage` object as `verify` accepts it on a share card line (verify-record.ts `shareCardReasons`). */
function coverageObjectValid(cov: unknown): boolean {
  return (
    isObject(cov) &&
    Number.isInteger(cov.judged) &&
    Number.isInteger(cov.total) &&
    (cov.judged as number) >= 0 &&
    (cov.total as number) >= (cov.judged as number)
  );
}

/** Coverage from the attached object, or, when none is attached, from the builder's words. */
function coverageShown(line: RenderedLine): boolean {
  const cov = line.coverage;
  if (cov !== undefined) return coverageObjectValid(cov);
  const m = COVERAGE_IN_TEXT.exec(line.text);
  return m !== null && Number(m[2]) >= Number(m[1]);
}

/**
 * The verb a mode-bearing line must show, as the `MODE_VERBS` key it reads as, or undefined
 * when the line should not exist or its verb cannot be known: a pass verdict, an unknown
 * verdict, or nudge or enforce with no verdict attached (each has two verbs).
 */
function expectedVerb(mode: Mode, verdict: unknown): Mode | undefined {
  if (mode === "off") return "off";
  if (verdict === undefined) return mode === "observe" ? "observe" : undefined;
  if (!(PROTECTION_VERDICTS as readonly unknown[]).includes(verdict)) return undefined;
  const verb = protectionVerb(mode, verdict as ProtectionVerdict);
  return MODES.find((m) => MODE_VERBS[m] === verb);
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
  // The field named on the line wins; a builder key resolves it otherwise (M6).
  const field = line.field !== undefined ? line.field : fieldForLineKey(line.key);

  // one class per line: a known class, and the field's class when the field is named.
  const cls = line.class as ClaimClass;
  if (!(CLAIM_CLASSES as readonly string[]).includes(cls)) {
    push(LINT_RULES.one_class_per_line);
  } else if (field !== undefined) {
    if (!isClaimField(field)) {
      push(LINT_RULES.one_class_per_line);
    } else {
      const entry: ClaimTableEntry = CLAIM_TABLE[field];
      if (entry.class !== cls) push(LINT_RULES.one_class_per_line);
      if (entry.surfaces && !(entry.surfaces as readonly Surface[]).includes(surface)) {
        push(LINT_RULES.field_not_on_surface);
      }
    }
  }
  // A line of one class never borrows another class's words.
  if (cls !== "estimate" && ESTIMATE_WORDS.test(text)) push(LINT_RULES.one_class_per_line);

  if (FORBIDDEN_WORD.test(text)) push(LINT_RULES.forbidden_word);

  const isGoal = field === "goal" || field === "goal_mode";
  const isProtection = field === "protection" || field === "protection_mode";
  if ((isGoal || isProtection) && MONEY.test(text)) push(LINT_RULES.money_on_goal_or_protection);
  if (field !== undefined && isClaimField(field) && !CLAIM_TABLE[field].money_allowed) {
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
    const verb = (MODES as readonly string[]).includes(line.mode) ? expectedVerb(line.mode, line.verdict) : undefined;
    const name = typeof line.tool_name === "string" ? line.tool_name.trim() : "";
    const nameShown = name.length > 0 && new RegExp(`(^|[^A-Za-z0-9_])${escapeRegExp(name)}([^A-Za-z0-9_]|$)`).test(text);
    if (verb === undefined) {
      push(LINT_RULES.verb_mismatch);
    } else if (!MODE_VERB_REGEX[verb].test(verb === "off" ? text.trim() : text)) {
      push(LINT_RULES.verb_mismatch);
    } else if (OTHER_MODE_VERBS[verb].some((re) => re.test(text))) {
      push(LINT_RULES.verb_mismatch);
    } else if (verb !== "enforce" && nameShown && !onCard) {
      // The builder names the tool after "stopped" only (mnemom-api `protectionActLine`).
      push(LINT_RULES.verb_mismatch);
    }
    if (onCard) {
      if (nameShown) push(LINT_RULES.tool_name_on_card);
    } else if (verb === "enforce" && !nameShown) {
      push(LINT_RULES.enforce_without_tool_name);
    }
  }
  if (argumentsAppear(text, line.tool_arguments)) push(LINT_RULES.tool_arguments_shown);

  // A-S-001: a provisional μ amount lives on the μ cost line and never on a card (K1.17).
  if (clauseHas(text, PROVISIONAL_MU)) {
    if (onCard) push(LINT_RULES.provisional_mu_on_card);
    if (field !== "mu_cost") push(LINT_RULES.provisional_mu_off_cost_line);
  }

  if (TRUST_CLAIM.test(text)) push(LINT_RULES.trust_claim);
  if (clauseHas(text, SAVINGS_PERCENTAGE)) push(LINT_RULES.savings_percentage);
  if (cls === "benchmark") push(LINT_RULES.benchmark_not_published);
  if (cls === "verdict") {
    // A card carries the coverage object on every verdict line, the rule `verify` enforces on a
    // signed share card; off a card a protection act has none and a goal verdict may say it in words.
    const covered = onCard ? coverageObjectValid(line.coverage) : field === "protection" || coverageShown(line);
    if (!covered) push(LINT_RULES.verdict_without_coverage);
  }
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

/** The `goal` block a conduct record statement carries (mnemom-api `src/record/builder.ts`). */
export interface StatementGoalBlock {
  mode: GoalMode;
  [k: string]: unknown;
}

/** One entry of a conduct record statement's `protection.acts[]`. */
export interface StatementProtectionAct {
  mode: Mode;
  verdict: ProtectionVerdict;
  tool_name: string | null;
  [k: string]: unknown;
}

/** A statement line as the builder signs it: one class, a stable key, the words shown. */
export interface StatementLine {
  class: string;
  key: string;
  text: string;
}

/**
 * Attach the lint context a signed statement's lines leave out (cross-lane
 * pick M6). The statement carries `{class, key, text}` only; this returns the
 * same lines with `goal_mode` on `goal.*` lines, and `mode`, `verdict` and
 * `tool_name` on `protection.act.*` lines, read from the statement's `goal`
 * and `protection.acts` blocks (`protection.act.<i>` is `acts[i]`). Coverage
 * stays in the verdict line's words; a card renderer attaches the `coverage`
 * object itself. The text is never changed.
 */
export function attachLineContext(
  lines: readonly StatementLine[],
  goal: StatementGoalBlock | null | undefined,
  protection: { acts: readonly StatementProtectionAct[] } | null | undefined,
): RenderedLine[] {
  return lines.map((line) => {
    const out: RenderedLine = { class: line.class, key: line.key, text: line.text };
    if (line.key.startsWith("goal.") && goal) out.goal_mode = goal.mode;
    if (line.key === "protection.mode") out.mode = "off";
    const act = /^protection\.act\.(\d+)$/.exec(line.key);
    if (act && protection) {
      const entry = protection.acts[Number(act[1])];
      if (entry) {
        out.mode = entry.mode;
        out.verdict = entry.verdict;
        if (entry.tool_name) out.tool_name = entry.tool_name;
      }
    }
    return out;
  });
}
