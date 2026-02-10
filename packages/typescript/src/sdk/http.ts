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
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}
