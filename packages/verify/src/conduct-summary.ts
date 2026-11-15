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
 * `decisionRef` and `groupActs` from this module, so the producer and the
 * verifier share one implementation of the byte rules.
 */

import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, concatBytes, hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";

import { canonicalJson, statementDigest } from "./canonical.js";
import { MODES, PROTECTION_VERDICTS, protectionVerb, type Mode, type ProtectionVerdict } from "./claim-table.js";
import {
  FLAGS,
  LISTS_MISMATCHES,
  LISTS_TYP,
  REASONS,
  type ActTuple,
  type CheckpointSummary,
  type CheckpointTuple,
  type ListsCheckResult,
  type ListsMismatch,
  type ListsPart,
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

const HEX64_RE = /^[0-9a-f]{64}$/;
/** `built_at` and `lists_as_of`: UTC with milliseconds, so string order is time order. */
const ISO_MS_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
/** mnemom-api `builder.ts` `ID_RE`. */
const ID_RE = /^[A-Za-z0-9_.:/+=@-]{1,256}$/;
/** mnemom-api `builder.ts` `TOOL_NAME_RE`. */
export const TOOL_NAME_RE = /^[A-Za-z0-9_.:-]{1,128}$/;
const COMMITMENT_RE = /^[A-Za-z0-9_=-]{1,512}$/;
const COMMITMENT_SIGNATURE_RE = /^[A-Za-z0-9+/_=-]{1,512}$/;

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

/**
 * Group act tuples into `protection.by` (spec §7), with `tools_folded` and
 * `tool_names_withheld`. Deterministic, so a third party holding the act list
 * recomputes the signed groups exactly.
 *
 * - Each act counts toward its `(mode, verdict, tool_name)` row.
 * - With more than 64 distinct rows, the 44 named rows that rank first
 *   (line-bearing first, then count descending, mode, verdict and tool name)
 *   keep their tool; every other act merges into its `(mode, verdict, null)`
 *   row, at most 20 of them. `tools_folded` counts the merged acts that had
 *   a tool name.
 * - Rows come out in mode, verdict, then tool name order (null first).
 */
export function groupActs(
  acts: readonly Pick<ActTuple, "mode" | "verdict" | "tool_name" | "tool_withheld">[],
): { by: ProtectionGroup[]; tools_folded: number; tool_names_withheld: number } {
  const rows = new Map<string, ProtectionGroup>();
  const add = (mode: Mode, verdict: ProtectionVerdict, tool_name: string | null, n: number) => {
    const key = JSON.stringify([mode, verdict, tool_name]);
    const row = rows.get(key);
    if (row) row.count += n;
    else rows.set(key, { mode, verdict, tool_name, count: n });
  };
  let withheld = 0;
  for (const a of acts) {
    if (a.tool_withheld) withheld += 1;
    add(a.mode, a.verdict, a.tool_name, 1);
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
  if (tools_folded + tool_names_withheld > acts_total) return true;
  // The seed is the fold over no acts, and only over no acts.
  if (isHex64(acts_digest) && (acts_total === 0) !== (acts_digest === ACTS_SEED_HEX)) return true;
  return false;
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
    checkpointsInconsistent(statement.checkpoints)
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

/**
 * The extension check (§11.3) for an in-bundle link `prev → next`, where
 * `next` is a valid v2 statement whose `previous_digest` names the valid
 * `prev` (v1 or v2) of the same lineage. Flags only, never a reason:
 * retention, a backfill or a late row also change a list.
 *
 * - `next` cites fewer checkpoints than `prev`: `checkpoints removed since previous build`.
 * - `prev`'s citation count falls inside `next`'s tail: fold the tail up to
 *   that point; a result other than `prev`'s digest is
 *   `checkpoints changed since previous build`, an equal one proves the extension.
 * - More citations were added than the tail holds: nothing to check.
 */
export function extensionFlags(prev: unknown, next: unknown, nextDigest: string): StatementFlag[] {
  if (!isObject(prev) || !isObject(next) || next.typ !== CONDUCT_RECORD_V2_TYP) return [];
  let nA: number;
  let dA: string;
  if (prev.typ === CONDUCT_RECORD_V1_TYP) {
    const list = prev.checkpoints;
    if (!Array.isArray(list)) return [];
    nA = list.length;
    dA = fold(CKPT_SEED_HEX, list);
  } else if (prev.typ === CONDUCT_RECORD_V2_TYP && isObject(prev.checkpoints) && !checkpointsInconsistent(prev.checkpoints)) {
    const c = prev.checkpoints as unknown as CheckpointSummary;
    if (!isHex64(c.digest)) return [];
    nA = c.count;
    dA = c.digest;
  } else {
    return [];
  }
  if (checkpointsInconsistent(next.checkpoints)) return [];
  const b = next.checkpoints as unknown as CheckpointSummary;
  if (!isHex64(b.tail_from_digest)) return [];
  if (b.count < nA) return [{ flag: FLAGS.checkpoints_removed, subject: nextDigest, count: nA - b.count }];
  const mB = b.count - b.tail.length;
  if (nA < mB) return [];
  if (fold(b.tail_from_digest, b.tail.slice(0, nA - mB)) !== dA) {
    return [{ flag: FLAGS.checkpoints_changed, subject: nextDigest }];
  }
  return [];
}

// ---------------------------------------------------------------------------
// Lists check (§11.4)
// ---------------------------------------------------------------------------

function checkCheckpointList(c: CheckpointSummary, list: unknown): ListsMismatch | null {
  if (!Array.isArray(list) || !list.every(isCheckpointTuple)) return LISTS_MISMATCHES.list_malformed;
  if (list.length !== c.count) return LISTS_MISMATCHES.count_mismatch;
  const bound = list.filter(isBound).length;
  const carded = list.filter((t) => t.card_hash !== null).length;
  if (bound !== c.bound_count || carded !== c.card_hash_count) return LISTS_MISMATCHES.binding_count_mismatch;
  if (canonicalJson(list.slice(list.length - c.tail.length)) !== canonicalJson(c.tail)) {
    return LISTS_MISMATCHES.tail_mismatch;
  }
  if (fold(CKPT_SEED_HEX, list) !== c.digest) return LISTS_MISMATCHES.digest_mismatch;
  return null;
}

function checkActList(p: ProtectionSummary, list: unknown): ListsMismatch | null {
  if (!Array.isArray(list) || !list.every((a) => isActTuple(a, true))) return LISTS_MISMATCHES.list_malformed;
  const tuples: ActTuple[] = [];
  for (const a of list as (ActTuple & { decision_id?: string })[]) {
    const { decision_id, ...tuple } = a;
    if (decision_id !== undefined && decisionRef(decision_id) !== a.decision_ref) {
      return LISTS_MISMATCHES.decision_ref_mismatch;
    }
    tuples.push(tuple);
  }
  if (tuples.length !== p.acts_total) return LISTS_MISMATCHES.count_mismatch;
  if (fold(ACTS_SEED_HEX, tuples) !== p.acts_digest) return LISTS_MISMATCHES.digest_mismatch;
  const g = groupActs(tuples);
  if (
    canonicalJson(g.by) !== canonicalJson(p.by) ||
    g.tools_folded !== p.tools_folded ||
    g.tool_names_withheld !== p.tool_names_withheld
  ) {
    return LISTS_MISMATCHES.groups_mismatch;
  }
  return null;
}

/**
 * Check one lists file against one statement, part by part: the header
 * first (`statement`), then `checkpoints` and `acts` when the file carries
 * them. Every entry of the result is one part; `mismatch` is absent when it
 * holds. Does not check the statement's signature: `verify` does that before
 * calling this, and a caller using it alone must verify the statement first.
 */
export function conductListsParts(
  statement: unknown,
  lists: unknown,
): { part: ListsPart; mismatch?: ListsMismatch }[] {
  const header = (mismatch: ListsMismatch) => [{ part: "statement" as const, mismatch }];
  if (
    !isObject(lists) ||
    lists.typ !== LISTS_TYP ||
    typeof lists.statement_digest !== "string" ||
    typeof lists.lists_as_of !== "string" ||
    (lists.checkpoints === undefined && lists.acts === undefined)
  ) {
    return header(LISTS_MISMATCHES.list_malformed);
  }
  if (!isObject(statement) || statement.typ !== CONDUCT_RECORD_V2_TYP) return header(LISTS_MISMATCHES.not_conduct_v2);
  if (lists.statement_digest !== statementDigest(statement)) return header(LISTS_MISMATCHES.statement_not_found);
  if (conductSummaryReasons(statement).length > 0) return header(LISTS_MISMATCHES.statement_invalid);
  if (lists.lists_as_of !== statement.lists_as_of) return header(LISTS_MISMATCHES.as_of_mismatch);
  const out: { part: ListsPart; mismatch?: ListsMismatch }[] = [];
  const part = (name: ListsPart, mismatch: ListsMismatch | null) =>
    out.push(mismatch === null ? { part: name } : { part: name, mismatch });
  if (lists.checkpoints !== undefined) {
    part("checkpoints", checkCheckpointList(statement.checkpoints as CheckpointSummary, lists.checkpoints));
  }
  if (lists.acts !== undefined) {
    part("acts", checkActList(statement.protection as ProtectionSummary, lists.acts));
  }
  return out;
}

/**
 * Check an `AAP-RecordLists/v1` file against the v2 statement it names
 * (§11.4): fold each list from its seed and recompute every signed count,
 * the tail and the groups. Returns `{ ok: true }` or the first part and
 * mismatch that failed. Never throws.
 *
 * A mismatch says "this list is not what Mnemom signed". It is not proof of
 * tampering: retention or a deletion, a backfill, or a row committed late
 * also change a list (spec §14). Does not check the statement's signature;
 * `verify(input, jwks, { lists })` does both.
 */
export function checkConductLists(statement: unknown, lists: unknown): ListsCheckResult {
  for (const p of conductListsParts(statement, lists)) {
    if (p.mismatch !== undefined) return { ok: false, part: p.part, mismatch: p.mismatch };
  }
  return { ok: true };
}
