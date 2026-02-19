/**
 * Cryptographic helpers for AIP certificate verification.
 *
 * Uses @noble/ed25519 for signatures and @noble/hashes for SHA-256.
 * All operations are offline — no network calls.
 */

import { verifyAsync } from "@noble/ed25519";
import { sha256 } from "@noble/hashes/sha256";
import {
  bytesToHex,
  hexToBytes,
  utf8ToBytes,
} from "@noble/hashes/utils";

import type { MerkleSibling } from "./types.js";

// ---------------------------------------------------------------------------
// Encoding helpers
// ---------------------------------------------------------------------------

/** Decode a standard base-64 string to Uint8Array. */
export function base64ToUint8(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/** Decode a hex string to Uint8Array. */
export function hexToUint8(hex: string): Uint8Array {
  return hexToBytes(hex);
}

// ---------------------------------------------------------------------------
// SHA-256
// ---------------------------------------------------------------------------

/** SHA-256 hash of a UTF-8 string, returned as lowercase hex. */
export function sha256Hex(input: string): string {
  return bytesToHex(sha256(utf8ToBytes(input)));
}

// ---------------------------------------------------------------------------
// Ed25519 signature verification
// ---------------------------------------------------------------------------

/**
 * Verify an Ed25519 signature.
 *
 * @param signature - Base-64 encoded signature.
 * @param payload   - The signed payload string (UTF-8).
 * @param publicKey - Ed25519 public key as Uint8Array.
 * @returns `true` if valid, `false` otherwise.
 */
export async function verifySignature(
  signature: string,
  payload: string,
  publicKey: Uint8Array,
): Promise<boolean> {
  try {
    const sigBytes = base64ToUint8(signature);
    const msgBytes = utf8ToBytes(payload);
    return await verifyAsync(sigBytes, msgBytes, publicKey);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Merkle proof verification
// ---------------------------------------------------------------------------

/**
 * Verify a Merkle inclusion proof by walking from leaf to root.
 *
 * Each sibling specifies whether it sits on the `"left"` or `"right"` side.
 * The combined hash at each level is `SHA-256(left || right)` in hex.
 */
export function verifyMerkleProof(
  leafHash: string,
  siblings: MerkleSibling[],
  expectedRoot: string,
): boolean {
  let current = leafHash;

  for (const sibling of siblings) {
    const pair =
      sibling.position === "left"
        ? sibling.hash + current
        : current + sibling.hash;
    current = sha256Hex(pair);
  }

  return current === expectedRoot;
}

// ---------------------------------------------------------------------------
// Chain hash computation
// ---------------------------------------------------------------------------

/**
 * Recompute a chain hash from its constituent parts.
 *
 * Format: `SHA-256(prevChainHash|checkpointId|verdict|thinkingBlockHash|inputCommitment|timestamp)`
 *
 * When `prevChainHash` is `null` the literal string `"genesis"` is used.
 */
export function computeChainHash(
  prevChainHash: string | null,
  checkpointId: string,
  verdict: string,
  thinkingBlockHash: string,
  inputCommitment: string,
  timestamp: string,
): string {
  const prev = prevChainHash ?? "genesis";
  const preimage = [
    prev,
    checkpointId,
    verdict,
    thinkingBlockHash,
    inputCommitment,
    timestamp,
  ].join("|");

  return sha256Hex(preimage);
}
