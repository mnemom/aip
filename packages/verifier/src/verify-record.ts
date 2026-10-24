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
  type ShareCardLine,
  type SignedStatement,
  type StatementFlag,
  type StatementTyp,
  type StatementVerificationResult,
} from "./statements.js";

const DIGEST_RE = /^[0-9a-f]{64}$/;

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

function digestFieldsOf(statement: Record<string, unknown>): string[] {
  const out: unknown[] = [statement.previous_digest, statement.pr_record_digest, statement.source_digest];
  if (Array.isArray(statement.conduct_digests)) out.push(...statement.conduct_digests);
  return out.filter((d): d is string => typeof d === "string");
}

/**
 * Verify one signed statement against the published JWKS.
 * Never throws and never calls the network.
 */
export async function verifyStatement(
  statement: unknown,
  jwks: RecordJwks,
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

  if (!typ || !(STATEMENT_TYPES as readonly string[]).includes(typ)) {
    return fail([REASONS.unknown_typ], base);
  }
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
    sigOk = await verifyAsync(sig, utf8ToBytes(statementCommitment(statement)), selected.key);
  } catch {
    sigOk = false;
  }
  if (!sigOk) return fail([REASONS.signature_invalid], base);

  const reasons: Reason[] = [];
  for (const d of digestFieldsOf(statement)) {
    if (!DIGEST_RE.test(d)) {
      reasons.push(REASONS.digest_malformed);
      break;
    }
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

/** Which statement types a link field may point at. */
const LINK_TARGETS: Record<string, readonly StatementTyp[] | "same"> = {
  previous_digest: "same",
  conduct_digests: ["AAP-ConductRecord/v1"],
  pr_record_digest: ["AAP-PRRecord/v1"],
  source_digest: ["AAP-ConductRecord/v1", "AAP-PRRecord/v1", "AAP-Outcome/v1"],
};

/**
 * Verify a statement or a whole bundle against the published JWKS.
 *
 * For a bundle every statement is verified on its own, then the links
 * between them are checked: a digest that names a statement in the bundle
 * must name one of the right type. A digest that names nothing in the
 * bundle is flagged, not failed, because a long session's earlier
 * statements may live outside the bundle (design, open questions).
 */
export async function verify(
  input: SignedStatement | RecordBundle | unknown,
  jwks: RecordJwks,
): Promise<RecordVerificationResult> {
  const verified_at = new Date().toISOString();
  const result = (
    valid: boolean,
    reasons: string[],
    flags: StatementFlag[],
    statements: StatementVerificationResult[],
  ): RecordVerificationResult => ({ valid, reasons, flags, statements, verified_at });

  if (!isObject(input)) return result(false, [REASONS.bundle_not_an_object], [], []);

  // A bare statement.
  if (input.typ !== BUNDLE_TYP) {
    const one = await verifyStatement(input, jwks);
    return result(one.valid, one.reasons.map((r) => `0:${r}`), one.flags, [one]);
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

  const reasons: string[] = [];
  const flags: StatementFlag[] = [];
  statements.forEach((s, i) => {
    s.reasons.forEach((r) => reasons.push(`${i}:${r}`));
    flags.push(...s.flags);
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
        const allowed = targets === "same" ? [s.typ as StatementTyp] : targets;
        if (!linked.typ || !allowed.includes(linked.typ as StatementTyp)) {
          reasons.push(`${i}:${REASONS.linked_statement_wrong_typ}`);
        }
      }
    }
  });

  return result(reasons.length === 0, reasons, flags, statements);
}
