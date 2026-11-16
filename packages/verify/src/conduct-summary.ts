/**
 * Threat model: packages/verify-page/THREAT-MODEL.md
 *
 * `AAP-ConductRecord/v2`: the bounded conduct record (normative spec
 * `specs/aap-conductrecord-v2.md`).
 *
 * A v1 conduct record lists every protection act and every checkpoint
 * citation of its lineage, so it grows with the session. v2 replaces the two
 * lists with summaries committed by a sha256 hash chain ("fold"):
 *
 *   fold(h0, [t1..tn]): h_i = SHA-256(h_{i-1} || UTF-8(canonicalJson(t_i)))
 *
 * - `checkpoints`: counts, `digest = fold(CKPT_SEED, every citation)`, and
 *   the newest citations in full (`tail`, at most 32) with the fold state
 *   before them (`tail_from_digest`), so `digest = fold(tail_from_digest, tail)`
 *   is checkable from the statement alone.
 * - `protection`: the act total, counts grouped by (mode, verdict, tool), and
 *   `acts_digest = fold(ACTS_SEED, every act tuple)`.
 *
 * Everything here is pure and offline. The api's producer imports `fold`,
 * `decisionRef`, `citationFromRow`, `actFromRow` and `groupActCounts` from
 * this module, so the producer and the verifier share one implementation of
 * the byte rules and the grouping.
 */

import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, concatBytes, hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";

import { canonicalJson } from "./canonical.js";
import { MODES, PROTECTION_VERDICTS, protectionVerb, type Mode, type ProtectionVerdict } from "./claim-table.js";
import {
  FLAGS,
  LISTS_MISMATCHES,
  LISTS_TYP,
  REASONS,
  type ActTuple,
  type CheckpointSummary,
  type CheckpointTuple,
  type ListsMismatch,
  type ProtectionGroup,
  type ProtectionSummary,
  type Reason,
  type StatementFlag,
} from "./statements.js";

export const CONDUCT_RECORD_V1_TYP = "AAP-ConductRecord/v1" as const;
export const CONDUCT_RECORD_V2_TYP = "AAP-ConductRecord/v2" as const;

/** Domain-separation strings of the two folds. Each seed is the SHA-256 of its string. */
export const CKPT_SEED_STRING = "AAP-ConductRecord/v2/checkpoints";
export const ACTS_SEED_STRING = "AAP-ConductRecord/v2/acts";
/** `SHA-256("AAP-ConductRecord/v2/checkpoints")`: the checkpoint fold's start, and its value over no citations. */
export const CKPT_SEED_HEX = "f785dba4fd7921589a92cfc78cb1a76b3b86f906fd81b013437f7440a5577a45";
/** `SHA-256("AAP-ConductRecord/v2/acts")`: the act fold's start, and its value over no acts. */
export const ACTS_SEED_HEX = "636e3beabb000b277895117585ba15c71fe2642db841003e3df015e5a78d9fc9";
/** `decision_ref = SHA-256(DECISION_REF_PREFIX || lower(decision id))`, lowercase hex. */
export const DECISION_REF_PREFIX = "AAP-DecisionRef/v1\n";

/** Most citations a v2 statement carries in full. */
export const SUMMARY_TAIL_MAX = 32;
/** Most `protection.by` rows. */
export const SUMMARY_GROUPS_MAX = 64;
/** Most `protection.by` rows that name a tool when the grouping overflows (§7). */
export const SUMMARY_GROUPS_NAMED_MAX = 44;
/** The producer never signs a v2 statement whose canonical JSON is over this many UTF-8 bytes (§10). */
export const V2_MAX_BYTES = 131_072;
/**
 * The verifier's byte ceiling (§10, §11.1): a v2 statement whose canonical
 * JSON (signature included) is over this many UTF-8 bytes is
 * `summary_inconsistent`. Twice `V2_MAX_BYTES`, so no statement the producer
 * signs comes near it.
 */
export const V2_CEILING_BYTES = 2 * V2_MAX_BYTES;
/** Most `lines[]` entries: the eight fixed lines and one per `protection.by` row. */
export const V2_LINES_MAX = 8 + SUMMARY_GROUPS_MAX;

const HEX64_RE = /^[0-9a-f]{64}$/;
/** `built_at` and `lists_as_of`: UTC with milliseconds, so string order is time order. */
const ISO_MS_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
/** mnemom-api `builder.ts` `ID_RE`. */
const ID_RE = /^[A-Za-z0-9_.:/+=@-]{1,256}$/;
/** mnemom-api `builder.ts` `TOOL_NAME_RE`. */
export const TOOL_NAME_RE = /^[A-Za-z0-9_.:-]{1,128}$/;
const COMMITMENT_RE = /^[A-Za-z0-9_=-]{1,512}$/;
const COMMITMENT_SIGNATURE_RE = /^[A-Za-z0-9+/_=-]{1,512}$/;
/** mnemom-api `builder.ts` `LINE_TEXT_RE`: the characters and length a line's text may have. */
const LINE_TEXT_RE = /^[A-Za-z0-9µ≈$·() ,:_./-]{1,200}$/;
const COUNT_TXT = "(?:0|[1-9][0-9]{0,15})";
const MMU_TXT = "(?:0|[1-9][0-9]{0,18})";
/** A µ figure in µ (1 µ = 1000 mmu): whole or with up to 3 decimals, "0.25". */
const MU_TXT = "(?:0|[1-9][0-9]{0,15})(?:\\.[0-9]{1,3})?";
/** A dollar figure, "$0.05". */
const USD_TXT = "\\$(?:0|[1-9][0-9]{0,12})(?:\\.[0-9]{1,6})?";

