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
 * 6. per-type rules (share card line classes, verdict coverage)
 * 7. flags on cited checkpoints (T12), which never change `valid`
 *
 * Across a bundle (K1.20): every link must name a statement of the right
 * type, each record's `previous_digest` chain must hold inside the bundle
 * (`chain_broken`), and, when the caller passes `expected_head_sha`, the
 * latest PR record must name that head (`head_mismatch`, `head_unbound`).
 */

import { verifyAsync } from "@noble/ed25519";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";

import { canonicalJson, base64urlToUint8 } from "./canonical.js";
import {
  BUNDLE_TYP,
  CARD_LINE_CLASSES,
  FLAGS,
  REASONS,
  STATEMENT_TYPES,
  type CheckpointCitation,
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

/**
 * The bytes a statement's signature covers: canonical JSON of the statement
 * with `signature` removed. Exported so a signer in another language can be
 * checked against it byte for byte.
 */
export function statementCommitment(statement: Record<string, unknown>): string {
  const { signature: _signature, ...rest } = statement;
  return canonicalJson(rest);
}

/** Lowercase sha256 hex of a statement's commitment: how statements link (T2). */
export function statementDigest(statement: Record<string, unknown>): string {
  return bytesToHex(sha256(utf8ToBytes(statementCommitment(statement))));
}

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
  if (typ === "AAP-ShareCard/v1") reasons.push(...shareCardReasons(statement.lines));

  const flags = typ === "AAP-ConductRecord/v1" ? checkpointFlags(statement.checkpoints) : [];

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
  conduct_digests: ["AAP-ConductRecord/v1"],
  pr_record_digest: ["AAP-PRRecord/v1"],
  source_digest: ["AAP-ConductRecord/v1", "AAP-PRRecord/v1", "AAP-Outcome/v1"],
};

/** One record's chain: statements of the same `typ` and `lineage_key`. */
function chainKey(s: Record<string, unknown>): string {
  return `${String(s.typ)}\u0000${typeof s.lineage_key === "string" ? s.lineage_key : ""}`;
}

/**
 * The `previous_digest` chain inside a bundle (T2, K1.20). Only statements
 * that carry the field (or its alias `prev_digest`, see predecessorOf) take
 * part; `null` is a genesis. For each one, by index:
 * - a non-null `previous_digest` must name a statement earlier in the bundle
 *   (build order) with the same `typ` and `lineage_key`;
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
  ): RecordVerificationResult => ({ valid, reasons, flags, statements, verified_at });

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
    return result(reasons.length === 0, reasons, one.flags, [one]);
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

  return result(reasons.length === 0, reasons, flags, statements);
}
