/**
 * Record statements: the six signed statement types the Mnemom record is
 * built from, their bundle, and the JWKS they verify against.
 *
 * Shape (design "The record", decisions T2, T3, T12):
 *
 * - Every statement carries `typ` (domain separation), `signing_key_id` (the
 *   `kid` of an Ed25519 key in the published JWKS) and a detached `signature`:
 *   base64url Ed25519 over `canonicalJson(statement minus signature)`.
 * - Statements link by digest. A statement's digest is the lowercase sha256
 *   hex of that same canonical commitment. `previous_digest` points at the
 *   previous build of the same record; a PR record lists the conduct records
 *   it rolls up; an outcome and a share card name the statement they derive
 *   from.
 * - A conduct record cites checkpoints by their signed `combined_commitment`
 *   (T12). A citation with no `card_hash` is flagged "card hash not recorded";
 *   one with no signed commitment is flagged "card not bound". Flags never
 *   make a statement invalid: they tell the reader how strong the binding is.
 * - A share card carries only measured lines, outcome lines, and verdict
 *   lines shown with their coverage. Any other class fails the card.
 * - `AAP-ConductRecord/v2` (spec `specs/aap-conductrecord-v2.md`) is a v1
 *   whose protection acts and checkpoint citations are summarised: counts, a
 *   sha256 fold digest of each list and the newest 32 citations in full. It
 *   chains with v1 builds of the same lineage.
 */

import type { Mode, ProtectionVerdict } from "./claim-table.js";

// ---------------------------------------------------------------------------
// JWKS
// ---------------------------------------------------------------------------

/**
 * One key from the published JWKS. Only Ed25519 OKP keys with `alg: EdDSA`
 * are used: a key whose `alg` is absent or anything else is refused with
 * `key_not_ed25519`, so the field is required here as it is at runtime.
 */
export interface RecordJwk {
  kty: string;
  crv?: string;
  x?: string;
  kid?: string;
  alg: string;
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
  "AAP-ConductRecord/v2",
  "AAP-PRRecord/v1",
  "AAP-Outcome/v1",
  "AAP-ShareCard/v1",
  "AAP-TransparencyRoot/v1",
] as const;

export type StatementTyp = (typeof STATEMENT_TYPES)[number];

/**
 * The conduct record typs. v1 and v2 are one chain family: a v2 build may
 * name a v1 build as its `previous_digest`, and the reverse (spec
 * `specs/aap-conductrecord-v2.md` §9).
 */
export const CONDUCT_RECORD_TYPES = ["AAP-ConductRecord/v1", "AAP-ConductRecord/v2"] as const;

/** The unsigned lists file a third party checks a v2 statement's digests against (§11.4). */
export const LISTS_TYP = "AAP-RecordLists/v1" as const;

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
  built_at?: string;
  /** Digest of the previous build of this record, or null for the first build (T2). */
  previous_digest?: string | null;
  /** `kid` of the key that made `commitment_signature`, or null when the attestation failed open. */
  commitment_key_id?: string | null;
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
  /** Lineage the record is keyed on (T1), e.g. a conversation id. */
  lineage_key?: string;
  checkpoints?: CheckpointCitation[];
}

/**
 * One checkpoint citation tuple of `AAP-ConductRecord/v2` (spec §4): exactly
 * these five keys, the shape v1's `checkpoints[]` entries already have.
 */
export interface CheckpointTuple {
  checkpoint_id: string;
  combined_commitment: string | null;
  commitment_signature: string | null;
  commitment_key_id: string | null;
  card_hash: string | null;
}

/** `checkpoints` of a v2 conduct record: counts, the fold digest, and the newest citations in full (§3, §5). */
export interface CheckpointSummary {
  count: number;
  /** Citations with `combined_commitment` and `commitment_signature` both set. */
  bound_count: number;
  /** Citations with `card_hash` set. */
  card_hash_count: number;
  /** `fold(CKPT_SEED, every citation)`, lowercase hex. */
  digest: string;
  /** `fold(CKPT_SEED, the citations before the tail)`; `digest = fold(tail_from_digest, tail)`. */
  tail_from_digest: string;
  /** The last citations in fold order, at most 32. */
  tail: CheckpointTuple[];
}

