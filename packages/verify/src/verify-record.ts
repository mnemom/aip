/**
 * Offline verification of record statements and bundles.
 *
 * `verify(statement | bundle, jwks)` is the one entry point the CLI, CI,
 * the PR check and the web pages all call. It never touches the network:
 * the caller hands it the published JWKS.
 *
 * Order of checks for one statement, fail-closed, same as the SDK's
 * `JwksClient.verify` (mnemom-platform `shared/sdk/src/jwks.ts`):
 *
 * 1. shape and `typ` (domain separation, T3)
 * 2. `alg`, exact-match `EdDSA`, before any key material is touched
 * 3. `signing_key_id` and `signature` present and well formed
 * 4. key lookup by `kid`; the key must be an Ed25519 OKP key with `alg: EdDSA`
 * 5. Ed25519 over `canonicalJson(statement minus signature)`
 * 6. per-type rules (share card line classes, verdict coverage, the
 *    `AAP-ConductRecord/v2` summary checks of conduct-summary.ts)
 * 7. flags on cited checkpoints (T12) and on v2 summaries, which never change `valid`
 *
 * Across a bundle (K1.20): every link must name a statement of the right
 * type, each record's `previous_digest` chain must hold inside the bundle
 * (`chain_broken`), and, when the caller passes `expected_head_sha`, the
 * latest PR record must name that head (`head_mismatch`, `head_unbound`).
 * Conduct records v1 and v2 share one chain per lineage; a v2 build is also
 * checked to extend the build before it (flags only), and `options.lists`
 * checks lists files against the v2 digests (`summary_list_mismatch`).
 */

import { verifyAsync } from "@noble/ed25519";
import { utf8ToBytes } from "@noble/hashes/utils.js";

import { base64urlToUint8, statementCommitment, statementDigest } from "./canonical.js";
import {
  CONDUCT_RECORD_V1_TYP,
  CONDUCT_RECORD_V2_TYP,
  ConductListsCheck,
  conductSummaryFlags,
  conductSummaryReasons,
  extensionFlags,
  listsHeaderMismatch,
  listsMalformed,
} from "./conduct-summary.js";
import {
  BUNDLE_TYP,
  CARD_LINE_CLASSES,
  CONDUCT_RECORD_TYPES,
  FLAGS,
  LISTS_MISMATCHES,
  REASONS,
  STATEMENT_TYPES,
  type CheckpointCitation,
  type ListsCheck,
  type ListsCheckResult,
  type Reason,
  type RecordBundle,
  type RecordJwk,
  type RecordJwks,
  type RecordVerificationResult,
  type RecordVerifyOptions,
  type ShareCardLine,
  type SignedStatement,
  type StatementFlag,
  type StatementTyp,
  type StatementVerificationResult,
  type StatementVerifyOptions,
} from "./statements.js";

const DIGEST_RE = /^[0-9a-f]{64}$/;
/** A git commit id: sha1 (40) or sha256 (64) lowercase hex. */
const GIT_SHA_RE = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export { statementCommitment, statementDigest };

/** Pick the Ed25519 key for `kid`, or say why none can be used. */
function selectKey(jwks: RecordJwks, kid: string): { key?: Uint8Array; reason?: Reason } {
  const keys = isObject(jwks) && Array.isArray(jwks.keys) ? jwks.keys : [];
  const jwk = keys.find((k: RecordJwk) => isObject(k) && k.kid === kid);
  if (!jwk) return { reason: REASONS.key_not_found };
  // Exact-match allowlist on the key as well as the statement: a key that
  // is not declared `EdDSA` is never used, whatever its curve says.
  if (jwk.alg !== "EdDSA" || jwk.kty !== "OKP" || jwk.crv !== "Ed25519" || typeof jwk.x !== "string") {
    return { reason: REASONS.key_not_ed25519 };
  }
  let key: Uint8Array;
  try {
    key = base64urlToUint8(jwk.x);
  } catch {
    return { reason: REASONS.key_not_ed25519 };
  }
  if (key.length !== 32) return { reason: REASONS.key_not_ed25519 };
  return { key };
}

