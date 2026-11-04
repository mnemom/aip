import { describe, it, expect } from "vitest";
import { signAsync, getPublicKeyAsync } from "@noble/ed25519";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import { verifyCertificate } from "../src/index.js";
import { computeChainHash } from "../src/crypto.js";
import { canonicalJson } from "../src/canonical.js";
import type { IntegrityCertificate } from "../src/index.js";

// Fixed test-only seed; not a real key.
const SEED = new Uint8Array(32).fill(7);

function toBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

async function buildCertificate(): Promise<{
  cert: IntegrityCertificate;
  publicKeyHex: string;
}> {
  const publicKey = await getPublicKeyAsync(SEED);
  const issuedAt = "2026-01-01T00:00:00.000Z";
  const commitments = {
    thinking_block_hash: "a".repeat(64),
    card_hash: "b".repeat(64),
    values_hash: "c".repeat(64),
    context_hash: "d".repeat(64),
    model_version: "test-model",
    combined_commitment: "e".repeat(64),
  };
  const chainHash = computeChainHash(
    null,
    "ic-test-1",
    "clear",
    commitments.thinking_block_hash,
    commitments.combined_commitment,
    issuedAt,
  );
  // Same shape as the issuer's buildSignedPayload (mnemom-api): 7 fields, sorted keys.
  const signedPayload = JSON.stringify({
    agent_id: "agent-test",
    chain_hash: chainHash,
    checkpoint_id: "ic-test-1",
    input_commitment: commitments.combined_commitment,
    thinking_block_hash: commitments.thinking_block_hash,
    timestamp: issuedAt,
    verdict: "clear",
  });
  const sig = await signAsync(utf8ToBytes(signedPayload), SEED);

  const cert: IntegrityCertificate = {
    "@context": "https://mnemom.ai/aip/v1",
    type: "IntegrityCertificate",
    version: "1.0.0",
    certificate_id: "cert-test-1",
    issued_at: issuedAt,
    subject: {
      checkpoint_id: "ic-test-1",
      agent_id: "agent-test",
      session_id: "session-test",
      card_id: "card-test",
    },
    claims: {
      verdict: "clear",
      concerns: [],
      confidence: 0.99,
      reasoning_summary: "test",
      analysis_model: "test-model",
      analysis_duration_ms: 1,
    },
    input_commitments: commitments,
    proofs: {
      signature: {
        algorithm: "Ed25519",
        key_id: "test-key",
        value: toBase64(sig),
        signed_payload: signedPayload,
      },
      chain: { chain_hash: chainHash, prev_chain_hash: null, position: 0 },
      merkle: null,
      verdict_derivation: null,
    },
    verification: {
      keys_url: "https://example.invalid/keys",
      certificate_url: "https://example.invalid/cert",
      verify_url: "https://example.invalid/verify",
    },
  };
  return { cert, publicKeyHex: bytesToHex(publicKey) };
}