/** One row of a v2 conduct record's `protection.by` (§7). */
export interface ProtectionGroup {
  mode: Mode;
  verdict: ProtectionVerdict;
  /** A tool name, or null for acts with no tool, a withheld name, or a name folded by the 64-row cap. */
  tool_name: string | null;
  count: number;
}

/** `protection` of a v2 conduct record: totals, grouped counts and the acts digest (§3). */
export interface ProtectionSummary {
  acts_total: number;
  /** `fold(ACTS_SEED, every act tuple)`, lowercase hex. */
  acts_digest: string;
  by: ProtectionGroup[];
  /** Acts whose tool name was folded into a `tool_name: null` row by the 64-row cap. */
  tools_folded: number;
  /** Acts whose stored tool name failed the tool-name shape (`tool_withheld: true`). */
  tool_names_withheld: number;
}

/**
 * `AAP-ConductRecord/v2`: the bounded conduct record (spec
 * `specs/aap-conductrecord-v2.md`). Same signature and digest as v1; the
 * protection acts and checkpoint citations are summarised and committed by
 * sha256 fold digests, so the statement stays bounded at any session length.
 */
export interface ConductRecordV2Statement extends SignedStatementBase {
  typ: "AAP-ConductRecord/v2";
  lineage_key?: string;
  /** Both lists hold exactly the rows created at or before this instant (`built_at` minus 5 s). */
  lists_as_of?: string;
  protection?: ProtectionSummary;
  checkpoints?: CheckpointSummary;
}

/** One protection act tuple (§4). `decision_ref` hashes the decision id; the raw id is never signed. */
export interface ActTuple {
  decision_ref: string;
  mode: Mode;
  tool_name: string | null;
  /** True when the stored tool name failed the tool-name shape and is cited as null. */
  tool_withheld: boolean;
  verdict: ProtectionVerdict;
}

/**
 * An `AAP-RecordLists/v1` object (§11.4): citation and act lists behind one
 * v2 statement, in fold order, as the lists route serves them. A list may be
 * split over several objects naming the same statement (one per page); they
 * are joined in the order given. `next` is the route's page cursor and is
 * ignored. Unsigned: it is trusted only as far as it folds to the signed
 * digests.
 */
export interface RecordLists {
  typ: typeof LISTS_TYP;
  /** Digest of the v2 statement these lists belong to. */
  statement_digest: string;
  lists_as_of: string;
  checkpoints?: CheckpointTuple[];
  /** Act tuples; `decision_id`, when present, must hash to the tuple's `decision_ref`. */
  acts?: (ActTuple & { decision_id?: string })[];
  [k: string]: unknown;
}

/** Which part of a lists file a check is about. `statement` covers the file header and its match to a statement. */
export type ListsPart = "statement" | "checkpoints" | "acts";

/** Why a lists file does not match the statement it names. Stable strings. */
export const LISTS_MISMATCHES = {
  /** The lists file is not an `AAP-RecordLists/v1` object, or a list or an entry is malformed. */
  list_malformed: "list_malformed",
  /** No statement in the input has the file's `statement_digest`. */
  statement_not_found: "statement_not_found",
  /** The statement the file names failed verification, so its digests prove nothing. */
  statement_invalid: "statement_invalid",
  /** The statement the file names is not an `AAP-ConductRecord/v2`. */
  not_conduct_v2: "not_conduct_v2",
  /** The file's `lists_as_of` is not the statement's. */
  as_of_mismatch: "as_of_mismatch",
  count_mismatch: "count_mismatch",
  binding_count_mismatch: "binding_count_mismatch",
  tail_mismatch: "tail_mismatch",
  digest_mismatch: "digest_mismatch",
  decision_ref_mismatch: "decision_ref_mismatch",
  groups_mismatch: "groups_mismatch",
} as const;

export type ListsMismatch = (typeof LISTS_MISMATCHES)[keyof typeof LISTS_MISMATCHES];

/**
 * `checkConductLists` result: ok (both lists supplied and proven), or the
 * first part that is not proven, with its mismatch or `not_supplied`.
 */
