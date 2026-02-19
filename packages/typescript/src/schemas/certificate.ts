/**
 * Integrity certificate and attestation types for the Agent Integrity Protocol.
 *
 * Defines the machine-readable integrity certificate format modeled on C2PA
 * content credentials and W3C Verifiable Credentials. A certificate bundles
 * all cryptographic evidence for a checkpoint into a single, self-describing
 * document that can be independently verified.
 *
 * Also defines supporting types for Merkle inclusion proofs, chain hashes,
 * and certificate verification results.
 */

// ---------------------------------------------------------------------------
// Integrity Certificate
// ---------------------------------------------------------------------------

/**
 * A self-describing integrity certificate that bundles analysis verdicts,
 * input commitments, and cryptographic proofs into a single envelope.
 *
 * Modeled on C2PA content credentials and W3C Verifiable Credentials.
 * The certificate can be independently verified without trusting the
 * issuing server.
 */
export interface IntegrityCertificate {
  /** JSON-LD context identifier */
  '@context': 'https://mnemom.ai/aip/v1';

  /** Document type discriminator */
  type: 'IntegrityCertificate';

  /** Certificate format version */
  version: '1.0.0';

  /** Unique certificate identifier (format: "cert-{8 random chars}") */
  certificate_id: string;

  /** ISO 8601 timestamp of certificate issuance */
  issued_at: string;

  /** The checkpoint this certificate attests to */
  subject: {
    checkpoint_id: string;
    agent_id: string;
    session_id: string;
    card_id: string;
  };

  /** Analysis claims covered by the certificate */
  claims: {
    verdict: string;
    concerns: Array<{ category: string; severity: string; description: string }>;
    confidence: number;
    reasoning_summary: string;
    analysis_model: string;
    analysis_duration_ms: number;
  };

  /** Deterministic hashes of all analysis inputs */
  input_commitments: {
    thinking_block_hash: string;
    card_hash: string;
    values_hash: string;
    context_hash: string;
    model_version: string;
    combined_commitment: string;
  };

  /** Cryptographic proofs */
  proofs: {
    /** Ed25519 digital signature over the canonical signed payload */
    signature: {
      algorithm: 'Ed25519';
      key_id: string;
      value: string;
      signed_payload: string;
    };
    /** Hash chain link connecting this checkpoint to its predecessor */
    chain: {
      chain_hash: string;
      prev_chain_hash: string | null;
      position: number;
    };
    /** Merkle inclusion proof (null when tree has not been built yet) */
    merkle: {
      leaf_hash: string;
      leaf_index: number;
      root: string;
      tree_size: number;
      inclusion_proof: Array<{ hash: string; position: 'left' | 'right' }>;
    } | null;
    /** Verdict derivation proof (Phase 3 — not yet implemented) */
    verdict_derivation: null;
  };

  /** URLs for online verification */
  verification: {
    keys_url: string;
    certificate_url: string;
    verify_url: string;
  };
}

// ---------------------------------------------------------------------------
// Merkle Proof
// ---------------------------------------------------------------------------

/**
 * A Merkle inclusion proof demonstrating that a leaf exists in a Merkle tree.
 *
 * Contains the O(log N) sibling hashes needed to recompute the root
 * from a given leaf hash.
 */
export interface MerkleProof {
  /** SHA-256 hash of the leaf data */
  leafHash: string;

  /** Zero-based index of the leaf in the tree */
  leafIndex: number;

  /** Sibling hashes from leaf to root, with their relative position */
  siblings: Array<{ hash: string; position: 'left' | 'right' }>;

  /** Expected Merkle root */
  root: string;

  /** Number of leaves in the tree when the proof was generated */
  treeSize: number;
}

// ---------------------------------------------------------------------------
// Chain Hash
// ---------------------------------------------------------------------------

/**
 * A hash chain link connecting a checkpoint to its predecessor.
 *
 * The chain hash is a SHA-256 digest of the concatenated fields:
 *   (genesis|prevChainHash) | checkpointId | verdict | thinkingBlockHash | inputCommitment | timestamp
 */
export interface ChainHash {
  /** SHA-256 chain hash for this checkpoint */
  chainHash: string;

  /** Chain hash of the previous checkpoint (null for the first in a session) */
  prevChainHash: string | null;

  /** Zero-based position in the chain */
  position: number;
}

// ---------------------------------------------------------------------------
// Certificate Verification Result
// ---------------------------------------------------------------------------

/**
 * Result of verifying an integrity certificate offline.
 *
 * Contains the overall validity and per-check details for signature,
 * chain hash, and Merkle inclusion proof verification.
 */
export interface CertificateVerificationResult {
  /** Whether all checks passed */
  valid: boolean;

  /** Individual check results */
  checks: {
    /** Ed25519 signature verification */
    signature: { valid: boolean; details: string };

    /** Chain hash recomputation check */
    chain: { valid: boolean; details: string };

    /** Merkle inclusion proof check (null if no Merkle proof in certificate) */
    merkle: { valid: boolean; details: string } | null;
  };
}
