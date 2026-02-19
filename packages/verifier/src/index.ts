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