export type ListsCheckResult =
  | { ok: true }
  | { ok: false; part: ListsPart; mismatch: ListsMismatch }
  | { ok: false; part: ListsPart; not_supplied: true };

/** One entry of `RecordVerificationResult.lists_checked`. */
export interface ListsCheck {
  statement_digest: string;
  part: ListsPart;
  /** True only when the part was supplied and folds to the signed digests: proven. */
  ok: boolean;
  /** Why the part does not match. Only an entry with a mismatch fails `verify` (`summary_list_mismatch`). */
  mismatch?: ListsMismatch;
  /**
   * Set (with `ok: false` and no mismatch) on a list part no lists object
   * supplied, for a statement whose other part was: not proven, not wrong.
   */
  not_supplied?: true;
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

/**
 * The signed transparency-log root mnemom-api serves at
 * `GET /v1/transparency/root` (src/transparency/root_publisher.ts). The
 * signature is Ed25519 over `canonicalJson` of the five fields below, the
 * same commitment as every other statement. It carries no `previous_digest`
 * and links to nothing, so it never takes part in a bundle's chain checks.
 */
export interface TransparencyRootStatement extends SignedStatementBase {
  typ: "AAP-TransparencyRoot/v1";
  /** Leaves in the tree when the root was computed. Typed only: the verifier checks the signature, not the value. */
  tree_size: number;
  /** Merkle root, lowercase sha256 hex. Pass it as `merkleRoot` to `verifyCertificate`. */
  root_hash: string;
  /** ISO 8601 time the root was signed. */
  published_at: string;
}

export type SignedStatement =
  | ConductRecordStatement
  | ConductRecordV2Statement
  | PRRecordStatement
  | OutcomeStatement
  | ShareCardStatement
  | TransparencyRootStatement;

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
  /** `expectedTyp` was given but is not one of `STATEMENT_TYPES`. */
  unsupported_expected_typ: "unsupported_expected_typ",
  unknown_typ: "unknown_typ",
  /** `expectedTyp` was given and the statement is of another known `typ`. Checked before any key. */
  typ_mismatch: "typ_mismatch",
  unsupported_alg: "unsupported_alg",
  signing_key_id_missing: "signing_key_id_missing",
  signature_missing: "signature_missing",
  signature_malformed: "signature_malformed",
  key_not_found: "key_not_found",
  key_not_ed25519: "key_not_ed25519",
  signature_invalid: "signature_invalid",
  /** `expectedDigest` was given and the statement's digest is not that string, exactly. */
  digest_mismatch: "digest_mismatch",
  bundle_not_an_object: "bundle_not_an_object",
  bundle_unknown_typ: "bundle_unknown_typ",
  bundle_statements_missing: "bundle_statements_missing",
  digest_malformed: "digest_malformed",
  linked_statement_wrong_typ: "linked_statement_wrong_typ",
  card_line_class_not_allowed: "card_line_class_not_allowed",
  card_verdict_without_coverage: "card_verdict_without_coverage",
  /**
   * The `previous_digest` chain of one record does not hold inside the bundle
   * (K1.20): the named build is missing, of another type or lineage, later in
   * build order, or a second build names the same predecessor (a fork, or a
   * second genesis), or the statement carries both `prev_digest` and
   * `previous_digest` with different values. Reported on the statement whose
   * link is broken.
   */
  chain_broken: "chain_broken",
  /** `expected_head_sha` was given and the latest PR record names another head (K1.20). */
  head_mismatch: "head_mismatch",
  /** `expected_head_sha` was given and no verified PR record in the input names a head (K1.20). */
  head_unbound: "head_unbound",
  /** `expected_head_sha` was given but is not a lowercase hex git commit id. */
  expected_head_malformed: "expected_head_malformed",
  /**
   * An `AAP-ConductRecord/v2` statement's summary does not hold together
   * (spec §11.1): a count, bound or shape is wrong, the statement or a line
   * carries a key or text the format does not define, it is over the byte
   * ceiling, or the tail does not fold to `digest`.
   */
  summary_inconsistent: "summary_inconsistent",
  /**
   * Bundle-level, only with `options.lists`: a lists file does not fold to the
   * signed digests of the statement it names (§11.4). It means "this list is
   * not what Mnemom signed", not that Mnemom lied: retention, a backfill or a
   * late row also change a list.
   */
  summary_list_mismatch: "summary_list_mismatch",
} as const;