/**
 * The fixed lines of a v2 statement (§8): each key at most once, with its
 * class and the exact v1 wording it may carry (mnemom-api `claims.ts`, the
 * `WORDS` table): fixed words, counts, millimu amounts and a Canon node id.
 * So a line cannot carry free text.
 */
const FIXED_LINES: Readonly<Record<string, { class: string; text: RegExp }>> = {
  // Two renderings of the cost lines are accepted so every signed record keeps verifying.
  // Legacy (records built before the billing-figure rendering): "model cost N mmu", "µ N mmu",
  // "≈ N mmu (pending)" (the record's own estimate) and "not charged".
  // Billing-figure rendering: "model $0.05"; µ is billing's `mu_charged_mmu` shown in µ
  // ("µ 0.25", "µ 0.25 so far"), "µ pending" (no billing row yet) or "µ not charged".
  "cost.model": { class: "measured", text: new RegExp(`^(?:model cost ${MMU_TXT} mmu|model ${USD_TXT})$`) },
  "cost.mu": {
    class: "measured",
    text: new RegExp(
      `^(?:µ ${MMU_TXT} mmu|≈ ${MMU_TXT} mmu \\(pending\\)|not charged|µ ${MU_TXT}|µ ${MU_TXT} so far|µ pending|µ not charged)$`,
    ),
  },
  "goal.mode": { class: "measured", text: /^(?:not checked|implicit goal|sealed contract)$/ },
  "goal.node": { class: "measured", text: /^Canon node (?:pending|mn-[a-z0-9]{6})$/ },
  "goal.verdict": {
    class: "verdict",
    text: new RegExp(`^${COUNT_TXT} of ${COUNT_TXT} judged turns on goal, ${COUNT_TXT} of ${COUNT_TXT} turns judged$`),
  },
  // Protection off reads "off" (stored mode); records built earlier read "not checked".
  "protection.mode": { class: "measured", text: /^(?:off|not checked)$/ },
  "people.messages": {
    class: "measured",
    text: new RegExp(`^(?:messages from a person: unclassified|${COUNT_TXT} messages from a person)$`),
  },
  "context.compactions": { class: "measured", text: new RegExp(`^${COUNT_TXT} compactions$`) },
};
const GROUP_LINE_KEY_RE = /^protection\.group\.(0|[1-9][0-9]?)$/;
const LINE_KEYS = ["class", "key", "text"];

/**
 * The v1-shaped blocks of a v2 statement (`goal`, `cost`, `people`,
 * `runner`, `door2`) under mnemom-api `builder.ts` `NO_CONTENT_ALLOWLIST`
 * (the subset these blocks use): every key listed, every string value of
 * its shape, every number a safe integer >= 0, null as a field value only.
 * The producer's `assertNoContent` runs the same table before signing, so a
 * block that fails here never came from it.
 */
const NO_CONTENT_BLOCKS: Readonly<Record<string, RegExp | "number" | "object" | "array">> = (() => {
  const MMU = /^(0|[1-9][0-9]{0,18})$/;
  const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
  const ENUM = /^[a-z_]{1,32}$/;
  return {
    model_cost_mmu: MMU,
    mu_charged_mmu: MMU,
    mu_provisional_mmu: MMU,
    mu_status: ENUM,
    mu_rate_bps: "number",
    row_count: "number",
    as_of: ISO,
    mode: ENUM,
    contract_sha256: HEX64_RE,
    seal_version: "number",
    seal_reason: ENUM,
    previous_contract_sha256: HEX64_RE,
    canon_node_status: /^(written|pending)$/,
    canon_node_id: /^mn-[a-z0-9]{6}$/,
    on_goal: "number",
    judged: "number",
    turns: "number",
    messages_from_person: "number",
    compactions: "number",
    kind: /^hosted$/,
    image_digest: /^sha256:[0-9a-f]{64}$/,
    execution_id: /^(h-)?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(-[0-9]{1,5})?$/,
    cluster: ID_RE,
    cell: ID_RE,
    session_id: ID_RE,
    seal_id: ID_RE,
    batch_id: ID_RE,
    reseals: "array",
    version: "number",
    resealed_by: ID_RE,
    resealed_at: ISO,
    limits: "array",
    limit: ENUM,
    from: /^(0|[1-9][0-9]{0,14})(\.[0-9]{1,9})?$/,
    to: /^(0|[1-9][0-9]{0,14})(\.[0-9]{1,9})?$/,
    siblings: "array",
    job_id: ID_RE,
    repo: /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/,
    pr_number: "number",
    usage: "object",
    wakes: "number",
    totals: "object",
    per_wake: "array",
    wake: "number",
    input_tokens: "number",
    cache_read_tokens: "number",
    cache_write_tokens: "number",
    output_tokens: "number",
    keepalive_tokens: "number",
    cost_micro_usd: "number",
  };
})();

/** True when `v` (an object or array inside a v1-shaped block) holds only `NO_CONTENT_BLOCKS` shapes. */
function noContent(v: unknown, depth = 0): boolean {
  if (depth > 8) return false;
  // An array holds objects only (no bare values, no nested arrays).
  if (Array.isArray(v)) return v.every((x) => !Array.isArray(x) && noContent(x, depth + 1));
  if (!isObject(v)) return false;
  for (const [k, x] of Object.entries(v)) {
    const shape = Object.prototype.hasOwnProperty.call(NO_CONTENT_BLOCKS, k) ? NO_CONTENT_BLOCKS[k] : undefined;
    if (shape === undefined) return false;
    if (x === null) continue;
    if (shape === "number") {
      if (!isCount(x)) return false;
    } else if (shape === "object") {
      if (Array.isArray(x) || !noContent(x, depth + 1)) return false;
    } else if (shape === "array") {
      if (!Array.isArray(x) || !noContent(x, depth + 1)) return false;
    } else if (typeof x !== "string" || !shape.test(x)) {
      return false;
    }
  }
  return true;
}

