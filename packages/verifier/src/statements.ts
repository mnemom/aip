/**
 * Record statements: the four signed statement types the Mnemom record is
 * built from, their bundle, and the JWKS they verify against.
 *
 * Shape (design "The record", decisions T2, T3, T12):
 *
 * - Every statement carries `typ` (domain separation), `signing_key_id` (the
 *   `kid` of an Ed25519 key in the published JWKS) and a detached `signature`:
 *   base64url Ed25519 over `canonicalJson(statement minus signature)`.
 * - Statements link by digest. A statement's digest is the lowercase sha256
 *   hex of that same canonical commitment. `prev_digest` points at the
 *   previous build of the same record; a PR record lists the conduct records
 *   it rolls up; an outcome and a share card name the statement they derive
 *   from.
 * - A conduct record cites checkpoints by their signed `combined_commitment`
 *   (T12). A citation with no `card_hash` is flagged "card hash not recorded";
 *   one with no signed commitment is flagged "card not bound". Flags never
 *   make a statement invalid: they tell the reader how strong the binding is.
 * - A share card carries only measured lines, outcome lines, and verdict
 *   lines shown with their coverage. Any other class fails the card.
 */

// ---------------------------------------------------------------------------
// JWKS
// ---------------------------------------------------------------------------

/** One key from the published JWKS. Only Ed25519 OKP keys with `alg: EdDSA` are used. */
export interface RecordJwk {
  kty: string;
  crv?: string;
  x?: string;
  kid?: string;
  alg?: string;
  use?: string;
  [k: string]: unknown;
}

/** The published key set, as served at `/v1/.well-known/jwks.json`. */
export interface RecordJwks {
  keys: RecordJwk[];
}

// ---------------------------------------------------------------------------
// Statements
// ---------------------------------------------------------------------------

export const STATEMENT_TYPES = [
  "AAP-ConductRecord/v1",
  "AAP-PRRecord/v1",
  "AAP-Outcome/v1",
  "AAP-ShareCard/v1",
] as const;

export type StatementTyp = (typeof STATEMENT_TYPES)[number];

export const BUNDLE_TYP = "AAP-RecordBundle/v1" as const;

/** Fields every signed statement carries. */
export interface SignedStatementBase {
  typ: StatementTyp;
  /** `kid` of the signing key in the JWKS. */
  signing_key_id: string;
  /** base64url Ed25519 signature over `canonicalJson(statement minus signature)`. */
  signature: string;
  /** Optional, must equal `EdDSA` when present. */
  alg?: string;
  /** ISO 8601 time the statement was built. */
  issued_at?: string;
  /** Digest of the previous build of this record, or null for the first build (T2). */
  prev_digest?: string | null;
  /** Generic unit the statement is about, e.g. `pull_request`. */
  unit_kind?: string;
  [k: string]: unknown;
}

/** A checkpoint cited by a conduct record (T12). */
export interface CheckpointCitation {
  checkpoint_id: string;
  /** sha256 hex of the alignment card the checkpoint was judged against, or null when not recorded. */
  card_hash?: string | null;
  /** The checkpoint's signed `combined_commitment`, or null when none was signed. */
  combined_commitment?: string | null;
  /** The checkpoint certificate's signature over its own payload (own key, own payload per T3). */
  commitment_signature?: string | null;
  [k: string]: unknown;
}

export interface ConductRecordStatement extends SignedStatementBase {
  typ: "AAP-ConductRecord/v1";
  /** Conversation lineage the record is keyed on (T1). */
  conversation_id?: string;
  checkpoints?: CheckpointCitation[];
}

export interface PRRecordStatement extends SignedStatementBase {
  typ: "AAP-PRRecord/v1";
  /** Digests of the conduct records this PR record rolls up. */
  conduct_digests?: string[];
  /** Head SHA from before the App's bundle commit. */
  head_sha?: string;
}

export interface OutcomeStatement extends SignedStatementBase {
  typ: "AAP-Outcome/v1";
  /** Digest of the PR record this outcome belongs to. */
  pr_record_digest?: string;
  merge_sha?: string;
}

/** Claim classes a share card may carry. */
export const CARD_LINE_CLASSES = ["measured", "verdict", "outcome"] as const;
export type CardLineClass = (typeof CARD_LINE_CLASSES)[number];

export interface ShareCardLine {
  class: string;
  text: string;
  /** Required on a verdict line: "N of M judged". */
  coverage?: { judged: number; total: number } | null;
  [k: string]: unknown;
}

export interface ShareCardStatement extends SignedStatementBase {
  typ: "AAP-ShareCard/v1";
  /** Digest of the statement the card's lines were taken from. */
  source_digest?: string;
  lines?: ShareCardLine[];
}

export type SignedStatement =
  | ConductRecordStatement
  | PRRecordStatement
  | OutcomeStatement
  | ShareCardStatement;

/** A customer-held bundle: statements in build order. */
export interface RecordBundle {
  typ: typeof BUNDLE_TYP;
  statements: SignedStatement[];
  [k: string]: unknown;
}

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

/**
 * Named reasons a statement fails. Stable strings: tampered fixtures assert
 * on them, and every renderer prints them as they are.
 */
export const REASONS = {
  not_an_object: "not_an_object",
  unknown_typ: "unknown_typ",
  unsupported_alg: "unsupported_alg",
  signing_key_id_missing: "signing_key_id_missing",
  signature_missing: "signature_missing",
  signature_malformed: "signature_malformed",
  key_not_found: "key_not_found",
  key_not_ed25519: "key_not_ed25519",
  signature_invalid: "signature_invalid",
  bundle_not_an_object: "bundle_not_an_object",
  bundle_unknown_typ: "bundle_unknown_typ",
  bundle_statements_missing: "bundle_statements_missing",
  digest_malformed: "digest_malformed",
  linked_statement_wrong_typ: "linked_statement_wrong_typ",
  card_line_class_not_allowed: "card_line_class_not_allowed",
  card_verdict_without_coverage: "card_verdict_without_coverage",
} as const;

export type Reason = (typeof REASONS)[keyof typeof REASONS];

/** Named flags. A flag weakens a binding but never invalidates a statement. */
export const FLAGS = {
  card_hash_not_recorded: "card hash not recorded",
  card_not_bound: "card not bound",
  linked_statement_not_in_bundle: "linked statement not in bundle",
} as const;

export type Flag = (typeof FLAGS)[keyof typeof FLAGS];

export interface StatementFlag {
  flag: Flag;
  /** `checkpoint_id` or the digest the flag is about. */
  subject: string;
}

export interface StatementVerificationResult {
  valid: boolean;
  typ: string | null;
  /** sha256 hex of the canonical commitment, or null when the input is not an object. */
  digest: string | null;
  signing_key_id: string | null;
  reasons: Reason[];
  flags: StatementFlag[];
}

export interface RecordVerificationResult {
  valid: boolean;
  /** Reasons at the bundle level, plus every statement reason prefixed by its index. */
  reasons: string[];
  flags: StatementFlag[];
  statements: StatementVerificationResult[];
  verified_at: string;
}
