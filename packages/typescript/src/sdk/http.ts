/**
 * HMAC-SHA256 signing and verification for AIP webhook delivery.
 *
 * Uses Node.js crypto (available in Node 18+ and Cloudflare Workers).
 */

import { createHmac } from "node:crypto";

/** Sign a payload with HMAC-SHA256. Returns `sha256={hex}`. */
export function signPayload(secret: string, payload: string): string {
  const hmac = createHmac("sha256", secret);
  hmac.update(payload);
  return `sha256=${hmac.digest("hex")}`;
}

/**
 * Verify an HMAC-SHA256 signature using constant-time comparison.
 * SPEC requires constant-time comparison to prevent timing attacks.
 */
export function verifySignature(
  secret: string,
  payload: string,
  signature: string
): boolean {
  const expected = signPayload(secret, payload);
  return constantTimeEqual(expected, signature);
}

function constantTimeEqual(a: string, b: string): boolean {
  const maxLen = Math.max(a.length, b.length);
  const aPadded = a.padEnd(maxLen, '\0');
  const bPadded = b.padEnd(maxLen, '\0');
  let result = 0;
  for (let i = 0; i < maxLen; i++) {
    result |= aPadded.charCodeAt(i) ^ bPadded.charCodeAt(i);
  }
  // Also check lengths match (after constant-time comparison)
  result |= a.length ^ b.length;
  return result === 0;
}
