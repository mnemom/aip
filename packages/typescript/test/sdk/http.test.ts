import { describe, it, expect } from "vitest";
import { signPayload, verifySignature } from "../../src/sdk/http.js";

describe("signPayload", () => {
  it("returns a string starting with 'sha256='", () => {
    const result = signPayload("test-secret", "test-payload");

    expect(result).toMatch(/^sha256=[0-9a-f]+$/);
  });

  it("produces consistent signatures for the same input", () => {
    const sig1 = signPayload("my-secret", "my-payload");
    const sig2 = signPayload("my-secret", "my-payload");

    expect(sig1).toBe(sig2);
  });

  it("produces different signatures for different payloads", () => {
    const sig1 = signPayload("same-secret", "payload-one");
    const sig2 = signPayload("same-secret", "payload-two");

    expect(sig1).not.toBe(sig2);
  });

  it("produces different signatures for different secrets", () => {
    const sig1 = signPayload("secret-one", "same-payload");
    const sig2 = signPayload("secret-two", "same-payload");

    expect(sig1).not.toBe(sig2);
  });
});

describe("verifySignature", () => {
  it("returns true for a valid signature (round-trip)", () => {
    const secret = "webhook-secret";
    const payload = JSON.stringify({ event: "integrity_check", status: "clear" });
    const signature = signPayload(secret, payload);

    const result = verifySignature(secret, payload, signature);

    expect(result).toBe(true);
  });

  it("returns false for a tampered payload", () => {
    const secret = "webhook-secret";
    const payload = "original-payload";
    const signature = signPayload(secret, payload);

    const result = verifySignature(secret, "tampered-payload", signature);

    expect(result).toBe(false);
  });

  it("returns false for a wrong secret", () => {
    const payload = "some-payload";
    const signature = signPayload("correct-secret", payload);

    const result = verifySignature("wrong-secret", payload, signature);

    expect(result).toBe(false);
  });

  it("returns false for a malformed signature string", () => {
    const secret = "webhook-secret";
    const payload = "some-payload";

    const result = verifySignature(secret, payload, "not-a-real-signature");

    expect(result).toBe(false);
  });
});
