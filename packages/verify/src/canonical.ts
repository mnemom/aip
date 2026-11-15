/**
 * Canonical JSON, byte-identical to mnemom-api `src/attestation/crypto.ts`
 * (`canonicalJson`): object keys sorted recursively, no whitespace, arrays
 * kept in order, primitives through `JSON.stringify`.
 *
 * Every signed record statement commits to this serialisation of the
 * statement minus its `signature` field, exactly the way
 * `AAP-TransparencyRoot/v1` does (mnemom-api `src/transparency/root_publisher.ts`).
 */

import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  const entries = Object.keys(record)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonicalJson(record[k])}`);
  return `{${entries.join(",")}}`;
}

/** Decode base64url (padding optional) to bytes. Throws on malformed input. */
export function base64urlToUint8(input: string): Uint8Array {
  if (typeof input !== "string" || !/^[A-Za-z0-9_-]*={0,2}$/.test(input)) {
    throw new Error("not base64url");
  }
  const b64 = input.replace(/-/g, "+").replace(/_/g, "/").replace(/=+$/, "");
  const padded = b64 + "===".slice(0, (4 - (b64.length % 4)) % 4);
  const binary = atob(padded);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

/**
 * The bytes a statement's signature covers: canonical JSON of the statement
 * with `signature` removed. Exported (through verify-record.ts) so a signer
 * in another language can be checked against it byte for byte.
 */
export function statementCommitment(statement: Record<string, unknown>): string {
  const { signature: _signature, ...rest } = statement;
  return canonicalJson(rest);
}

/** Lowercase sha256 hex of a statement's commitment: how statements link (T2). */
export function statementDigest(statement: Record<string, unknown>): string {
  return bytesToHex(sha256(utf8ToBytes(statementCommitment(statement))));
}