/** Every key a v2 statement must carry (§3). */
const V2_REQUIRED_KEYS = [
  "typ",
  "unit_kind",
  "org_id",
  "lineage_key",
  "signing_key_id",
  "built_at",
  "lists_as_of",
  "previous_digest",
  "goal",
  "cost",
  "people",
  "protection",
  "checkpoints",
  "lines",
];
/**
 * Keys a v2 statement may carry besides the required ones. `signature` is
 * required by the signature step, not here, so the producer can run this
 * check on the unsigned statement before signing it.
 */
const V2_OPTIONAL_KEYS = ["runner", "door2", "alg", "signature"];
const V2_KEYS = new Set([...V2_REQUIRED_KEYS, ...V2_OPTIONAL_KEYS]);

const CITATION_KEYS = ["card_hash", "checkpoint_id", "combined_commitment", "commitment_key_id", "commitment_signature"];
const ACT_KEYS = ["decision_ref", "mode", "tool_name", "tool_withheld", "verdict"];
const GROUP_KEYS = ["count", "mode", "tool_name", "verdict"];
const PROTECTION_KEYS = ["acts_digest", "acts_total", "by", "tool_names_withheld", "tools_folded"];
const CHECKPOINTS_KEYS = ["bound_count", "card_hash_count", "count", "digest", "tail", "tail_from_digest"];

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** True when `obj` has exactly `keys` as its own keys. */
function hasExactKeys(obj: Record<string, unknown>, keys: readonly string[]): boolean {
  const own = Object.keys(obj);
  return own.length === keys.length && keys.every((k) => Object.prototype.hasOwnProperty.call(obj, k));
}

const isCount = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0;
const isHex64 = (v: unknown): v is string => typeof v === "string" && HEX64_RE.test(v);
const nullOr = (v: unknown, re: RegExp): boolean => v === null || (typeof v === "string" && re.test(v));

// ---------------------------------------------------------------------------
// The fold, decision refs and tuples (§4, §5)
// ---------------------------------------------------------------------------

/**
 * Fold `items` onto the state `fromHex`: for each item in order,
 * `state = SHA-256(state || UTF-8(canonicalJson(item)))`, where state is the
 * 32 raw bytes. Returns lowercase hex; `fold(h, [])` is `h`.
 * Throws a TypeError when `fromHex` is not 64 lowercase hex.
 */
export function fold(fromHex: string, items: readonly unknown[]): string {
  if (!isHex64(fromHex)) throw new TypeError("fold: the starting state is not 64 lowercase hex characters");
  let state = hexToBytes(fromHex);
  for (const item of items) state = sha256(concatBytes(state, utf8ToBytes(canonicalJson(item))));
  return bytesToHex(state);
}

/**
 * The `decision_ref` of a protection decision id: lowercase hex of
 * `SHA-256(UTF-8("AAP-DecisionRef/v1\n" + lower(id)))`. Decision certificates
 * are public, so a statement carries this hash and never the raw id.
 */
export function decisionRef(decisionId: string): string {
  return bytesToHex(sha256(utf8ToBytes(DECISION_REF_PREFIX + decisionId.toLowerCase())));
}

/** True when a citation is bound: `combined_commitment` and `commitment_signature` both set. */
function isBound(t: CheckpointTuple): boolean {
  return t.combined_commitment !== null && t.commitment_signature !== null;
}

/**
 * True when `v` is a checkpoint citation tuple as v2 normalises it (§4):
 * exactly the five keys, `checkpoint_id` an id, the commitment and its
 * signature both set or both null, `commitment_key_id` null unless bound,
 * `card_hash` 64 lowercase hex or null. Every value is printable ASCII
 * without `"` or `\`.
 */
export function isCheckpointTuple(v: unknown): v is CheckpointTuple {
  if (!isObject(v) || !hasExactKeys(v, CITATION_KEYS)) return false;
  if (typeof v.checkpoint_id !== "string" || !ID_RE.test(v.checkpoint_id)) return false;
  if (!nullOr(v.combined_commitment, COMMITMENT_RE) || !nullOr(v.commitment_signature, COMMITMENT_SIGNATURE_RE)) {
    return false;
  }
  const bound = v.combined_commitment !== null;
  if (bound !== (v.commitment_signature !== null)) return false;
  if (!nullOr(v.commitment_key_id, ID_RE) || (!bound && v.commitment_key_id !== null)) return false;
  return nullOr(v.card_hash, HEX64_RE);
}

/**
 * True when `v` is a protection act tuple (§4): exactly the five keys (plus
 * `decision_id` when `withDecisionId`, as a lists file carries it),
 * `decision_ref` 64 lowercase hex, `mode` and `verdict` from their enums,
 * `tool_name` a tool name or null, and null whenever `tool_withheld` is true.
 */
export function isActTuple(v: unknown, withDecisionId = false): v is ActTuple {
  if (!isObject(v)) return false;
  const hasId = withDecisionId && Object.prototype.hasOwnProperty.call(v, "decision_id");
  if (!hasExactKeys(v, hasId ? [...ACT_KEYS, "decision_id"] : ACT_KEYS)) return false;
  if (hasId && (typeof v.decision_id !== "string" || v.decision_id.length === 0 || v.decision_id.length > 256)) {
    return false;
  }
  if (!isHex64(v.decision_ref)) return false;
  if (!(MODES as readonly unknown[]).includes(v.mode) || !(PROTECTION_VERDICTS as readonly unknown[]).includes(v.verdict)) {
    return false;
  }
  if (typeof v.tool_withheld !== "boolean" || !nullOr(v.tool_name, TOOL_NAME_RE)) return false;
  return !(v.tool_withheld && v.tool_name !== null);
}

