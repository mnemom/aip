/**
 * @mnemom/aip-verifier
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

// Record statements (AAP-ConductRecord/v1, AAP-PRRecord/v1, AAP-Outcome/v1,
// AAP-ShareCard/v1) and their bundle, verified against the published JWKS.
export { verify, verifyStatement, statementCommitment, statementDigest } from "./verify-record.js";
export { STATEMENT_TYPES, BUNDLE_TYP, CARD_LINE_CLASSES, REASONS, FLAGS } from "./statements.js";

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
  PRRecordStatement,
  OutcomeStatement,
  ShareCardStatement,
  ShareCardLine as RecordShareCardLine,
  CardLineClass,
  CheckpointCitation,
  RecordBundle,
  Reason,
  Flag,
  StatementFlag,
  StatementVerificationResult,
  RecordVerificationResult,
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
} from "./claim-lint.js";
export type {
  EstimateDescription,
  EstimateDisqualifier,
  EstimateQualification,
  RenderEstimateDecision,
} from "./render-estimate.js";
