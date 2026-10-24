import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { canonicalJson } from "../src/canonical.js";
import { FLAGS, REASONS, type RecordJwks } from "../src/statements.js";
import { statementDigest, verify, verifyStatement } from "../src/verify-record.js";
import { TEST_KID, signStatement, testJwk } from "./helpers/sign.js";
import type { TamperedCase } from "./helpers/build-fixtures.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = <T = unknown>(name: string): T =>
  JSON.parse(readFileSync(resolve(here, "fixtures/record", `${name}.json`), "utf8")) as T;

const jwks = fixture<RecordJwks>("jwks");

describe("canonicalJson", () => {
  // The vectors below were produced by mnemom-api src/attestation/crypto.ts
  // canonicalJson, which signs the transparency root (T3). Any drift here
  // means a statement signed by the builder will not verify.
  it("sorts keys recursively and emits no whitespace", () => {
    expect(canonicalJson({ b: 1, a: { d: [3, { z: 1, y: 2 }], c: "x" } })).toBe(
      '{"a":{"c":"x","d":[3,{"y":2,"z":1}]},"b":1}',
    );
    expect(canonicalJson([null, true, 1.5, "s"])).toBe('[null,true,1.5,"s"]');
    expect(canonicalJson("é\n")).toBe(JSON.stringify("é\n"));
  });
});

describe("verify: golden fixtures", () => {
  it("verifies the golden bundle and surfaces the T12 flags", async () => {
    const res = await verify(fixture("golden-bundle"), jwks);
    expect(res.reasons).toEqual([]);
    expect(res.valid).toBe(true);
    expect(res.statements.map((s) => s.typ)).toEqual([
      "AAP-ConductRecord/v1",
      "AAP-ConductRecord/v1",
      "AAP-PRRecord/v1",
      "AAP-Outcome/v1",
      "AAP-ShareCard/v1",
    ]);
    expect(res.flags).toEqual(fixture<{ bundle: { flags: unknown } }>("golden-verdicts").bundle.flags);
  });

  it("verifies each golden statement on its own and agrees on digests", async () => {
    const verdicts = fixture<{ digests: Record<string, string> }>("golden-verdicts");
    for (const [name, key] of [
      ["golden-conduct", "conduct2"],
      ["golden-pr-record", "pr"],
      ["golden-outcome", "outcome"],
      ["golden-share-card", "card"],
    ] as const) {
      const s = fixture<Record<string, unknown>>(name);
      const res = await verify(s, jwks);
      expect(res.valid, name).toBe(true);
      expect(res.statements[0].digest).toBe(verdicts.digests[key]);
      expect(statementDigest(s)).toBe(verdicts.digests[key]);
    }
  });

  it("links statements by digest: the PR record names the last conduct build", () => {
    const bundle = fixture<{ statements: Record<string, unknown>[] }>("golden-bundle");
    const [c1, c2, pr, outcome, card] = bundle.statements;
    expect(c2.previous_digest).toBe(statementDigest(c1));
    expect(pr.conduct_digests).toEqual([statementDigest(c2)]);
    expect(outcome.pr_record_digest).toBe(statementDigest(pr));
    expect(card.source_digest).toBe(statementDigest(pr));
  });
});

describe("verify: tampered fixtures fail closed with the named reason", () => {
  const cases = fixture<TamperedCase[]>("tampered");
  it.each(cases.map((c) => [c.name, c] as const))("%s", async (_name, c) => {
    const res = await verify(c.input, jwks);
    expect(res.valid).toBe(false);
    expect(res.reasons).toContain(c.reason);
  });
});

describe("verifyStatement: order of checks", () => {
  it("refuses a non-EdDSA alg before looking at any key", async () => {
    const s = { ...fixture<Record<string, unknown>>("golden-conduct"), alg: "none" };
    const res = await verifyStatement(s, { keys: [] });
    expect(res.reasons).toEqual([REASONS.unsupported_alg]);
  });

  it("refuses a key that is not declared EdDSA / Ed25519 OKP", async () => {
    const s = fixture<Record<string, unknown>>("golden-conduct");
    const jwk = await testJwk();
    for (const bad of [
      { ...jwk, alg: "RS256" },
      { ...jwk, crv: "P-256" },
      { ...jwk, kty: "EC" },
      { ...jwk, x: "AAAA" },
    ]) {
      const res = await verifyStatement(s, { keys: [bad] });
      expect(res.valid).toBe(false);
      expect(res.reasons).toEqual([REASONS.key_not_ed25519]);
    }
  });

  it("rejects an unknown kid even when another key would verify", async () => {
    const s = fixture<Record<string, unknown>>("golden-conduct");
    const res = await verifyStatement(s, { keys: [{ ...(await testJwk()), kid: "other" }] });
    expect(res.reasons).toEqual([REASONS.key_not_found]);
  });

  it("never throws on garbage input", async () => {
    for (const bad of [null, 1, "x", [], { typ: "AAP-ConductRecord/v1" }]) {
      const res = await verify(bad, jwks);
      expect(res.valid).toBe(false);
    }
    const res = await verify({ typ: "AAP-RecordBundle/v1" }, jwks);
    expect(res.reasons).toEqual([REASONS.bundle_statements_missing]);
  });

  it("flags a link to a statement outside the bundle without failing", async () => {
    const pr = fixture<Record<string, unknown>>("golden-pr-record");
    const res = await verify({ typ: "AAP-RecordBundle/v1", statements: [pr] }, jwks);
    expect(res.valid).toBe(true);
    expect(res.flags).toEqual([
      { flag: FLAGS.linked_statement_not_in_bundle, subject: (pr.conduct_digests as string[])[0] },
    ]);
  });

  it("fails a malformed digest reference", async () => {
    const s = await signStatement({
      typ: "AAP-Outcome/v1",
      signing_key_id: TEST_KID,
      pr_record_digest: "not-a-digest",
    });
    const res = await verifyStatement(s, jwks);
    expect(res.reasons).toEqual([REASONS.digest_malformed]);
  });

  it("a checkpoint with card hash and signed commitment carries no flag", async () => {
    const s = fixture<{ checkpoints: unknown[] }>("golden-conduct");
    expect(s.checkpoints).toHaveLength(1);
    const res = await verifyStatement(s, jwks);
    expect(res.flags).toEqual([]);
  });
});