/** The stored columns one checkpoint citation is built from (§4). */
export interface CheckpointRow {
  checkpoint_id: string;
  input_commitment: string | null;
  issuer_signature: string | null;
  signing_key_id: string | null;
  card_hash: string | null;
}

/** The stored columns one protection act is built from (§4). */
export interface DecisionRow {
  id: string;
  mode: string;
  verdict: string;
  tool_name: string | null;
}

/**
 * The §4 citation tuple of one stored checkpoint row: the JS reference of
 * SQL `record_ckpt_tuple`, pinned by the `row_normalisation` vectors. Bound
 * when the commitment and the signature both match their shapes; the key id
 * only when bound and an id; the card hash only when 64 lowercase hex.
 * Throws a TypeError when `checkpoint_id` is not an id (the build fails).
 */
export function citationFromRow(row: CheckpointRow): CheckpointTuple {
  if (typeof row.checkpoint_id !== "string" || !ID_RE.test(row.checkpoint_id)) {
    throw new TypeError("citationFromRow: checkpoint_id is not an id");
  }
  const bound =
    typeof row.input_commitment === "string" &&
    COMMITMENT_RE.test(row.input_commitment) &&
    typeof row.issuer_signature === "string" &&
    COMMITMENT_SIGNATURE_RE.test(row.issuer_signature);
  const keyId = bound && typeof row.signing_key_id === "string" && ID_RE.test(row.signing_key_id) ? row.signing_key_id : null;
  return {
    checkpoint_id: row.checkpoint_id,
    combined_commitment: bound ? row.input_commitment : null,
    commitment_signature: bound ? row.issuer_signature : null,
    commitment_key_id: keyId,
    card_hash: typeof row.card_hash === "string" && HEX64_RE.test(row.card_hash) ? row.card_hash : null,
  };
}

/**
 * The §4 act tuple of one stored decision row: the JS reference of SQL
 * `record_act_tuple`, pinned by the `row_normalisation` vectors. A tool name
 * that fails `TOOL_NAME_RE` is withheld (null, `tool_withheld: true`).
 * Throws a TypeError on a mode or verdict outside its enum.
 */
export function actFromRow(row: DecisionRow): ActTuple {
  if (!MODE_RANK.has(row.mode) || !VERDICT_RANK.has(row.verdict)) {
    throw new TypeError("actFromRow: mode or verdict is outside its enum");
  }
  const named = typeof row.tool_name === "string" && TOOL_NAME_RE.test(row.tool_name);
  return {
    decision_ref: decisionRef(row.id),
    mode: row.mode as Mode,
    tool_name: named ? row.tool_name : null,
    tool_withheld: row.tool_name !== null && !named,
    verdict: row.verdict as ProtectionVerdict,
  };
}

// ---------------------------------------------------------------------------
// Grouping (§7)
// ---------------------------------------------------------------------------

const MODE_RANK = new Map<string, number>(MODES.map((m, i) => [m, i]));
const VERDICT_RANK = new Map<string, number>(PROTECTION_VERDICTS.map((v, i) => [v, i]));

/** Compare by Unicode code point, as Postgres `COLLATE "C"` orders UTF-8. */
function compareCodePoints(a: string, b: string): number {
  const x = Array.from(a);
  const y = Array.from(b);
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    const d = (x[i]!.codePointAt(0) as number) - (y[i]!.codePointAt(0) as number);
    if (d !== 0) return d;
  }
  return x.length - y.length;
}

function lineBearing(g: ProtectionGroup): boolean {
  return protectionVerb(g.mode, g.verdict) !== null;
}

/** Output order: mode rank, verdict rank, then `tool_name` (null first, then by code point). */
function outputOrder(a: ProtectionGroup, b: ProtectionGroup): number {
  const m = (MODE_RANK.get(a.mode) ?? 0) - (MODE_RANK.get(b.mode) ?? 0);
  if (m !== 0) return m;
  const v = (VERDICT_RANK.get(a.verdict) ?? 0) - (VERDICT_RANK.get(b.verdict) ?? 0);
  if (v !== 0) return v;
  if (a.tool_name === b.tool_name) return 0;
  if (a.tool_name === null) return -1;
  if (b.tool_name === null) return 1;
  return compareCodePoints(a.tool_name, b.tool_name);
}

/** Which named rows survive the 64-row cap: line-bearing, then count, mode, verdict, tool. */
function keepOrder(a: ProtectionGroup, b: ProtectionGroup): number {
  const lb = Number(lineBearing(b)) - Number(lineBearing(a));
  if (lb !== 0) return lb;
  if (a.count !== b.count) return b.count - a.count;
  return outputOrder(a, b);
}

/** One `(mode, verdict, tool_name)` count, as SQL `GROUP BY mode, verdict, tool_name` returns it. */
export interface ActCount {
  mode: Mode;
  verdict: ProtectionVerdict;
  tool_name: string | null;
  count: number;
}

/**
 * Group act counts into `protection.by` (spec §7), with `tools_folded` and
 * `tool_names_withheld`. Deterministic, so a third party holding the act list
 * recomputes the signed groups exactly. This is the one implementation of the
 * 64-row cap, the 44-name ranking and the output order: the producer reads
 * plain `GROUP BY` counts from the database and passes them here.
 *
 * - `counts` may repeat a key; repeats add up. Each count is a safe integer ≥ 1.
 * - `withheld` is how many acts had a tool name withheld for shape
 *   (`tool_withheld: true`); those acts are already counted under a null tool.
 * - With more than 64 distinct rows, the 44 named rows that rank first
 *   (line-bearing first, then count descending, mode, verdict and tool name)
 *   keep their tool; every other act merges into its `(mode, verdict, null)`
 *   row, at most 20 of them. `tools_folded` counts the merged acts that had
 *   a tool name.
 * - Rows come out in mode, verdict, then tool name order (null first).
 *
 * Throws a TypeError on a mode, verdict, tool name or count outside the format.
 */