function checkpointFlags(checkpoints: unknown): StatementFlag[] {
  if (!Array.isArray(checkpoints)) return [];
  const flags: StatementFlag[] = [];
  for (const c of checkpoints as CheckpointCitation[]) {
    if (!isObject(c)) continue;
    const subject = typeof c.checkpoint_id === "string" ? c.checkpoint_id : "<no checkpoint_id>";
    if (typeof c.card_hash !== "string" || c.card_hash.length === 0) {
      flags.push({ flag: FLAGS.card_hash_not_recorded, subject });
    }
    const bound =
      typeof c.combined_commitment === "string" &&
      c.combined_commitment.length > 0 &&
      typeof c.commitment_signature === "string" &&
      c.commitment_signature.length > 0;
    if (!bound) flags.push({ flag: FLAGS.card_not_bound, subject });
  }
  return flags;
}

function shareCardReasons(lines: unknown): Reason[] {
  if (!Array.isArray(lines)) return [];
  const reasons: Reason[] = [];
  for (const line of lines as ShareCardLine[]) {
    if (!isObject(line) || !(CARD_LINE_CLASSES as readonly string[]).includes(line.class as string)) {
      reasons.push(REASONS.card_line_class_not_allowed);
      continue;
    }
    if (line.class === "verdict") {
      const cov = line.coverage;
      const ok =
        isObject(cov) &&
        Number.isInteger(cov.judged) &&
        Number.isInteger(cov.total) &&
        (cov.judged as number) >= 0 &&
        (cov.total as number) >= (cov.judged as number);
      if (!ok) reasons.push(REASONS.card_verdict_without_coverage);
    }
  }
  return [...new Set(reasons)];
}

/**
 * The predecessor link a statement names. `prev_digest` and `previous_digest`
 * are signed aliases (lead pick 2026-10-29): `previous_digest` when present,
 * else `prev_digest`, so a statement that carries only the short name gets the
 * same chain checks. `undefined` when it carries neither (not a chain member).
 * When both are present and differ, verifyStatement fails it as chain_broken.
 */
function predecessorOf(statement: Record<string, unknown>): unknown {
  if ("previous_digest" in statement) return statement.previous_digest;
  if ("prev_digest" in statement) return statement.prev_digest;
  return undefined;
}

/**
 * Every digest reference a statement carries, as written. An absent field
 * is skipped, and `previous_digest: null` is the first build (T2); anything
 * else that is not a 64-hex string is reported as `digest_malformed` rather
 * than dropped, so a non-string entry in `conduct_digests` cannot pass
 * unnoticed.
 */
function digestFieldsOf(statement: Record<string, unknown>): unknown[] {
  const out: unknown[] = [];
  const prev = predecessorOf(statement);
  if (prev !== undefined && prev !== null) out.push(prev);
  if (statement.pr_record_digest !== undefined) out.push(statement.pr_record_digest);
  if (statement.source_digest !== undefined) out.push(statement.source_digest);
  if (statement.conduct_digests !== undefined) {
    // `conduct_digests` is a list; anything else is malformed even when it
    // happens to look like one digest.
    if (Array.isArray(statement.conduct_digests)) out.push(...statement.conduct_digests);
    else out.push(null);
  }
  return out;
}

/**
 * Verify one signed statement against the published JWKS.
 * Never throws and never calls the network.
 *
 * `options.expectedTyp` and `options.expectedDigest` follow the SDK's
 * `verifyStatement` (mnemom-platform shared/sdk/src/statement.ts): same
 * reason strings and the same order. An expected `typ` outside
 * `STATEMENT_TYPES` is `unsupported_expected_typ`, then `unknown_typ`, then
 * `typ_mismatch`, all before any key is looked up. The digest is compared
 * after the signature, exactly, and a mismatch is `digest_mismatch` alone.
 */
