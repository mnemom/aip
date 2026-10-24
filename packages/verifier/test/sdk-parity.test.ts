/**
 * K4.5: the verifier agrees with `@mnemom/sdk` on every golden verdict.
 *
 * `@mnemom/sdk` (mnemom-platform `shared/sdk`, published 1.1.0) verifies AAP
 * attestations with WebCrypto against the platform JWKS; this package
 * verifies record statements with @noble/ed25519 against the same JWKS, and
 * must do so with no Mnemom call. The two implementations never see the same
 * bytes (a statement signature is Ed25519 over `canonicalJson(statement minus
 * signature)`, an attestation is a compact JWS), so parity is checked where
 * they do overlap:
 *
 *   1. Key material. The golden JWKS this package ships is accepted as-is by
 *      the SDK's `JwksClient`, and a token signed with the golden test key
 *      verifies there, so the public key the verifier trusts is the one the
 *      SDK trusts (same kid, same `x`, same Ed25519-only gate).
 *   2. Digests. For every golden statement the verifier computes the
 *      committed golden digest offline, and the SDK verifies an attestation
 *      carrying that digest under the golden key. The SDK never computes or
 *      checks `content_hash` itself, so digest equality is pinned against the
 *      committed golden verdicts, not against the SDK.
 *   3. Rejections. Every tampered golden case that lives on the signature
 *      path (wrong alg, unknown key, bad or malformed or missing signature)
 *      is rejected by both, with the verifier's reason being the committed
 *      golden reason. Cases the SDK has no concept of (card line classes,
 *      bundle links) are verifier-only and are pinned by verify-record.test.ts.
 *   4. Offline. The SDK fetches the JWKS once; the verifier fetches nothing.
 *
 * The SDK is a devDependency only: the published verifier stays offline.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { JwksClient, RequestLayer, type Jwk } from "@mnemom/sdk";
import { signAsync } from "@noble/ed25519";
import { hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";

import { REASONS, type RecordJwks } from "../src/statements.js";
import { statementDigest, verify } from "../src/verify-record.js";
import type { TamperedCase } from "./helpers/build-fixtures.js";
import { TEST_KID, TEST_PRIVATE_KEY_HEX, base64url } from "./helpers/sign.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = <T = unknown>(name: string): T =>
  JSON.parse(readFileSync(resolve(here, "fixtures/record", `${name}.json`), "utf8")) as T;

const jwks = fixture<RecordJwks>("jwks");
const verdicts = fixture<{ digests: Record<string, string> }>("golden-verdicts");
const tampered = fixture<TamperedCase[]>("tampered");

const GOLDEN: ReadonlyArray<readonly [name: string, digestKey: string]> = [
  ["golden-conduct", "conduct2"],
  ["golden-pr-record", "pr"],
  ["golden-outcome", "outcome"],
  ["golden-share-card", "card"],
];

const ISSUER = "https://mnemom.ai";
const ATTESTATION_TYP = "AAP-Attestation/v1";
const NOW_MS = Date.parse("2026-10-23T18:00:00.000Z");

/** The SDK's JWKS client, fed the golden JWKS by a fetch that counts itself. */
function sdkClient(keys: unknown = jwks): { client: JwksClient; fetches: () => number } {
  let count = 0;
  const fakeFetch: typeof fetch = async (input) => {
    count += 1;
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (!url.endsWith("/v1/.well-known/jwks.json")) {
      throw new Error(`parity test: unexpected request ${url}`);
    }
    return new Response(JSON.stringify(keys), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  const request = new RequestLayer({
    baseUrl: "https://api.mnemom.test",
    signer: { sign: async () => undefined },
    fetch: fakeFetch,
    maxRetries: 0,
  });
  const client = new JwksClient(request, { issuer: ISSUER, now: () => NOW_MS });
  return { client, fetches: () => count };
}

interface AttestOptions {
  alg?: string;
  kid?: string;
  /** Replace the signature segment outright. */
  signature?: string;
  /** Drop the signature segment, leaving a two-part token. */
  omitSignature?: boolean;
  privHex?: string;
}

/**
 * Attest `statement` the way the platform signer would: a compact JWS whose
 * `content_hash` is the statement digest, signed with the golden test key.
 */
async function attest(statement: Record<string, unknown>, opts: AttestOptions = {}): Promise<string> {
  const header = { alg: opts.alg ?? "EdDSA", kid: opts.kid ?? TEST_KID, typ: ATTESTATION_TYP };
  const nowSecs = Math.floor(NOW_MS / 1000);
  const payload = {
    typ: ATTESTATION_TYP,
    iss: ISSUER,
    sub: "aip-record",
    iat: nowSecs,
    exp: nowSecs + 3600,
    content_hash: statementDigest(statement),
    version: 1,
  };
  const h = base64url(utf8ToBytes(JSON.stringify(header)));
  const p = base64url(utf8ToBytes(JSON.stringify(payload)));
  if (opts.omitSignature) return `${h}.${p}`;
  const sig =
    opts.signature ??
    base64url(await signAsync(utf8ToBytes(`${h}.${p}`), hexToBytes(opts.privHex ?? TEST_PRIVATE_KEY_HEX)));
  return `${h}.${p}.${sig}`;
}

const realFetch = globalThis.fetch;
beforeEach(() => {
  // The verifier must never reach the network; any call here fails the test.
  globalThis.fetch = (async () => {
    throw new Error("parity test: the verifier made a network call");
  }) as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("K4.5 parity with @mnemom/sdk: key material", () => {
  it("the golden JWKS is a JWKS the SDK accepts without translation", () => {
    // vitest does not typecheck test files; the runtime shape check below is what holds.
    const keys: Jwk[] = jwks.keys;
    expect(keys).toHaveLength(1);
    expect(keys[0]).toMatchObject({ kty: "OKP", crv: "Ed25519", alg: "EdDSA", kid: TEST_KID });
  });

  it("a token signed with the golden key verifies in the SDK against the shipped JWKS", async () => {
    const { client, fetches } = sdkClient();
    const token = await attest(fixture("golden-conduct"));
    const res = await client.verify(token);
    expect(res).toEqual({ ok: true, keyId: TEST_KID });
    expect(fetches()).toBe(1);
  });
});

describe("K4.5 parity with @mnemom/sdk: golden digests", () => {
  for (const [name, key] of GOLDEN) {
    it(`${name}: verifier digest == golden verdict, and the SDK verifies an attestation over it`, async () => {
      const statement = fixture<Record<string, unknown>>(name);
      const expected = verdicts.digests[key];
      expect(expected).toMatch(/^[0-9a-f]{64}$/);

      // Verifier side: offline, valid, digest matches the golden verdict.
      const res = await verify(statement, jwks);
      expect(res.reasons).toEqual([]);
      expect(res.valid).toBe(true);
      expect(res.statements[0]?.digest).toBe(expected);

      // SDK side: the golden key verifies an attestation carrying that digest.
      const { client } = sdkClient();
      expect(await client.verify(await attest(statement))).toEqual({ ok: true, keyId: TEST_KID });
    });
  }

  it("the golden bundle's statements carry the golden digests in order, and each attests in the SDK", async () => {
    const bundle = fixture<{ statements: Record<string, unknown>[] }>("golden-bundle");
    const res = await verify(bundle, jwks);
    expect(res.valid).toBe(true);
    const expected = ["conduct1", "conduct2", "pr", "outcome", "card"].map((k) => verdicts.digests[k]);
    expect(res.statements.map((s) => s.digest)).toEqual(expected);
    const { client } = sdkClient();
    for (const statement of bundle.statements) {
      expect(await client.verify(await attest(statement))).toEqual({ ok: true, keyId: TEST_KID });
    }
  });
});

describe("K4.5 parity with @mnemom/sdk: signature-path rejections", () => {
  const byName = new Map(tampered.map((c) => [c.name, c]));
  const stmt = (c: TamperedCase) => c.input as Record<string, unknown>;

  /** Both sides must reject; the verifier with the committed golden reason. */
  async function expectBothReject(c: TamperedCase, token: string, sdkReason: RegExp): Promise<void> {
    const res = await verify(c.input, jwks);
    expect(res.valid, c.name).toBe(false);
    expect(res.reasons, c.name).toEqual([c.reason]);
    const { client } = sdkClient();
    const sdk = await client.verify(token);
    expect(sdk.ok, `${c.name} (sdk)`).toBe(false);
    expect(sdk.reason, `${c.name} (sdk)`).toMatch(sdkReason);
  }

  it("wrong-alg: an alg other than EdDSA is refused before any key is touched", async () => {
    const c = byName.get("wrong-alg")!;
    expect(c.reason).toBe(`0:${REASONS.unsupported_alg}`);
    const alg = stmt(c).alg;
    expect(typeof alg).toBe("string");
    expect(alg).not.toBe("EdDSA");
    // An SDK fetch here would mean the alg gate ran after key lookup.
    const { client, fetches } = sdkClient();
    const sdk = await client.verify(await attest(stmt(c), { alg: alg as string }));
    expect(sdk.ok).toBe(false);
    expect(sdk.reason).toMatch(/unsupported alg/);
    expect(fetches()).toBe(0);
    const res = await verify(c.input, jwks);
    expect(res.reasons).toEqual([c.reason]);
  });

  it("unknown-key: a kid absent from the JWKS is refused by both", async () => {
    const c = byName.get("unknown-key")!;
    expect(c.reason).toBe(`0:${REASONS.key_not_found}`);
    const kid = stmt(c).signing_key_id;
    expect(typeof kid).toBe("string");
    expect(kid).not.toBe(TEST_KID);
    await expectBothReject(c, await attest(stmt(c), { kid: kid as string }), /not present in the JWKS/);
  });

  it("bad-signature: a signature from another key is refused by both", async () => {
    const c = byName.get("bad-signature")!;
    expect(c.reason).toBe(`0:${REASONS.signature_invalid}`);
    const otherKey = "1".repeat(64);
    await expectBothReject(c, await attest(stmt(c), { privHex: otherKey }), /did not verify/);
  });

  it("tampered-cost: a statement changed after signing is refused by both", async () => {
    const c = byName.get("tampered-cost")!;
    expect(c.reason).toBe(`0:${REASONS.signature_invalid}`);
    // The SDK analogue: a good signature over a different payload.
    const good = await attest(fixture("golden-conduct"));
    const sig = good.split(".")[2]!;
    await expectBothReject(c, await attest(stmt(c), { signature: sig }), /did not verify/);
  });

  it("malformed-signature: bytes that are not a signature are refused by both", async () => {
    const c = byName.get("malformed-signature")!;
    expect(c.reason).toBe(`0:${REASONS.signature_malformed}`);
    await expectBothReject(c, await attest(stmt(c), { signature: "not-base64url!" }), /base64url|did not verify/);
  });

  it("missing-signature: a statement or token with no signature is refused by both", async () => {
    const c = byName.get("missing-signature")!;
    expect(c.reason).toBe(`0:${REASONS.signature_missing}`);
    await expectBothReject(c, await attest(stmt(c), { omitSignature: true }), /three-part/);
  });

  it("every tampered case outside the signature path is verifier-only and still matches its golden reason", async () => {
    const shared = new Set([
      "wrong-alg",
      "unknown-key",
      "bad-signature",
      "tampered-cost",
      "malformed-signature",
      "missing-signature",
    ]);
    const rest = tampered.filter((c) => !shared.has(c.name));
    expect(rest.length).toBeGreaterThan(0);
    for (const c of rest) {
      const res = await verify(c.input, jwks);
      expect(res.valid, c.name).toBe(false);
      expect(res.reasons, c.name).toEqual([c.reason]);
    }
  });
});