export function groupActCounts(
  counts: readonly ActCount[],
  withheld: number,
): { by: ProtectionGroup[]; tools_folded: number; tool_names_withheld: number } {
  if (!isCount(withheld)) throw new TypeError("groupActCounts: withheld is not a safe integer >= 0");
  const rows = new Map<string, ProtectionGroup>();
  const add = (mode: Mode, verdict: ProtectionVerdict, tool_name: string | null, n: number) => {
    const key = JSON.stringify([mode, verdict, tool_name]);
    const row = rows.get(key);
    if (row) row.count += n;
    else rows.set(key, { mode, verdict, tool_name, count: n });
  };
  for (const c of counts) {
    if (!MODE_RANK.has(c.mode) || !VERDICT_RANK.has(c.verdict) || !nullOr(c.tool_name, TOOL_NAME_RE)) {
      throw new TypeError("groupActCounts: a row's mode, verdict or tool name is outside the format");
    }
    if (!Number.isSafeInteger(c.count) || c.count < 1) throw new TypeError("groupActCounts: a count is not a safe integer >= 1");
    add(c.mode, c.verdict, c.tool_name, c.count);
  }
  let folded = 0;
  if (rows.size > SUMMARY_GROUPS_MAX) {
    const all = [...rows.values()];
    const keep = new Set(
      all
        .filter((r) => r.tool_name !== null)
        .sort(keepOrder)
        .slice(0, SUMMARY_GROUPS_NAMED_MAX),
    );
    rows.clear();
    for (const r of all) {
      if (keep.has(r)) {
        add(r.mode, r.verdict, r.tool_name, r.count);
        continue;
      }
      if (r.tool_name !== null) folded += r.count;
      add(r.mode, r.verdict, null, r.count);
    }
  }
  const by = [...rows.values()]
    .sort(outputOrder)
    .map((r) => ({ mode: r.mode, verdict: r.verdict, tool_name: r.tool_name, count: r.count }));
  return { by, tools_folded: folded, tool_names_withheld: withheld };
}

/**
 * Group act tuples into `protection.by` (spec §7): `groupActCounts` over one
 * count per act.
 */
export function groupActs(
  acts: readonly Pick<ActTuple, "mode" | "verdict" | "tool_name" | "tool_withheld">[],
): { by: ProtectionGroup[]; tools_folded: number; tool_names_withheld: number } {
  return groupActCounts(
    acts.map((a) => ({ mode: a.mode, verdict: a.verdict, tool_name: a.tool_name, count: 1 })),
    acts.filter((a) => a.tool_withheld).length,
  );
}

// ---------------------------------------------------------------------------
// Per-statement checks (§11.1) and flags (§11.2)
// ---------------------------------------------------------------------------

/** True when a summary digest is present in its block but is not 64 lowercase hex. */
function summaryDigestsMalformed(s: Record<string, unknown>): boolean {
  const p = s.protection;
  if (isObject(p) && !isHex64(p.acts_digest)) return true;
  const c = s.checkpoints;
  return isObject(c) && (!isHex64(c.digest) || !isHex64(c.tail_from_digest));
}

function timestampsInconsistent(s: Record<string, unknown>): boolean {
  const { built_at, lists_as_of } = s;
  if (typeof built_at !== "string" || !ISO_MS_RE.test(built_at)) return true;
  if (typeof lists_as_of !== "string" || !ISO_MS_RE.test(lists_as_of)) return true;
  return lists_as_of > built_at;
}

function isGroupRow(r: unknown): r is ProtectionGroup {
  if (!isObject(r) || !hasExactKeys(r, GROUP_KEYS)) return false;
  if (!(MODES as readonly unknown[]).includes(r.mode) || !(PROTECTION_VERDICTS as readonly unknown[]).includes(r.verdict)) {
    return false;
  }
  return nullOr(r.tool_name, TOOL_NAME_RE) && Number.isSafeInteger(r.count) && (r.count as number) >= 1;
}

function protectionInconsistent(p: unknown): boolean {
  if (!isObject(p) || !hasExactKeys(p, PROTECTION_KEYS)) return true;
  const { acts_total, tools_folded, tool_names_withheld, by, acts_digest } = p;
  if (!isCount(acts_total) || !isCount(tools_folded) || !isCount(tool_names_withheld)) return true;
  if (!Array.isArray(by) || by.length > SUMMARY_GROUPS_MAX || !by.every(isGroupRow)) return true;
  if (by.reduce((n, r) => n + r.count, 0) !== acts_total) return true;
  // The §7 output order, strictly: one row per key, so two signed `by`
  // arrays for the same acts cannot both verify.
  for (let i = 1; i < by.length; i++) if (outputOrder(by[i - 1]!, by[i]!) >= 0) return true;
  // Folded and withheld acts both sit in the null-tool rows.
  const nullCount = by.filter((r) => r.tool_name === null).reduce((n, r) => n + r.count, 0);
  if (tools_folded + tool_names_withheld > nullCount) return true;
  // Folding happens only past 64 keys, and then exactly 44 named rows remain.
  if (tools_folded > 0 && by.filter((r) => r.tool_name !== null).length !== SUMMARY_GROUPS_NAMED_MAX) return true;
  // The seed is the fold over no acts, and only over no acts.
  if (isHex64(acts_digest) && (acts_total === 0) !== (acts_digest === ACTS_SEED_HEX)) return true;
  return false;
}

