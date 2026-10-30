import { describe, it, expect } from "vitest";
import * as ed from "@noble/ed25519";

import { verifyCertificate } from "../src/verification/verify.js";
import type { IntegrityCertificate } from "../src/schemas/certificate.js";

// Fixed test-only seed; not a real key.
const SEED = new Uint8Array(32).fill(7);
const enc = new TextEncoder();
const b64 = (bytes: Uint8Array): string => btoa(String.fromCharCode(...bytes));

async function sign(msg: string): Promise<string> {
  return b64(await ed.signAsync(enc.encode(msg), SEED));
}

// Same shape as the issuer's buildSignedPayload (mnemom-api): 7 fields, sorted keys.
async function build(): Promise<{ cert: IntegrityCertificate; publicKey: Uint8Array }> {
  const publicKey = await ed.getPublicKeyAsync(SEED);
  const issuedAt = "2026-01-01T00:00:00.000Z";
  const thinking = "a".repeat(64);
  const combined = "e".repeat(64);
  // verifyChain preimage: genesis|checkpoint|verdict|thinking|combined|issued_at
  const { sha256 } = await import("@noble/hashes/sha2.js");
  const { bytesToHex } = await import("@noble/hashes/utils.js");
  const chainHash = bytesToHex(
    sha256(enc.encode(`genesis|ic-test-1|clear|${thinking}|${combined}|${issuedAt}`)),
  );
  const payload = JSON.stringify({
    agent_id: "agent-test",
    chain_hash: chainHash,
    checkpoint_id: "ic-test-1",
    input_commitment: combined,
    thinking_block_hash: thinking,
    timestamp: issuedAt,
    verdict: "clear",
  });
  const cert: IntegrityCertificate = {
    "@context": "https://mnemom.ai/aip/v1",
    type: "IntegrityCertificate",
    version: "1.0.0",
    certificate_id: "cert-test-1",
    issued_at: issuedAt,
    subject: { checkpoint_id: "ic-test-1", agent_id: "agent-test", session_id: "s", card_id: "c" },
    claims: {
      verdict: "clear",
      concerns: [],
      confidence: 0.99,
      reasoning_summary: "t",
      analysis_model: "m",
      analysis_duration_ms: 1,
    },
    input_commitments: {
      thinking_block_hash: thinking,
      card_hash: "b".repeat(64),
      values_hash: "c".repeat(64),
      context_hash: "d".repeat(64),
      model_version: "m",
      combined_commitment: combined,
    },
    proofs: {
      signature: { algorithm: "Ed25519", key_id: "k", value: await sign(payload), signed_payload: payload },
      chain: { chain_hash: chainHash, prev_chain_hash: null, position: 0 },
      merkle: null,
      verdict_derivation: null,
    },
    verification: { keys_url: "x", certificate_url: "x", verify_url: "x" },
  };
  return { cert, publicKey };
}

describe("verifyCertificate payload binding (MNE-9159)", () => {
  it("accepts a valid certificate", async () => {
    const { cert, publicKey } = await build();
    const r = await verifyCertificate(cert, publicKey);
    expect(r.checks.signature.valid).toBe(true);
    expect(r.valid).toBe(true);
  });

  it("rejects a tampered subject field", async () => {
    const { cert, publicKey } = await build();
    cert.subject.agent_id = "agent-attacker";
    const r = await verifyCertificate(cert, publicKey);
    expect(r.checks.signature.valid).toBe(false);
    expect(r.checks.signature.details).toContain("payload binding");
  });

  it("rejects a tampered commitment field", async () => {
    const { cert, publicKey } = await build();
    cert.input_commitments.thinking_block_hash = "f".repeat(64);
    const r = await verifyCertificate(cert, publicKey);
    expect(r.checks.signature.valid).toBe(false);
  });

  it("rejects a share card signed by the same key presented as a certificate", async () => {
    const { cert, publicKey } = await build();
    const card = JSON.stringify({ card_id: "c1", lines: [], statements: [], typ: "AAP-ShareCard/v1" });
    cert.proofs.signature.value = await sign(card);
    cert.proofs.signature.signed_payload = card;
    const r = await verifyCertificate(cert, publicKey);
    expect(r.valid).toBe(false);
    expect(r.checks.signature.valid).toBe(false);
  });

  it("rejects an arbitrary string signed by the same key", async () => {
    const { cert, publicKey } = await build();
    const msg = "anything the attestation key ever signed";
    cert.proofs.signature.value = await sign(msg);
    cert.proofs.signature.signed_payload = msg;
    const r = await verifyCertificate(cert, publicKey);
    expect(r.checks.signature.valid).toBe(false);
  });

  it.each(["null", "42", "true", '"x"', "[]", '[{"timestamp":"t"}]'])(
    "rejects a validly signed non-object JSON payload %s",
    async (msg) => {
      const { cert, publicKey } = await build();
      cert.proofs.signature.value = await sign(msg);
      cert.proofs.signature.signed_payload = msg;
      const r = await verifyCertificate(cert, publicKey);
      expect(r.checks.signature.valid).toBe(false);
      expect(r.checks.signature.details).toContain("payload binding");
    },
  );

  it("rejects a payload with an extra field even if validly signed", async () => {
    const { cert, publicKey } = await build();
    const obj = JSON.parse(cert.proofs.signature.signed_payload) as Record<string, string>;
    const msg = JSON.stringify({ ...obj, typ: "AAP-ShareCard/v1" });
    cert.proofs.signature.value = await sign(msg);
    cert.proofs.signature.signed_payload = msg;
    const r = await verifyCertificate(cert, publicKey);
    expect(r.checks.signature.valid).toBe(false);
  });
});
