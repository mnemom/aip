/**
 * Canonical JSON, byte-identical to mnemom-api `src/attestation/crypto.ts`
 * (`canonicalJson`): object keys sorted recursively, no whitespace, arrays
 * kept in order, primitives through `JSON.stringify`.
 *
 * Every signed record statement commits to this serialisation of the
 * statement minus its `signature` field, exactly the way
 * `AAP-TransparencyRoot/v1` does (mnemom-api `src/transparency/root_publisher.ts`).
 */

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