/** The text v1 `protectionActLine` gives one group's line: the tool only after "stopped". */
export function groupLineText(g: Pick<ProtectionGroup, "mode" | "verdict" | "tool_name">): string | null {
  const verb = protectionVerb(g.mode, g.verdict);
  if (verb === null) return null;
  return verb === "stopped" && g.tool_name !== null ? `${verb} ${g.tool_name}` : verb;
}

/**
 * `lines` of a v2 statement (§8): at most `V2_LINES_MAX`, each exactly
 * `{class, key, text}`. A fixed key at most once, with its class and v1
 * wording; `protection.group.<i>` exactly once for each line-bearing
 * `by[i]` and for no other row, class `verdict`, text `groupLineText(by[i])`.
 */
function linesInconsistent(lines: unknown, by: unknown): boolean {
  if (!Array.isArray(lines) || lines.length > V2_LINES_MAX) return true;
  const rows = Array.isArray(by) && by.every(isGroupRow) ? by : null;
  const seen = new Set<string>();
  for (const line of lines) {
    if (!isObject(line) || !hasExactKeys(line, LINE_KEYS)) return true;
    const { class: cls, key, text } = line;
    if (typeof cls !== "string" || typeof key !== "string" || typeof text !== "string") return true;
    if (!LINE_TEXT_RE.test(text) || seen.has(key)) return true;
    seen.add(key);
    const fixed = Object.prototype.hasOwnProperty.call(FIXED_LINES, key) ? FIXED_LINES[key] : undefined;
    if (fixed) {
      if (cls !== fixed.class || !fixed.text.test(text)) return true;
      continue;
    }
    const m = GROUP_LINE_KEY_RE.exec(key);
    const row = m && rows ? rows[Number(m[1])] : undefined;
    if (!row || cls !== "verdict" || text !== groupLineText(row)) return true;
  }
  const bearing = rows ? rows.filter((r) => protectionVerb(r.mode, r.verdict) !== null).length : 0;
  return [...seen].filter((k) => GROUP_LINE_KEY_RE.test(k)).length !== bearing;
}

/**
 * The statement outside the summary blocks (§3): only the keys the format
 * defines, each required one present, `unit_kind` "conversation",
 * `lineage_key` and `org_id` ids, `previous_digest` a string or null (a
 * genesis), the v1-shaped blocks under the no-content allowlist, closed
 * lines, and the canonical JSON within `V2_CEILING_BYTES`.
 */
function statementShapeInconsistent(s: Record<string, unknown>): boolean {
  for (const k of Object.keys(s)) if (!V2_KEYS.has(k)) return true;
  for (const k of V2_REQUIRED_KEYS) if (!Object.prototype.hasOwnProperty.call(s, k)) return true;
  if (s.unit_kind !== "conversation") return true;
  if (typeof s.lineage_key !== "string" || !ID_RE.test(s.lineage_key)) return true;
  if (typeof s.org_id !== "string" || !ID_RE.test(s.org_id)) return true;
  if (s.previous_digest !== null && typeof s.previous_digest !== "string") return true;
  for (const k of ["goal", "cost", "people", "runner", "door2"]) {
    if (s[k] === undefined && (k === "runner" || k === "door2")) continue;
    if (!isObject(s[k]) || !noContent(s[k])) return true;
  }
  if (linesInconsistent(s.lines, isObject(s.protection) ? s.protection.by : undefined)) return true;
  return utf8ToBytes(canonicalJson(s)).length > V2_CEILING_BYTES;
}

function checkpointsInconsistent(c: unknown): boolean {
  if (!isObject(c) || !hasExactKeys(c, CHECKPOINTS_KEYS)) return true;
  const { count, bound_count, card_hash_count, tail, digest, tail_from_digest } = c;
  if (!isCount(count) || !isCount(bound_count) || !isCount(card_hash_count)) return true;
  if (bound_count > count || card_hash_count > count) return true;
  if (!Array.isArray(tail) || tail.length > SUMMARY_TAIL_MAX || tail.length > count) return true;
  if (!tail.every(isCheckpointTuple)) return true;
  const bound = tail.filter(isBound).length;
  if (bound > bound_count || tail.length - bound > count - bound_count) return true;
  const carded = tail.filter((t) => t.card_hash !== null).length;
  if (carded > card_hash_count || tail.length - carded > count - card_hash_count) return true;
  if (isHex64(digest) && (count === 0) !== (digest === CKPT_SEED_HEX)) return true;
  if (!isHex64(tail_from_digest)) return false;
  // The seed is the fold over no citations: the tail is the whole list
  // exactly when the fold before it is the seed.
  if ((tail.length === count) !== (tail_from_digest === CKPT_SEED_HEX)) return true;
  return isHex64(digest) && fold(tail_from_digest, tail) !== digest;
}

/**
 * The reasons an `AAP-ConductRecord/v2` statement's summary fails (§11.1),
 * at most `digest_malformed` then `summary_inconsistent`. Never throws.
 * Run after the signature: a statement that fails here was signed, but does
 * not hold together, so its counts mean nothing.
 */
export function conductSummaryReasons(statement: unknown): Reason[] {
  if (!isObject(statement)) return [REASONS.summary_inconsistent];
  const reasons: Reason[] = [];
  if (summaryDigestsMalformed(statement)) reasons.push(REASONS.digest_malformed);
  if (
    timestampsInconsistent(statement) ||
    protectionInconsistent(statement.protection) ||
    checkpointsInconsistent(statement.checkpoints) ||
    statementShapeInconsistent(statement)
  ) {
    reasons.push(REASONS.summary_inconsistent);
  }
  return reasons;
}

/**
 * The flags of a valid v2 statement (§11.2), each with its `count`:
 * `summarized` on the statement digest (the citations not in the bundle in
 * full), then `card hash not recorded` and `card not bound` on the
 * checkpoints digest when any citation lacks one. Call only on a statement
 * `conductSummaryReasons` passes.
 */
