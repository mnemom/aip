/**
 * Certificate and proof types for AIP integrity verification.
 *
 * These types describe the structure of an integrity certificate
 * produced by the AIP attestation pipeline, and the result of
 * verifying one offline.
 */

// ---------------------------------------------------------------------------
// Certificate
// ---------------------------------------------------------------------------

/** A single concern identified during integrity analysis. */
export interface CertificateConcern {
  category: string;
  severity: string;
  description: string;
}

/** Subject of the integrity certificate — identifies what was analyzed. */
export interface CertificateSubject {
  checkpoint_id: string;
  agent_id: string;
  session_id: string;
  card_id: string;
}

/** Claims made by the integrity analysis. */
export interface CertificateClaims {
  verdict: string;
  concerns: CertificateConcern[];
  confidence: number;
  reasoning_summary: string;
  analysis_model: string;
  analysis_duration_ms: number;
}

/** Cryptographic commitments over the analysis inputs. */
export interface InputCommitments {
  thinking_block_hash: string;
  card_hash: string;
  values_hash: string;
  context_hash: string;
  model_version: string;
  combined_commitment: string;
}

/** Ed25519 signature proof. */
export interface SignatureProof {
  algorithm: "Ed25519";
  key_id: string;
  value: string;
  signed_payload: string;
}

/** Hash-chain position proof. */
export interface ChainProof {
  chain_hash: string;
  prev_chain_hash: string | null;
  position: number;
}

/** A single sibling node in a Merkle inclusion proof. */
export interface MerkleSibling {
  hash: string;
  position: "left" | "right";
}

/** Merkle tree inclusion proof. */
export interface MerkleProof {
  leaf_hash: string;
  leaf_index: number;
  root: string;
  tree_size: number;
  inclusion_proof: MerkleSibling[];
}

/** Zero-knowledge verdict derivation proof (RISC Zero STARK). */
export interface VerdictDerivationProof {
  method: "RISC-Zero-STARK";
  image_id: string;
  receipt: string;
  journal: string;
  verified_at: string;
}

/** All cryptographic proofs attached to a certificate. */
export interface CertificateProofs {
  signature: SignatureProof;
  chain: ChainProof;
  merkle: MerkleProof | null;
  verdict_derivation: VerdictDerivationProof | null;
}

/** Verification endpoint URLs (informational, not used offline). */
export interface VerificationEndpoints {
  keys_url: string;
  certificate_url: string;
  verify_url: string;
}

/**
 * An AIP Integrity Certificate.
 *
 * Produced by the attestation pipeline and cryptographically bound
 * to the integrity checkpoint it attests.
 */
export interface IntegrityCertificate {
  "@context": "https://mnemom.ai/aip/v1";
  type: "IntegrityCertificate";
  version: "1.0.0";
  certificate_id: string;
  issued_at: string;
  subject: CertificateSubject;
  claims: CertificateClaims;
  input_commitments: InputCommitments;
  proofs: CertificateProofs;
  verification: VerificationEndpoints;
}

// ---------------------------------------------------------------------------
// Verification result
// ---------------------------------------------------------------------------

/** Result of a single verification check. */
export interface CheckResult {
  valid: boolean;
  details: string;
}

/** Aggregated result of verifying an integrity certificate. */
export interface VerificationResult {
  valid: boolean;
  checks: {
    signature: CheckResult;
    chain: CheckResult;
    merkle: CheckResult | null;
    verdict_derivation: CheckResult | null;
  };
  certificate_id: string;
  verified_at: string;
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

/** Options for the certificate verifier. */
export interface VerifierOptions {
  /** Ed25519 public key as hex string or Uint8Array. */
  publicKey: string | Uint8Array;

  /** Expected Merkle root (hex). If provided, Merkle proof is verified against it. */
  merkleRoot?: string;

  /** Expected RISC Zero image ID (hex). If provided, verdict derivation proof is checked against it. */
  verdictDerivationImageId?: string;
}