describe("verifyCertificate", () => {
  it("accepts a valid certificate", async () => {
    const { cert, publicKeyHex } = await buildCertificate();
    const result = await verifyCertificate(cert, { publicKey: publicKeyHex });
    expect(result.valid).toBe(true);
    expect(result.checks.signature.valid).toBe(true);
    expect(result.checks.chain.valid).toBe(true);
    expect(result.checks.merkle).toBeNull();
    expect(result.certificate_id).toBe("cert-test-1");
  });

  it("rejects a certificate whose signed payload was tampered with", async () => {
    const { cert, publicKeyHex } = await buildCertificate();
    cert.proofs.signature.signed_payload =
      cert.proofs.signature.signed_payload.replace("clear", "boundary_violation");
    const result = await verifyCertificate(cert, { publicKey: publicKeyHex });
    expect(result.valid).toBe(false);
    expect(result.checks.signature.valid).toBe(false);
  });

  it("rejects a certificate whose claimed verdict was tampered with", async () => {
    const { cert, publicKeyHex } = await buildCertificate();
    cert.claims.verdict = "boundary_violation";
    const result = await verifyCertificate(cert, { publicKey: publicKeyHex });
    expect(result.valid).toBe(false);
    expect(result.checks.chain.valid).toBe(false);
  });

  it("rejects a tampered subject field even though the embedded payload still verifies (MNE-9159)", async () => {
    const { cert, publicKeyHex } = await buildCertificate();
    cert.subject.agent_id = "agent-attacker";
    const result = await verifyCertificate(cert, { publicKey: publicKeyHex });
    expect(result.valid).toBe(false);
    expect(result.checks.signature.valid).toBe(false);
    expect(result.checks.signature.details).toContain("payload binding");
  });

  it("fails closed, without throwing, when the chain proof is missing (MNE-9159)", async () => {
    const { cert, publicKeyHex } = await buildCertificate();
    delete (cert.proofs as { chain?: unknown }).chain;
    const result = await verifyCertificate(cert, { publicKey: publicKeyHex });
    expect(result.valid).toBe(false);
    expect(result.checks.signature.valid).toBe(false);
    expect(result.checks.chain.valid).toBe(false);
  });

  it("rejects a tampered commitment field (MNE-9159)", async () => {
    const { cert, publicKeyHex } = await buildCertificate();
    cert.input_commitments.thinking_block_hash = "f".repeat(64);
    const result = await verifyCertificate(cert, { publicKey: publicKeyHex });
    expect(result.checks.signature.valid).toBe(false);
  });

  it("rejects a share card signed by the same key presented as a certificate (MNE-9159)", async () => {
    const { cert, publicKeyHex } = await buildCertificate();
    // A genuinely signed AAP-ShareCard/v1 body (canonical JSON, same key).
    const card = canonicalJson({
      typ: "AAP-ShareCard/v1",
      card_id: "card-1",
      issued_at: "2026-01-01T00:00:00.000Z",
      lines: [],
      statements: [],
    });
    const sig = await signAsync(utf8ToBytes(card), SEED);
    cert.proofs.signature.value = toBase64(sig);
    cert.proofs.signature.signed_payload = card;
    const result = await verifyCertificate(cert, { publicKey: publicKeyHex });
    expect(result.valid).toBe(false);
    expect(result.checks.signature.valid).toBe(false);
  });

  it("rejects an arbitrary string signed by the same key as signed_payload (MNE-9159)", async () => {
    const { cert, publicKeyHex } = await buildCertificate();
    const msg = "anything the attestation key ever signed";
    cert.proofs.signature.value = toBase64(await signAsync(utf8ToBytes(msg), SEED));
    cert.proofs.signature.signed_payload = msg;
    const result = await verifyCertificate(cert, { publicKey: publicKeyHex });
    expect(result.checks.signature.valid).toBe(false);
  });

  it.each(["null", "42", "true", '"x"', "[]", '[{"timestamp":"t"}]'])(
    "rejects a validly signed non-object JSON payload %s (MNE-9159)",
    async (msg) => {
      const { cert, publicKeyHex } = await buildCertificate();
      cert.proofs.signature.value = toBase64(await signAsync(utf8ToBytes(msg), SEED));
      cert.proofs.signature.signed_payload = msg;
      const result = await verifyCertificate(cert, { publicKey: publicKeyHex });
      expect(result.valid).toBe(false);
      expect(result.checks.signature.valid).toBe(false);
      expect(result.checks.signature.details).toContain("payload binding");
    },
  );

  it("rejects a payload with an extra field even if validly signed (MNE-9159)", async () => {
    const { cert, publicKeyHex } = await buildCertificate();
    const obj = JSON.parse(cert.proofs.signature.signed_payload) as Record<string, string>;
    const msg = JSON.stringify({ ...obj, typ: "AAP-ShareCard/v1" }, Object.keys({ ...obj, typ: 1 }).sort());
    cert.proofs.signature.value = toBase64(await signAsync(utf8ToBytes(msg), SEED));
    cert.proofs.signature.signed_payload = msg;
    const result = await verifyCertificate(cert, { publicKey: publicKeyHex });
    expect(result.checks.signature.valid).toBe(false);
  });
});