export function conductSummaryFlags(statement: Record<string, unknown>, digest: string): StatementFlag[] {
  const c = statement.checkpoints as CheckpointSummary;
  const flags: StatementFlag[] = [{ flag: FLAGS.summarized, subject: digest, count: c.count - c.tail.length }];
  const noCardHash = c.count - c.card_hash_count;
  if (noCardHash > 0) flags.push({ flag: FLAGS.card_hash_not_recorded, subject: c.digest, count: noCardHash });
  const unbound = c.count - c.bound_count;
  if (unbound > 0) flags.push({ flag: FLAGS.card_not_bound, subject: c.digest, count: unbound });
  return flags;
}

/** A conduct build's citations as the extension check reads them: count, digest and cut-off. */
function citationState(s: Record<string, unknown>): { n: number; d: string; cut: number } | null {
  if (s.typ === CONDUCT_RECORD_V1_TYP) {
    const list = s.checkpoints;
    if (!Array.isArray(list)) return null;
    // A v1 build reads its lists with no cut-off: everything up to its build.
    return { n: list.length, d: fold(CKPT_SEED_HEX, list), cut: Date.parse(String(s.built_at)) };
  }
  if (s.typ !== CONDUCT_RECORD_V2_TYP || checkpointsInconsistent(s.checkpoints)) return null;
  const c = s.checkpoints as unknown as CheckpointSummary;
  if (!isHex64(c.digest)) return null;
  return { n: c.count, d: c.digest, cut: Date.parse(String(s.lists_as_of)) };
}

/**
 * The extension check (§11.3) for an in-bundle link `prev → next` of the
 * conduct family, where `next.previous_digest` names the valid `prev` and
 * at least one of the two is v2. Flags only, never a reason: retention, a
 * backfill or a late row also change a list. A v1 → v1 link gets nothing, as
 * before v2.
 *
 * `next` v2 (`prev` v1 or v2), with `mB` the citations before `next`'s tail:
 * - `next.lists_as_of` earlier than `prev`'s cut-off (`built_at` of a v1,
 *   `lists_as_of` of a v2): `extension not checked`, since `next` may
 *   honestly lack `prev`'s newest rows.
 * - `next` cites fewer checkpoints than `prev`: `checkpoints removed since previous build`.
 * - `prev`'s count falls inside `next`'s tail: fold the tail up to that
 *   point; a result other than `prev`'s digest is `checkpoints changed since
 *   previous build`, an equal one proves the extension.
 * - More citations were added than the tail holds: `extension not checked`,
 *   with `count` the citations between `prev`'s end and the tail.
 *
 * `next` v1 after a v2 `prev` (a writer rollback): the v1 lists every
 * citation, so its first `prev.count` must fold to `prev`'s digest
 * (`changed`), and it may not cite fewer (`removed`).
 */
export function extensionFlags(prev: unknown, next: unknown, nextDigest: string): StatementFlag[] {
  if (!isObject(prev) || !isObject(next)) return [];
  if (next.typ === CONDUCT_RECORD_V1_TYP && prev.typ === CONDUCT_RECORD_V2_TYP) {
    const a = citationState(prev);
    const list = next.checkpoints;
    if (a === null || !Array.isArray(list)) return [];
    if (list.length < a.n) return [{ flag: FLAGS.checkpoints_removed, subject: nextDigest, count: a.n - list.length }];
    if (fold(CKPT_SEED_HEX, list.slice(0, a.n)) !== a.d) return [{ flag: FLAGS.checkpoints_changed, subject: nextDigest }];
    return [];
  }
  if (next.typ !== CONDUCT_RECORD_V2_TYP) return [];
  const a = citationState(prev);
  if (a === null || checkpointsInconsistent(next.checkpoints)) return [];
  const b = next.checkpoints as unknown as CheckpointSummary;
  if (!isHex64(b.tail_from_digest)) return [];
  const cutB = Date.parse(String(next.lists_as_of));
  if (!(cutB >= a.cut)) return [{ flag: FLAGS.extension_not_checked, subject: nextDigest }];
  if (b.count < a.n) return [{ flag: FLAGS.checkpoints_removed, subject: nextDigest, count: a.n - b.count }];
  const mB = b.count - b.tail.length;
  if (a.n < mB) return [{ flag: FLAGS.extension_not_checked, subject: nextDigest, count: mB - a.n }];
  if (fold(b.tail_from_digest, b.tail.slice(0, a.n - mB)) !== a.d) {
    return [{ flag: FLAGS.checkpoints_changed, subject: nextDigest }];
  }
  return [];
}

// ---------------------------------------------------------------------------
// Lists check (§11.4)
// ---------------------------------------------------------------------------

/** The fold, one item at a time: `state = SHA-256(state || UTF-8(canonicalJson(item)))`. */
function foldStep(state: Uint8Array, item: unknown): Uint8Array {
  return sha256(concatBytes(state, utf8ToBytes(canonicalJson(item))));
}

/**
 * True when `lists` is not an `AAP-RecordLists/v1` object with string
 * `statement_digest` and `lists_as_of` and at least one list (§11.4 header,
 * `list_malformed`).
 */
export function listsMalformed(lists: unknown): boolean {
  return (
    !isObject(lists) ||
    lists.typ !== LISTS_TYP ||
    typeof lists.statement_digest !== "string" ||
    typeof lists.lists_as_of !== "string" ||
    (lists.checkpoints === undefined && lists.acts === undefined)
  );
}

/**
 * Why a well-formed lists object cannot be checked against the statement it
 * names (§11.4 header), or null: the statement is not v2 (`not_conduct_v2`),
 * or `lists_as_of` is not the statement's (`as_of_mismatch`). The caller
 * matches `statement_digest` to the statement and checks that it verified.
 */