export type Reason = (typeof REASONS)[keyof typeof REASONS];

/** Named flags. A flag weakens a binding but never invalidates a statement. */
export const FLAGS = {
  card_hash_not_recorded: "card hash not recorded",
  card_not_bound: "card not bound",
  linked_statement_not_in_bundle: "linked statement not in bundle",
  /**
   * The first statement of a chain in the bundle names a predecessor the
   * bundle does not hold: retention removed the lineage's older builds
   * (mnemom-api record-retention.ts). Never changes `valid`.
   */
  lineage_truncated: "lineage truncated",
  /**
   * On every valid `AAP-ConductRecord/v2`: acts are grouped and the citations
   * before the tail are committed only by digest. `count` is how many
   * citations are not in the bundle in full.
   */
  summarized: "summarized",
  /** A v2 build cites fewer checkpoints than the in-bundle build before it. `count` is how many fewer. */
  checkpoints_removed: "checkpoints removed since previous build",
  /** A conduct build's citations do not extend the in-bundle build before it. */
  checkpoints_changed: "checkpoints changed since previous build",
  /**
   * A conduct build next to a v2 build could not be checked to extend it:
   * more citations were added than the new tail holds (`count` says how many
   * lie outside it), or the new build's `lists_as_of` is earlier than the
   * cut-off of the build before it. Unknown, not wrong.
   */
  extension_not_checked: "extension not checked",
} as const;

export type Flag = (typeof FLAGS)[keyof typeof FLAGS];

export interface StatementFlag {
  flag: Flag;
  /** `checkpoint_id` or the digest the flag is about. */
  subject: string;
  /** How many items the flag covers, on the v2 summary flags; absent means one. */
  count?: number;
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

/** Options for `verifyStatement`. Both are optional, and leaving them out changes nothing. */
export interface StatementVerifyOptions {
  /**
   * The `typ` the caller expects. A statement of another `typ` fails with
   * `typ_mismatch` before any key is looked up, so a transparency root never
   * passes where a conduct record is expected, and the reverse. A value
   * outside `STATEMENT_TYPES` fails with `unsupported_expected_typ`.
   */
  expectedTyp?: StatementTyp;
  /**
   * The digest handed over beside the statement (lowercase sha256 hex of the
   * commitment). Checked after the signature. A mismatch fails with
   * `digest_mismatch`. Matched exactly, so an uppercase digest fails.
   */
  expectedDigest?: string;
}

/** Options for `verify`. */
export interface RecordVerifyOptions {
  /**
   * The PR head commit the bundle was built for: the head before the App's
   * bundle commit (`AAP-PRRecord/v1.head_sha`). When given, the latest
   * verified PR record in the input must name it, or `verify` fails with
   * `head_mismatch` / `head_unbound` (K1.20). Lowercase hex, 40 or 64 chars.
   */
  expected_head_sha?: string;
  /**
   * `AAP-RecordLists/v1` objects to check against the v2 statements they name
   * (spec §11.4): one, an array, or an async iterable (read one at a time, so
   * a lineage's lists can be checked in pages without holding them all).
   * Objects naming the same statement continue each other's lists in order.
   * Each list must fold to its statement's signed digests, or `verify` fails
   * with the bundle-level `summary_list_mismatch`. Absent, no list is checked
   * and the result has no `lists_checked`.
   */
  lists?: RecordLists | readonly RecordLists[] | AsyncIterable<RecordLists>;
}

export interface RecordVerificationResult {
  valid: boolean;
  /** Reasons at the bundle level, plus every statement reason prefixed by its index. */
  reasons: string[];
  flags: StatementFlag[];
  statements: StatementVerificationResult[];
  verified_at: string;
  /** One entry per list part checked; present only when `options.lists` was given. */
  lists_checked?: ListsCheck[];
}
