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
export { canonicalJson } from "./canonical.js";
export { STATEMENT_TYPES, BUNDLE_TYP, CARD_LINE_CLASSES, REASONS, FLAGS } from "./statements.js";

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
  ShareCardLine,
  CardLineClass,
  CheckpointCitation,
  RecordBundle,
  Reason,
  Flag,
  StatementFlag,
  StatementVerificationResult,
  RecordVerificationResult,
} from "./statements.js";