export function listsHeaderMismatch(statement: unknown, lists: Record<string, unknown>): ListsMismatch | null {
  if (!isObject(statement) || statement.typ !== CONDUCT_RECORD_V2_TYP) return LISTS_MISMATCHES.not_conduct_v2;
  if (lists.lists_as_of !== statement.lists_as_of) return LISTS_MISMATCHES.as_of_mismatch;
  return null;
}

/**
 * The lists check of one v2 statement (§11.4), fed incrementally: pass each
 * page of a list in fold order to `addCheckpoints` / `addActs`, then read
 * `result`. Memory stays bounded whatever the list length: the running fold
 * state, the counts, the last `tail.length` citations and one counter per
 * distinct `(mode, verdict, tool_name)`. Pages are joined in the order given;
 * the result is the same as checking the joined list at once.
 *
 * Use it only for a statement that verified (`verify` does that first): the
 * check proves the list against the signed digests, and a statement nobody
 * signed proves nothing.
 */
export class ConductListsCheck {
  private readonly c: CheckpointSummary;
  private readonly p: ProtectionSummary;
  private ck: {
    malformed: boolean;
    count: number;
    bound: number;
    carded: number;
    state: Uint8Array;
    last: CheckpointTuple[];
  } | null = null;
  private ac: {
    malformed: boolean;
    refMismatch: boolean;
    count: number;
    withheld: number;
    state: Uint8Array;
    groups: Map<string, ActCount>;
  } | null = null;

  /** `statement` is a v2 statement that passes `conductSummaryReasons`. */
  constructor(statement: Record<string, unknown>) {
    this.c = statement.checkpoints as CheckpointSummary;
    this.p = statement.protection as ProtectionSummary;
  }

  /** Feed the next page of the citation list (an array of citation tuples). */
  addCheckpoints(page: unknown): void {
    const st = (this.ck ??= {
      malformed: false,
      count: 0,
      bound: 0,
      carded: 0,
      state: hexToBytes(CKPT_SEED_HEX),
      last: [],
    });
    if (st.malformed) return;
    if (!Array.isArray(page)) {
      st.malformed = true;
      return;
    }
    const keep = this.c.tail.length;
    for (const t of page) {
      if (!isCheckpointTuple(t)) {
        st.malformed = true;
        return;
      }
      st.count += 1;
      if (isBound(t)) st.bound += 1;
      if (t.card_hash !== null) st.carded += 1;
      st.state = foldStep(st.state, t);
      if (keep > 0) {
        st.last.push(t);
        if (st.last.length > keep) st.last.shift();
      }
    }
  }

  /** Feed the next page of the act list (act tuples, each optionally with `decision_id`). */
  addActs(page: unknown): void {
    const st = (this.ac ??= {
      malformed: false,
      refMismatch: false,
      count: 0,
      withheld: 0,
      state: hexToBytes(ACTS_SEED_HEX),
      groups: new Map<string, ActCount>(),
    });
    if (st.malformed) return;
    if (!Array.isArray(page)) {
      st.malformed = true;
      return;
    }
    for (const a of page) {
      if (!isActTuple(a, true)) {
        st.malformed = true;
        return;
      }
      const { decision_id, ...tuple } = a as ActTuple & { decision_id?: string };
      if (decision_id !== undefined && decisionRef(decision_id) !== tuple.decision_ref) st.refMismatch = true;
      st.count += 1;
      if (tuple.tool_withheld) st.withheld += 1;
      st.state = foldStep(st.state, tuple);
      const key = JSON.stringify([tuple.mode, tuple.verdict, tuple.tool_name]);
      const g = st.groups.get(key);
      if (g) g.count += 1;
      else st.groups.set(key, { mode: tuple.mode, verdict: tuple.verdict, tool_name: tuple.tool_name, count: 1 });
    }
  }

  /** True when any page of `part` was fed. */
  supplied(part: "checkpoints" | "acts"): boolean {
    return part === "checkpoints" ? this.ck !== null : this.ac !== null;
  }

  /**
   * The part's first mismatch, in the §11.4 order, or null when it folds to
   * the signed summary. Call only for a part that was supplied.
   */
  result(part: "checkpoints" | "acts"): ListsMismatch | null {
    if (part === "checkpoints") {
      const st = this.ck;
      if (st === null || st.malformed) return LISTS_MISMATCHES.list_malformed;
      if (st.count !== this.c.count) return LISTS_MISMATCHES.count_mismatch;
      if (st.bound !== this.c.bound_count || st.carded !== this.c.card_hash_count) {
        return LISTS_MISMATCHES.binding_count_mismatch;
      }
      if (canonicalJson(st.last) !== canonicalJson(this.c.tail)) return LISTS_MISMATCHES.tail_mismatch;
      if (bytesToHex(st.state) !== this.c.digest) return LISTS_MISMATCHES.digest_mismatch;
      return null;
    }
    const st = this.ac;
    if (st === null || st.malformed) return LISTS_MISMATCHES.list_malformed;
    if (st.refMismatch) return LISTS_MISMATCHES.decision_ref_mismatch;
    if (st.count !== this.p.acts_total) return LISTS_MISMATCHES.count_mismatch;
    if (bytesToHex(st.state) !== this.p.acts_digest) return LISTS_MISMATCHES.digest_mismatch;
    const g = groupActCounts([...st.groups.values()], st.withheld);
    if (
      canonicalJson(g.by) !== canonicalJson(this.p.by) ||
      g.tools_folded !== this.p.tools_folded ||
      g.tool_names_withheld !== this.p.tool_names_withheld
    ) {
      return LISTS_MISMATCHES.groups_mismatch;
    }
    return null;
  }
}