export async function verifyStatement(
  statement: unknown,
  jwks: RecordJwks,
  options: StatementVerifyOptions = {},
): Promise<StatementVerificationResult> {
  const fail = (
    reasons: Reason[],
    partial: Partial<StatementVerificationResult> = {},
  ): StatementVerificationResult => ({
    valid: false,
    typ: null,
    digest: null,
    signing_key_id: null,
    flags: [],
    ...partial,
    reasons,
  });

  if (!isObject(statement)) return fail([REASONS.not_an_object]);
  const typ = typeof statement.typ === "string" ? statement.typ : null;
  const digest = statementDigest(statement);
  const kid = typeof statement.signing_key_id === "string" ? statement.signing_key_id : null;
  const base = { typ, digest, signing_key_id: kid };
  const opts: StatementVerifyOptions = isObject(options) ? options : {};

  const expected = opts.expectedTyp as unknown;
  if (expected !== undefined && (typeof expected !== "string" || !(STATEMENT_TYPES as readonly string[]).includes(expected))) {
    return fail([REASONS.unsupported_expected_typ], base);
  }
  if (!typ || !(STATEMENT_TYPES as readonly string[]).includes(typ)) {
    return fail([REASONS.unknown_typ], base);
  }
  if (expected !== undefined && typ !== expected) return fail([REASONS.typ_mismatch], base);
  // Algorithm-confusion guard: before any key lookup.
  if (statement.alg !== undefined && statement.alg !== "EdDSA") {
    return fail([REASONS.unsupported_alg], base);
  }
  if (!kid) return fail([REASONS.signing_key_id_missing], base);
  if (typeof statement.signature !== "string" || statement.signature.length === 0) {
    return fail([REASONS.signature_missing], base);
  }
  let sig: Uint8Array;
  try {
    sig = base64urlToUint8(statement.signature);
  } catch {
    return fail([REASONS.signature_malformed], base);
  }
  if (sig.length !== 64) return fail([REASONS.signature_malformed], base);

  const selected = selectKey(jwks, kid);
  if (!selected.key) return fail([selected.reason as Reason], base);

  let sigOk = false;
  try {
    // Strict RFC 8032 rules, as in sharecard.ts: ZIP-215 accepts a small-order key.
    sigOk = await verifyAsync(sig, utf8ToBytes(statementCommitment(statement)), selected.key, { zip215: false });
  } catch {
    sigOk = false;
  }
  if (!sigOk) return fail([REASONS.signature_invalid], base);

  if (opts.expectedDigest !== undefined && opts.expectedDigest !== digest) {
    return fail([REASONS.digest_mismatch], base);
  }

  const reasons: Reason[] = [];
  for (const d of digestFieldsOf(statement)) {
    if (typeof d !== "string" || !DIGEST_RE.test(d)) {
      reasons.push(REASONS.digest_malformed);
      break;
    }
  }
  // `prev_digest` and `previous_digest` are signed aliases (lead pick
  // 2026-10-29): a statement that carries both with different values is
  // internally inconsistent about its predecessor (K1.20).
  if ("prev_digest" in statement && "previous_digest" in statement) {
    if (statement.prev_digest !== statement.previous_digest) reasons.push(REASONS.chain_broken);
  }
  if (typ === CONDUCT_RECORD_V2_TYP) {
    for (const r of conductSummaryReasons(statement)) if (!reasons.includes(r)) reasons.push(r);
  }
  if (typ === "AAP-ShareCard/v1") reasons.push(...shareCardReasons(statement.lines));

  let flags: StatementFlag[] = [];
  if (typ === CONDUCT_RECORD_V1_TYP) flags = checkpointFlags(statement.checkpoints);
  else if (typ === CONDUCT_RECORD_V2_TYP && reasons.length === 0) flags = conductSummaryFlags(statement, digest);

  return {
    valid: reasons.length === 0,
    typ,
    digest,
    signing_key_id: kid,
    reasons,
    flags,
  };
}

/**
 * Which statement types a link field may point at. `previous_digest` is not
 * here: `chainReasons` checks it, and a broken chain fails rather than flags.
 */
const LINK_TARGETS: Record<string, readonly StatementTyp[]> = {
  conduct_digests: CONDUCT_RECORD_TYPES,
  pr_record_digest: ["AAP-PRRecord/v1"],
  source_digest: [...CONDUCT_RECORD_TYPES, "AAP-PRRecord/v1", "AAP-Outcome/v1"],
};

/**
 * The chain family of a `typ`: conduct records v1 and v2 are one family
 * (spec §9), so a lineage's builds chain across the typ change in either
 * direction. Every other typ is its own family.
 */
export function chainFamily(typ: unknown): string {
  return (CONDUCT_RECORD_TYPES as readonly unknown[]).includes(typ) ? "AAP-ConductRecord" : String(typ);
}

/** One record's chain: statements of the same family and `lineage_key`. */
function chainKey(s: Record<string, unknown>): string {
  return `${chainFamily(s.typ)}\u0000${typeof s.lineage_key === "string" ? s.lineage_key : ""}`;
}

