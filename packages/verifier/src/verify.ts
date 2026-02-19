/**
 * Main certificate verification logic.
 *
 * Given a trusted public key (and optionally a Merkle root), verifies
 * an AIP Integrity Certificate entirely offline.
 */

import {
  verifySignature,
  computeChainHash,
  verifyMerkleProof,
  hexToUint8,
} from "./crypto.js";

import type {
  IntegrityCertificate,
  VerificationResult,
  VerifierOptions,
  CheckResult,
} from "./types.js";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Verify an AIP Integrity Certificate offline.
 *
 * Performs four checks:
 *
 * 1. **Signature** — Ed25519 verification of the signed payload.
 * 2. **Chain** — Recomputes chain hash and compares with the certificate.
 * 3. **Merkle** — If the certificate carries a Merkle proof *and*
 *    `options.merkleRoot` is supplied, verifies the inclusion proof.
 *    Otherwise the check is skipped (returns `null`).
 * 4. **Verdict derivation** — If the certificate carries a verdict derivation
 *    proof, verifies structural integrity (journal fields match certificate
 *    claims). STARK receipt verification is deferred to server-side.
 *
 * @param certificate - The integrity certificate to verify.
 * @param options     - Public key and optional Merkle root.
 * @returns Verification result with per-check details.
 */
export async function verifyCertificate(
  certificate: IntegrityCertificate,
  options: VerifierOptions,
): Promise<VerificationResult> {
  const publicKey = resolvePublicKey(options.publicKey);

  const signature = await checkSignature(certificate, publicKey);
  const chain = checkChain(certificate);
  const merkle = checkMerkle(certificate, options.merkleRoot);
  const verdictDerivation = checkVerdictDerivation(
    certificate,
    options.verdictDerivationImageId,
  );

  const allValid =
    signature.valid &&
    chain.valid &&
    (merkle === null || merkle.valid) &&
    (verdictDerivation === null || verdictDerivation.valid);

  return {
    valid: allValid,
    checks: { signature, chain, merkle, verdict_derivation: verdictDerivation },
    certificate_id: certificate.certificate_id,
    verified_at: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Normalize public key to Uint8Array. */
function resolvePublicKey(key: string | Uint8Array): Uint8Array {
  if (typeof key === "string") {
    return hexToUint8(key);
  }
  return key;
}

/** Verify the Ed25519 signature over the signed payload. */
async function checkSignature(
  cert: IntegrityCertificate,
  publicKey: Uint8Array,
): Promise<CheckResult> {
  const { value, signed_payload } = cert.proofs.signature;

  const valid = await verifySignature(value, signed_payload, publicKey);

  return {
    valid,
    details: valid
      ? "Ed25519 signature is valid"
      : "Ed25519 signature verification failed",
  };
}

/** Recompute chain hash and compare. */
function checkChain(cert: IntegrityCertificate): CheckResult {
  const expected = computeChainHash(
    cert.proofs.chain.prev_chain_hash,
    cert.subject.checkpoint_id,
    cert.claims.verdict,
    cert.input_commitments.thinking_block_hash,
    cert.input_commitments.combined_commitment,
    cert.issued_at,
  );

  const valid = expected === cert.proofs.chain.chain_hash;

  return {
    valid,
    details: valid
      ? "Chain hash matches recomputed value"
      : `Chain hash mismatch: expected ${expected}, got ${cert.proofs.chain.chain_hash}`,
  };
}

/** Verify Merkle inclusion proof, if present and root is provided. */
function checkMerkle(
  cert: IntegrityCertificate,
  merkleRoot: string | undefined,
): CheckResult | null {
  if (cert.proofs.merkle === null) {
    return null;
  }

  if (merkleRoot === undefined) {
    return null;
  }

  const { leaf_hash, inclusion_proof, root } = cert.proofs.merkle;

  // Verify that the certificate's stated root matches the expected root.
  if (root !== merkleRoot) {
    return {
      valid: false,
      details: `Merkle root mismatch: certificate claims ${root}, expected ${merkleRoot}`,
    };
  }

  const valid = verifyMerkleProof(leaf_hash, inclusion_proof, merkleRoot);

  return {
    valid,
    details: valid
      ? "Merkle inclusion proof is valid"
      : "Merkle inclusion proof verification failed",
  };
}

/**
 * Verify verdict derivation proof structural integrity.
 *
 * Checks that the journal fields in the proof match the certificate's claims
 * and input commitments. Does NOT verify the STARK receipt itself — that
 * requires the RISC Zero verifier (server-side or future WASM).
 *
 * If `expectedImageId` is provided, also verifies the proof was generated
 * by the expected guest program.
 */
function checkVerdictDerivation(
  cert: IntegrityCertificate,
  expectedImageId: string | undefined,
): CheckResult | null {
  const proof = cert.proofs.verdict_derivation;
  if (proof === null || proof === undefined) {
    return null;
  }

  // Validate proof method
  if (proof.method !== "RISC-Zero-STARK") {
    return {
      valid: false,
      details: `Unknown verdict derivation method: ${proof.method}`,
    };
  }

  // Validate required fields are present
  if (!proof.journal || !proof.image_id || !proof.receipt) {
    return {
      valid: false,
      details: "Verdict derivation proof is missing required fields (journal, image_id, or receipt)",
    };
  }

  // If an expected image ID is provided, verify it matches
  if (expectedImageId !== undefined && proof.image_id !== expectedImageId) {
    return {
      valid: false,
      details: `Image ID mismatch: proof has ${proof.image_id}, expected ${expectedImageId}`,
    };
  }

  // Parse the journal to verify structural integrity
  let journal: {
    verdict?: string;
    action?: string;
    concerns_hash?: string;
    thinking_hash?: string;
    card_hash?: string;
    values_hash?: string;
  };
  try {
    journal = JSON.parse(proof.journal);
  } catch {
    return {
      valid: false,
      details: "Failed to parse verdict derivation journal as JSON",
    };
  }

  // Verify journal verdict matches certificate claims
  if (journal.verdict !== undefined) {
    const certVerdict = cert.claims.verdict;
    if (journal.verdict !== certVerdict) {
      return {
        valid: false,
        details: `Journal verdict "${journal.verdict}" does not match certificate verdict "${certVerdict}"`,
      };
    }
  }

  // Verify journal thinking_hash matches input commitments
  if (journal.thinking_hash !== undefined) {
    const certThinkingHash = cert.input_commitments.thinking_block_hash;
    if (journal.thinking_hash !== certThinkingHash) {
      return {
        valid: false,
        details: `Journal thinking_hash does not match certificate input_commitments.thinking_block_hash`,
      };
    }
  }

  // Verify journal card_hash matches input commitments
  if (journal.card_hash !== undefined) {
    const certCardHash = cert.input_commitments.card_hash;
    if (journal.card_hash !== certCardHash) {
      return {
        valid: false,
        details: `Journal card_hash does not match certificate input_commitments.card_hash`,
      };
    }
  }

  // Verify journal values_hash matches input commitments
  if (journal.values_hash !== undefined) {
    const certValuesHash = cert.input_commitments.values_hash;
    if (journal.values_hash !== certValuesHash) {
      return {
        valid: false,
        details: `Journal values_hash does not match certificate input_commitments.values_hash`,
      };
    }
  }

  return {
    valid: true,
    details: "Verdict derivation proof is structurally valid (STARK receipt verification deferred to server)",
  };
}
