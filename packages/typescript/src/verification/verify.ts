/**
 * Offline certificate verification for the Agent Integrity Protocol.
 *
 * Provides `verifyCertificate()` — a pure function that checks:
 *   1. Ed25519 signature validity
 *   2. Hash chain link integrity
 *   3. Merkle inclusion proof (when present)
 *
 * Uses @noble/ed25519 and @noble/hashes, which work in Node.js,
 * Deno, Cloudflare Workers, and modern browsers.
 */

import * as ed from "@noble/ed25519";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

import type {
  IntegrityCertificate,
  CertificateVerificationResult,
} from "../schemas/certificate.js";

// ---------------------------------------------------------------------------
// Encoding helpers
// ---------------------------------------------------------------------------

/**
 * Decode a base64 string to a Uint8Array.
 * Uses `atob` (available in all modern runtimes including Workers).
 */
function base64ToUint8(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

// ---------------------------------------------------------------------------
// Internal hash helpers (mirror the backend implementations)
// ---------------------------------------------------------------------------

const encoder = new TextEncoder();

/**
 * SHA-256 hash of a UTF-8 string, returned as a lowercase hex string.
 */
function sha256Hex(input: string): string {
  const hash = sha256(encoder.encode(input));
  return bytesToHex(hash);
}

/**
 * Compute a Merkle internal node hash.
 * Preimage: left || right (hex strings concatenated directly).
 */
function computeNodeHash(left: string, right: string): string {
  return sha256Hex(left + right);
}

// ---------------------------------------------------------------------------
// Individual verification steps
// ---------------------------------------------------------------------------

/**
 * Verify the Ed25519 signature on a certificate.
 */
async function verifySignature(
  certificate: IntegrityCertificate,
  publicKey: Uint8Array,
): Promise<{ valid: boolean; details: string }> {
  try {
    const signatureBytes = base64ToUint8(certificate.proofs.signature.value);
    const messageBytes = encoder.encode(certificate.proofs.signature.signed_payload);
    const valid = await ed.verifyAsync(signatureBytes, messageBytes, publicKey);

    return {
      valid,
      details: valid
        ? "Ed25519 signature verified successfully"
        : "Ed25519 signature verification failed",
    };
  } catch (err) {
    return {
      valid: false,
      details: `Signature verification error: ${err instanceof Error ? err.message : "unknown"}`,
    };
  }
}

/**
 * Verify the hash chain link by recomputing the chain hash.
 *
 * Chain hash preimage:
 *   (genesis|prevChainHash) | checkpointId | verdict | thinkingBlockHash | inputCommitment | timestamp
 */
function verifyChain(
  certificate: IntegrityCertificate,
): { valid: boolean; details: string } {
  try {
    const chain = certificate.proofs.chain;
    if (!chain || !chain.chain_hash) {
      return { valid: false, details: "No chain proof data in certificate" };
    }

    const preimage =
      `${chain.prev_chain_hash || "genesis"}|` +
      `${certificate.subject.checkpoint_id}|` +
      `${certificate.claims.verdict}|` +
      `${certificate.input_commitments.thinking_block_hash}|` +
      `${certificate.input_commitments.combined_commitment}|` +
      `${certificate.issued_at}`;

    const recomputed = sha256Hex(preimage);
    const valid = recomputed === chain.chain_hash;

    return {
      valid,
      details: valid
        ? "Chain hash verified successfully"
        : "Recomputed chain hash does not match certificate",
    };
  } catch (err) {
    return {
      valid: false,
      details: `Chain verification error: ${err instanceof Error ? err.message : "unknown"}`,
    };
  }
}

/**
 * Verify a Merkle inclusion proof by walking siblings from leaf to root.
 *
 * If `expectedRoot` is provided it takes precedence over the root embedded
 * in the certificate, allowing callers to pin verification to an
 * independently-fetched tree root.
 */
function verifyMerkle(
  certificate: IntegrityCertificate,
  expectedRoot?: string,
): { valid: boolean; details: string } | null {
  const merkle = certificate.proofs.merkle;
  if (!merkle) {
    return null;
  }

  try {
    const root = expectedRoot ?? merkle.root;
    let current = merkle.leaf_hash;

    for (const sibling of merkle.inclusion_proof) {
      if (sibling.position === "left") {
        current = computeNodeHash(sibling.hash, current);
      } else {
        current = computeNodeHash(current, sibling.hash);
      }
    }

    const valid = current === root;

    return {
      valid,
      details: valid
        ? "Merkle inclusion proof verified successfully"
        : "Merkle inclusion proof verification failed — computed root does not match",
    };
  } catch (err) {
    return {
      valid: false,
      details: `Merkle verification error: ${err instanceof Error ? err.message : "unknown"}`,
    };
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Verify an integrity certificate offline.
 *
 * Performs three independent checks:
 *   1. **Signature** — verifies the Ed25519 signature against the provided
 *      public key and the canonical `signed_payload` embedded in the certificate.
 *   2. **Chain** — recomputes the SHA-256 chain hash from the certificate
 *      fields and compares it to the stored `chain_hash`.
 *   3. **Merkle** — if the certificate contains a Merkle inclusion proof,
 *      walks the sibling hashes from leaf to root and compares against the
 *      expected root. Pass `merkleRoot` to pin verification to an
 *      independently-fetched tree root; otherwise the root embedded in the
 *      certificate is used.
 *
 * @param certificate - The integrity certificate to verify
 * @param publicKey   - Ed25519 public key as a Uint8Array (32 bytes)
 * @param merkleRoot  - Optional externally-fetched Merkle root for pinned verification
 * @returns Verification result with per-check details
 */
export async function verifyCertificate(
  certificate: IntegrityCertificate,
  publicKey: Uint8Array,
  merkleRoot?: string,
): Promise<CertificateVerificationResult> {
  const signatureResult = await verifySignature(certificate, publicKey);
  const chainResult = verifyChain(certificate);
  const merkleResult = verifyMerkle(certificate, merkleRoot);

  const valid =
    signatureResult.valid &&
    chainResult.valid &&
    (merkleResult === null || merkleResult.valid);

  return {
    valid,
    checks: {
      signature: signatureResult,
      chain: chainResult,
      merkle: merkleResult,
    },
  };
}