/**
 * The `previous_digest` chain inside a bundle (T2, K1.20). Only statements
 * that carry the field (or its alias `prev_digest`, see predecessorOf) take
 * part; `null` is a genesis. For each one, by index:
 * - a non-null `previous_digest` must name a statement earlier in the bundle
 *   (build order) of the same chain family (`chainFamily`) and `lineage_key`;
 * - no two statements of one chain may name the same predecessor, and a chain
 *   has at most one root (a fork, or a spliced second history).
 * The one exception is retention: mnemom-api deletes a lineage's builds once
 * they pass 30 days (record-retention.ts), so the FIRST statement of a chain
 * in the bundle may name a predecessor the bundle does not hold. That is the
 * non-failing `lineage_truncated` flag and it takes the chain's root, so a
 * later genesis in the same chain still fails. A predecessor missing anywhere
 * else is `chain_broken`, and so is one that is in the bundle but later
 * (order is strict: the producer emits chain order).
 * A malformed `previous_digest` is `digest_malformed` (verifyStatement) and
 * is skipped here.
 */
function chainReasons(
  raw: unknown[],
  digests: (string | null)[],
): { broken: Map<number, Reason>; truncated: Map<number, string> } {
  const broken = new Map<number, Reason>();
  const truncated = new Map<number, string>();
  const indexOf = new Map<string, number>();
  digests.forEach((d, i) => {
    if (d && !indexOf.has(d)) indexOf.set(d, i);
  });
  const taken = new Set<string>();
  const seen = new Set<string>();
  raw.forEach((s, i) => {
    if (!isObject(s)) return;
    const prev = predecessorOf(s);
    if (prev === undefined) return;
    const key = chainKey(s);
    const first = !seen.has(key);
    seen.add(key);
    const root = `${key}\u0000root`;
    if (prev === null) {
      if (taken.has(root)) broken.set(i, REASONS.chain_broken);
      taken.add(root);
      return;
    }
    if (typeof prev !== "string" || !DIGEST_RE.test(prev)) return;
    const j = indexOf.get(prev);
    if (j === undefined && first) {
      truncated.set(i, prev);
      taken.add(root);
      return;
    }
    // A statement has a digest only when it is an object (verifyStatement),
    // so raw[j] is one whenever j is found.
    if (j === undefined || j >= i || chainKey(raw[j] as Record<string, unknown>) !== key) {
      broken.set(i, REASONS.chain_broken);
      return;
    }
    if (taken.has(`${key}\u0000${prev}`)) broken.set(i, REASONS.chain_broken);
    taken.add(`${key}\u0000${prev}`);
  });
  return { broken, truncated };
}

/**
 * The head binding (K1.20): the latest verified `AAP-PRRecord/v1` in build
 * order must name `expected` as its `head_sha`. The PR record is signed, so
 * an edited bundle cannot move it to another head without failing its
 * signature.
 */
function headReason(
  raw: unknown[],
  statements: StatementVerificationResult[],
  expected: string,
): Reason | null {
  for (let i = raw.length - 1; i >= 0; i--) {
    const s = raw[i];
    if (!statements[i]?.valid || !isObject(s) || s.typ !== "AAP-PRRecord/v1") continue;
    if (typeof s.head_sha !== "string") continue;
    return s.head_sha === expected ? null : REASONS.head_mismatch;
  }
  return REASONS.head_unbound;
}

/** Each lists object of `lists` in order: one object, an array, or an async iterable. */
async function* listsObjects(lists: unknown): AsyncGenerator<unknown> {
  if (Array.isArray(lists)) {
    yield* lists;
    return;
  }
  if (lists !== null && typeof lists === "object" && Symbol.asyncIterator in lists) {
    for await (const item of lists as AsyncIterable<unknown>) yield item;
    return;
  }
  yield lists;
}

/**
 * The lists check (spec §11.4) for every lists object in `lists`: each is
 * matched to the statement whose digest it names, and its lists continue
 * that statement's lists in order (pages). An object that names no statement
 * in the input, or a statement that failed, is a mismatch too: the caller
 * asked for a check that could not run. Then, per statement, one entry per
 * part: checked, a mismatch, or (when only the other part was supplied)
 * `not_supplied`.
 */
