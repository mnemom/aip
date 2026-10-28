/**
 * Test-only signer for record statements. Mirrors the server construction
 * (mnemom-api `src/transparency/root_publisher.ts`): Ed25519 over
 * `canonicalJson(statement minus signature)`, base64url, no padding.
 *
 * The private key below is a fixed, public test vector. It signs nothing
 * outside this test suite and must never appear in a JWKS a product serves.
 */

import { getPublicKeyAsync, signAsync } from "@noble/ed25519";
import { bytesToHex, utf8ToBytes, hexToBytes } from "@noble/hashes/utils.js";

import { statementCommitment } from "../../src/verify-record.js";
import type { RecordJwk, RecordJwks } from "../../src/statements.js";

export const TEST_KID = "aap-test-record-2026-10";
export const TEST_PRIVATE_KEY_HEX =
  "9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60";

export function base64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function testJwk(kid = TEST_KID, privHex = TEST_PRIVATE_KEY_HEX): Promise<RecordJwk> {
  const pub = await getPublicKeyAsync(hexToBytes(privHex));
  return { kty: "OKP", crv: "Ed25519", x: base64url(pub), kid, alg: "EdDSA", use: "sig" };
}

export async function testJwks(): Promise<RecordJwks> {
  return { keys: [await testJwk()] };
}

/** Sign `statement` in place (returns a new object carrying `signature`). */
export async function signStatement<T extends Record<string, unknown>>(
  statement: T,
  privHex = TEST_PRIVATE_KEY_HEX,
): Promise<T & { signature: string }> {
  const { signature: _drop, ...unsigned } = statement as T & { signature?: string };
  const sig = await signAsync(utf8ToBytes(statementCommitment(unsigned)), hexToBytes(privHex));
  return { ...(unsigned as T), signature: base64url(sig) };
}

/**
 * Key-rotation vector: a second fixed, public test key standing in for a
 * retired signer (the current key is TEST_KID above). Same caveat: never
 * serve it from a JWKS.
 */
export const RETIRED_KID = "aap-test-record-2026-04";
export const RETIRED_PRIVATE_KEY_HEX = bytesToHex(crypto.getRandomValues(new Uint8Array(32))); // generated per run, never committed

export async function retiredJwk(): Promise<RecordJwk> {
  return testJwk(RETIRED_KID, RETIRED_PRIVATE_KEY_HEX);
}
