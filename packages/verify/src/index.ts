/**
 * Threat model: packages/verify-page/THREAT-MODEL.md
 *
 * @mnemom/verify
 *
 * Offline verification of AIP Integrity Certificates.
 * Given a trusted Ed25519 public key (and optionally a Merkle root),
 * verifies signatures, chain hashes, and inclusion proofs without
 * making any network calls.
 *
 * @packageDocumentation
 */

// ---------------------------------------------------------------------------
// Verification — primary user-facing API
// ---------------------------------------------------------------------------

export { verifyCertificate } from "./verify.js";

// Record statements (AAP-ConductRecord/v1 and /v2, AAP-PRRecord/v1,
// AAP-Outcome/v1, AAP-ShareCard/v1, AAP-TransparencyRoot/v1) and their
// bundle, verified against the published JWKS.
export {
  verify,
  verifyStatement,
  statementCommitment,
  statementDigest,
  chainFamily,
  checkConductLists,
} from "./verify-record.js";
export {
  STATEMENT_TYPES,
  BUNDLE_TYP,
  CARD_LINE_CLASSES,
  REASONS,
  FLAGS,
  CONDUCT_RECORD_TYPES,
  LISTS_TYP,
  LISTS_MISMATCHES,
} from "./statements.js";

// AAP-ConductRecord/v2 summaries: the fold, decision refs, grouping and the
// lists check (specs/aap-conductrecord-v2.md). The api's producer uses the
// same functions.
export {
  CONDUCT_RECORD_V1_TYP,
  CONDUCT_RECORD_V2_TYP,
  CKPT_SEED_STRING,
  ACTS_SEED_STRING,
  CKPT_SEED_HEX,
  ACTS_SEED_HEX,
  DECISION_REF_PREFIX,
  SUMMARY_TAIL_MAX,
  SUMMARY_GROUPS_MAX,
  SUMMARY_GROUPS_NAMED_MAX,
  V2_MAX_BYTES,
  V2_CEILING_BYTES,
  V2_LINES_MAX,
  TOOL_NAME_RE,
  fold,
  decisionRef,
  citationFromRow,
  actFromRow,
  groupActs,
  groupActCounts,
  groupLineText,
  isCheckpointTuple,
  isActTuple,
  conductSummaryReasons,
  conductSummaryFlags,
  extensionFlags,
  ConductListsCheck,
} from "./conduct-summary.js";
export type { ActCount, CheckpointRow, DecisionRow } from "./conduct-summary.js";

// Claim table (T5), claim-lint (K1.17) and the render-estimate rule (T8).
export {
  CLAIM_CLASSES,
  CLAIM_TABLE,
  SURFACES,
  CARD_SURFACES,
  ESTIMATE_FORBIDDEN_SURFACES,
  MODES,
  MODE_VERBS,
  PROTECTION_VERDICTS,
  protectionVerb,
  GOAL_MODES,
  isClaimField,
  LINE_KEY_FIELDS,
  fieldForLineKey,
} from "./claim-table.js";
export { lintRendering, lintRenderings, attachLineContext, LINT_RULES } from "./claim-lint.js";
export {
  estimateQualifies,
  shouldRenderEstimate,
  ESTIMATE_COUNTING_FLOOR_TOKENS,
  ESTIMATE_DISQUALIFIERS,
  RENDER_ESTIMATE_REASONS,
} from "./render-estimate.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type {
  IntegrityCertificate,
  VerificationResult,
  VerifierOptions,
  // Granular sub-types (useful for consumers building on top)
  CertificateSubject,
  CertificateClaims,
  CertificateConcern,
  InputCommitments,
  SignatureProof,
  ChainProof,
  MerkleProof,
  MerkleSibling,
  CertificateProofs,
  VerdictDerivationProof,
  VerificationEndpoints,
  CheckResult,
} from "./types.js";

// ---------------------------------------------------------------------------
// AAP-ShareCard/v1 (MNE-9022)
// ---------------------------------------------------------------------------

export {
  SHARE_CARD_TYP,
  canonicalJson,
  shareCardSigningInput,
  validateShareCardShape,
  verifyShareCard,
} from "./sharecard.js";
export type {
  ShareCard,
  ShareCardLine,
  ShareCardLineKind,
  ShareCardStatementRef,
  ShareCardVerification,
} from "./sharecard.js";

export type {
  RecordJwk,
  RecordJwks,
  StatementTyp,
  SignedStatementBase,
  SignedStatement,
  ConductRecordStatement,
  ConductRecordV2Statement,
  CheckpointTuple,
  CheckpointSummary,
  ProtectionGroup,
  ProtectionSummary,
  ActTuple,
  RecordLists,
  ListsPart,
  ListsMismatch,
  ListsCheckResult,
  ListsCheck,
  PRRecordStatement,
  OutcomeStatement,
  ShareCardStatement,
  TransparencyRootStatement,
  StatementVerifyOptions,
  ShareCardLine as RecordShareCardLine,
  CardLineClass,
  CheckpointCitation,
  RecordBundle,
  Reason,
  Flag,
  StatementFlag,
  StatementVerificationResult,
  RecordVerificationResult,
  RecordVerifyOptions,
} from "./statements.js";

export type { ClaimClass, ClaimField, ClaimTableEntry, Surface, Mode, GoalMode, ProtectionVerdict } from "./claim-table.js";
export type {
  RenderedLine,
  Rendering,
  LintRule,
  LintViolation,
  LintResult,
  StatementLine,
  StatementGoalBlock,
  StatementProtectionAct,
  StatementProtectionGroup,
} from "./claim-lint.js";
export type {
  EstimateDescription,
  EstimateDisqualifier,
  EstimateQualification,
  RenderEstimateDecision,
} from "./render-estimate.js";