async function listsChecks(
  lists: unknown,
  raw: unknown[],
  statements: StatementVerificationResult[],
): Promise<ListsCheck[]> {
  const out: ListsCheck[] = [];
  const checks = new Map<string, ConductListsCheck>();
  for await (const file of listsObjects(lists)) {
    const named = isObject(file) && typeof file.statement_digest === "string" ? file.statement_digest : "";
    const i = named === "" ? -1 : statements.findIndex((s) => s.digest === named);
    const header = (mismatch: ListsCheck["mismatch"]) =>
      out.push({ statement_digest: named, part: "statement", ok: false, mismatch });
    if (named === "") {
      header(LISTS_MISMATCHES.list_malformed);
      continue;
    }
    if (listsMalformed(file)) {
      header(LISTS_MISMATCHES.list_malformed);
      continue;
    }
    if (i < 0) {
      header(LISTS_MISMATCHES.statement_not_found);
      continue;
    }
    if (!statements[i]!.valid) {
      header(LISTS_MISMATCHES.statement_invalid);
      continue;
    }
    const mismatch = listsHeaderMismatch(raw[i], file as Record<string, unknown>);
    if (mismatch !== null) {
      header(mismatch);
      continue;
    }
    let check = checks.get(named);
    if (check === undefined) {
      check = new ConductListsCheck(raw[i] as Record<string, unknown>);
      checks.set(named, check);
    }
    const f = file as { checkpoints?: unknown; acts?: unknown };
    if (f.checkpoints !== undefined) check.addCheckpoints(f.checkpoints);
    if (f.acts !== undefined) check.addActs(f.acts);
  }
  for (const [digest, check] of checks) {
    for (const part of ["checkpoints", "acts"] as const) {
      if (!check.supplied(part)) {
        out.push({ statement_digest: digest, part, ok: false, not_supplied: true });
        continue;
      }
      const mismatch = check.result(part);
      out.push(mismatch === null ? { statement_digest: digest, part, ok: true } : { statement_digest: digest, part, ok: false, mismatch });
    }
  }
  return out;
}

/**
 * Check lists against one v2 statement, signature first (§11.4): the
 * statement is verified against `jwks`, and a statement that does not
 * verify is `statement_invalid` whatever the lists say, since anyone can
 * build a statement and lists that agree. `lists` is one lists object, an
 * array or an async iterable of pages, as `verify`'s `options.lists`.
 *
 * `{ ok: true }` only when both lists were supplied and fold to the signed
 * digests. Otherwise the first part that is not proven: with its mismatch,
 * or `not_supplied` for a list no object carried. A mismatch says "this list
 * is not what Mnemom signed", not that it was tampered with: retention or a
 * deletion, a backfill, or a row committed late also change a list (§14).
 */
export async function checkConductLists(
  statement: unknown,
  lists: RecordVerifyOptions["lists"],
  jwks: RecordJwks,
): Promise<ListsCheckResult> {
  const r = await verify(statement, jwks, { lists: lists ?? [] });
  if (!r.statements[0]?.valid) {
    return { ok: false, part: "statement", mismatch: LISTS_MISMATCHES.statement_invalid };
  }
  const entries = r.lists_checked ?? [];
  const bad = entries.find((e) => !e.ok);
  if (bad) {
    return bad.mismatch !== undefined
      ? { ok: false, part: bad.part, mismatch: bad.mismatch }
      : { ok: false, part: bad.part, not_supplied: true };
  }
  if (entries.length === 0) return { ok: false, part: "statement", mismatch: LISTS_MISMATCHES.list_malformed };
  return { ok: true };
}

/**
 * Verify a statement or a whole bundle against the published JWKS.
 *
 * For a bundle every statement is verified on its own, then the links
 * between them are checked: a digest that names a statement in the bundle
 * must name one of the right type, and each record's `previous_digest`
 * chain must hold (`chain_broken`). A `conduct_digests`, `pr_record_digest`
 * or `source_digest` that names nothing in the bundle is flagged, not
 * failed. With `options.expected_head_sha` the input must also bind to that
 * PR head; the reasons for it are bundle-level, without an index prefix.
 *
 * Each valid `AAP-ConductRecord/v2` whose predecessor is in the bundle and
 * valid is checked to extend it (`checkpoints removed since previous build`,
 * `checkpoints changed since previous build`; flags only). With
 * `options.lists`, every lists file is checked against the v2 statement it
 * names; any mismatch adds the bundle-level `summary_list_mismatch`, and
 * `lists_checked` reports each part.
 */
export async function verify(
  input: SignedStatement | RecordBundle | unknown,
  jwks: RecordJwks,
  options: RecordVerifyOptions = {},
): Promise<RecordVerificationResult> {
  const verified_at = new Date().toISOString();
  const result = (
    valid: boolean,
    reasons: string[],
    flags: StatementFlag[],
    statements: StatementVerificationResult[],
    lists_checked?: ListsCheck[],
  ): RecordVerificationResult =>
    lists_checked === undefined
      ? { valid, reasons, flags, statements, verified_at }
      : { valid, reasons, flags, statements, verified_at, lists_checked };
  const lists = options.lists;
  /** Run the lists check when asked: the checks, and the bundle reason when one does not match. */
  const checkLists = async (raw: unknown[], statements: StatementVerificationResult[], reasons: string[]) => {
    if (lists === undefined) return undefined;
    const checked = await listsChecks(lists, raw, statements);
    if (checked.some((c) => c.mismatch !== undefined)) reasons.push(REASONS.summary_list_mismatch);
    return checked;
  };

  const expected = options.expected_head_sha;
  if (expected !== undefined && (typeof expected !== "string" || !GIT_SHA_RE.test(expected))) {
    return result(false, [REASONS.expected_head_malformed], [], []);
  }

  if (!isObject(input)) return result(false, [REASONS.bundle_not_an_object], [], []);

  // Something shaped like a bundle (it carries `statements`) under a typ
  // that is neither the bundle typ nor a statement typ: say so, instead of
  // reporting it as one unknown statement.
  if (
    input.typ !== BUNDLE_TYP &&
    Array.isArray(input.statements) &&
    !(STATEMENT_TYPES as readonly string[]).includes(input.typ as string)
  ) {
    return result(false, [REASONS.bundle_unknown_typ], [], []);
  }

  // A bare statement.
  if (input.typ !== BUNDLE_TYP) {
    const one = await verifyStatement(input, jwks);
    const reasons = one.reasons.map((r) => `0:${r}`);
    const head = expected === undefined ? null : headReason([input], [one], expected);
    if (head) reasons.push(head);
    const checked = await checkLists([input], [one], reasons);
    return result(reasons.length === 0, reasons, one.flags, [one], checked);
  }

  const rawStatements: unknown[] | null = Array.isArray(input.statements) ? input.statements : null;
  if (!rawStatements) {
    return result(false, [REASONS.bundle_statements_missing], [], []);
  }

  const statements: StatementVerificationResult[] = [];
  for (const s of rawStatements) statements.push(await verifyStatement(s, jwks));

  const byDigest = new Map<string, StatementVerificationResult>();
  statements.forEach((s) => {
    if (s.digest) byDigest.set(s.digest, s);
  });

  const chain = chainReasons(
    rawStatements,
    statements.map((s) => s.digest),
  );
  const digestIndex = new Map<string, number>();
  statements.forEach((s, i) => {
    if (s.digest && !digestIndex.has(s.digest)) digestIndex.set(s.digest, i);
  });

  const reasons: string[] = [];
  const flags: StatementFlag[] = [];
  statements.forEach((s, i) => {
    s.reasons.forEach((r) => reasons.push(`${i}:${r}`));
    const broken = chain.broken.get(i);
    if (broken && !s.reasons.includes(broken)) reasons.push(`${i}:${broken}`);
    flags.push(...s.flags);
    const cut = chain.truncated.get(i);
    if (cut && s.valid) flags.push({ flag: FLAGS.lineage_truncated, subject: cut });
    const raw = rawStatements[i];
    if (!s.valid || !isObject(raw)) return;
    // The extension check (spec §11.3): a valid v2 build whose link holds,
    // against its valid predecessor in the bundle.
    if ((raw.typ === CONDUCT_RECORD_V2_TYP || raw.typ === CONDUCT_RECORD_V1_TYP) && !broken && s.digest) {
      const prev = predecessorOf(raw);
      const j = typeof prev === "string" ? digestIndex.get(prev) : undefined;
      if (j !== undefined && j < i && statements[j]!.valid) {
        // extensionFlags returns nothing for a v1 -> v1 link.
        flags.push(...extensionFlags(rawStatements[j], raw, s.digest));
      }
    }
    for (const [field, targets] of Object.entries(LINK_TARGETS)) {
      const value = raw[field];
      const digests = Array.isArray(value) ? value : [value];
      for (const d of digests) {
        if (typeof d !== "string") continue;
        const linked = byDigest.get(d);
        if (!linked) {
          flags.push({ flag: FLAGS.linked_statement_not_in_bundle, subject: d });
          continue;
        }
        if (!linked.typ || !targets.includes(linked.typ as StatementTyp)) {
          reasons.push(`${i}:${REASONS.linked_statement_wrong_typ}`);
        }
      }
    }
  });

  if (expected !== undefined) {
    const head = headReason(rawStatements, statements, expected);
    if (head) reasons.push(head);
  }
  const checked = await checkLists(rawStatements, statements, reasons);

  return result(reasons.length === 0, reasons, flags, statements, checked);
}
