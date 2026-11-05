/**
 * AAP-TransparencyRoot/v1, `expectedTyp` and `expectedDigest` (0.6.3).
 *
 * Ported from mnemom-platform shared/verifier/__tests__/statement.test.ts and
 * shared/sdk/__tests__/statement.test.ts at origin/main, so this package and
 * the SDK agree on `valid` and on the reason. The SDK's `verifyStatement` is
 * not in the published @mnemom/sdk 1.1.0 this package pins as a
 * devDependency, so the cases are ported with their expected verdicts rather
 * than run side by side.
 *
 * The root body is the shape mnemom-api src/transparency/root_publisher.ts
 * signs: exactly typ, tree_size, root_hash, published_at, signing_key_id,
 * with an unpadded base64url Ed25519 signature over canonicalJson of those
 * five fields.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { REASONS, STATEMENT_TYPES, type RecordJwks, type StatementTyp } from "../src/statements.js";
import { statementCommitment, statementDigest, verify, verifyStatement } from "../src/verify-record.js";
import { TEST_KID, signStatement } from "./helpers/sign.js";

const here = dirname(fileURLToPath(import.meta.url));
const jwks = JSON.parse(readFileSync(resolve(here, "fixtures/record/jwks.json"), "utf8")) as RecordJwks;

const ROOT = "AAP-TransparencyRoot/v1" as const;
const CONDUCT = "AAP-ConductRecord/v1" as const;

function rootBody(kid = TEST_KID): Record<string, unknown> {
  return {
    typ: ROOT,
    tree_size: 42,
    root_hash: "d".repeat(64),
    published_at: "2026-10-23T18:00:00.000Z",
    signing_key_id: kid,
  };
}

function conductBody(kid = TEST_KID): Record<string, unknown> {
  return {
    typ: CONDUCT,
    signing_key_id: kid,
    built_at: "2026-10-23T18:00:00.000Z",
    previous_digest: null,
    unit_kind: "conversation",
    lineage_key: "conv_" + "a".repeat(32),
  };
}

function shareCardBody(kid = TEST_KID): Record<string, unknown> {
  return {
    typ: "AAP-ShareCard/v1",
    signing_key_id: kid,
    built_at: "2026-10-23T18:00:00.000Z",
    source_digest: "c".repeat(64),
    lines: [{ class: "measured", text: "3 of 4 commits from recorded sessions" }],
  };
}

function bodyFor(typ: StatementTyp): Record<string, unknown> {
  if (typ === ROOT) return rootBody();
  if (typ === "AAP-ShareCard/v1") return shareCardBody();
  if (typ === "AAP-Outcome/v1") return { ...conductBody(), typ, previous_digest: undefined };
  return { ...conductBody(), typ };
}

describe("AAP-TransparencyRoot/v1", () => {
  it("is one of STATEMENT_TYPES", () => {
    expect(STATEMENT_TYPES).toContain(ROOT);
  });

  it("commits to exactly the five fields root_publisher.ts signs, in canonical order", () => {
    expect(statementCommitment({ ...rootBody(), signature: "x" })).toBe(
      `{"published_at":"2026-10-23T18:00:00.000Z","root_hash":"${"d".repeat(64)}","signing_key_id":"${TEST_KID}","tree_size":42,"typ":"AAP-TransparencyRoot/v1"}`,
    );
  });

  it("a signed root verifies, bare and under its own expectedTyp and digest", async () => {
    const signed = await signStatement(rootBody());
    const digest = statementDigest(signed);
    const res = await verifyStatement(signed, jwks, { expectedTyp: ROOT, expectedDigest: digest });
    expect(res).toEqual({ valid: true, typ: ROOT, digest, signing_key_id: TEST_KID, reasons: [], flags: [] });
    expect((await verifyStatement(signed, jwks)).valid).toBe(true);
    // verify() accepts it as a bare statement and inside a bundle.
    expect((await verify(signed, jwks)).reasons).toEqual([]);
    expect((await verify({ typ: "AAP-RecordBundle/v1", statements: [signed] }, jwks)).reasons).toEqual([]);
  });

  it("an edited field breaks the signature", async () => {
    const signed = await signStatement(rootBody());
    for (const edit of [{ tree_size: 43 }, { root_hash: "e".repeat(64) }, { published_at: "2026-10-23T18:00:01.000Z" }]) {
      expect((await verifyStatement({ ...signed, ...edit }, jwks, { expectedTyp: ROOT })).reasons).toEqual([
        REASONS.signature_invalid,
      ]);
    }
  });

  it("a misspelled typ is unknown_typ, with or without expectedTyp", async () => {
    const signed = await signStatement({ ...rootBody(), typ: "AAP-Transparencyroot/v1" });
    expect((await verifyStatement(signed, jwks)).reasons).toEqual([REASONS.unknown_typ]);
    expect((await verifyStatement(signed, jwks, { expectedTyp: ROOT })).reasons).toEqual([REASONS.unknown_typ]);
  });
});

// A root signed by mnemom-api itself, not by this suite. The cases above build the root
// and its commitment here, so a drift between this package and the publisher would move
// both sides together. This fixture is the output of mnemom-api
// src/transparency/root_publisher.ts `publishSignedRoot` at SOURCE.commit (its own
// canonicalJson and WebCrypto Ed25519), run with the test key in helpers/sign.ts, a cached
// tree of size 1337 and a fixed clock. Ed25519 is deterministic, so a rerun is byte for
// byte the same. aip CI cannot read mnemom-api (private), so the copy is pinned by source
// commit and sha256, as golden-renderings.test.ts does; a hand edit fails the first test.
// When root_publisher.ts changes the signed shape, regenerate the root there and bring it
// back here with a new pin in the same PR.
const API_ROOT_SOURCE = {
  repo: "mnemom/mnemom-api",
  commit: "0b06f5bae65d7317bd99ee9456c86fcfd691a613",
  path: "src/transparency/root_publisher.ts",
  sha256: "68592d83ea558000769403fac5357b30d69b9e0ede853fefc1706fe4eec8f6da",
} as const;

describe("AAP-TransparencyRoot/v1 signed by mnemom-api root_publisher.ts", () => {
  const raw = readFileSync(resolve(here, "fixtures/record/api-transparency-root.json"));
  const apiRoot = JSON.parse(raw.toString("utf8")) as Record<string, unknown>;

  it("fixture is the pinned output of root_publisher.ts", () => {
    expect(createHash("sha256").update(raw).digest("hex")).toBe(API_ROOT_SOURCE.sha256);
    expect(Object.keys(apiRoot)).toEqual(["typ", "tree_size", "root_hash", "published_at", "signing_key_id", "signature"]);
  });

  it("this package rebuilds the exact bytes the publisher signed", () => {
    expect(statementCommitment(apiRoot)).toBe(
      '{"published_at":"2026-11-04T12:00:00.000Z",' +
        '"root_hash":"50f6e8195e4b8d6c953dcef21d85e2f341cd792bf603bdaa6c577d6661038df4",' +
        '"signing_key_id":"aap-test-record-2026-10","tree_size":1337,"typ":"AAP-TransparencyRoot/v1"}',
    );
  });

  it("verifies under expectedTyp and its digest, bare and inside a bundle", async () => {
    const digest = statementDigest(apiRoot);
    expect(await verifyStatement(apiRoot, jwks, { expectedTyp: ROOT, expectedDigest: digest })).toEqual({
      valid: true,
      typ: ROOT,
      digest,
      signing_key_id: TEST_KID,
      reasons: [],
      flags: [],
    });
    expect((await verify({ typ: "AAP-RecordBundle/v1", statements: [apiRoot] }, jwks)).reasons).toEqual([]);
  });

  it("an edited field of the publisher's root reads signature_invalid", async () => {
    for (const edit of [{ tree_size: 1338 }, { root_hash: "e".repeat(64) }, { published_at: "2026-11-04T12:00:00.001Z" }]) {
      expect((await verifyStatement({ ...apiRoot, ...edit }, jwks, { expectedTyp: ROOT })).reasons).toEqual([
        REASONS.signature_invalid,
      ]);
    }
  });
});

describe("verifyStatement: typ confusion (expectedTyp)", () => {
  it("a signed transparency root never verifies as a conduct record", async () => {
    const signed = await signStatement(rootBody());
    expect((await verifyStatement(signed, jwks, { expectedTyp: CONDUCT })).reasons).toEqual([REASONS.typ_mismatch]);
    // Relabelled: typ is inside the signed bytes, so the signature breaks.
    const relabelled = { ...signed, typ: CONDUCT };
    expect((await verifyStatement(relabelled, jwks, { expectedTyp: CONDUCT })).reasons).toEqual([
      REASONS.signature_invalid,
    ]);
  });

  it("a signed conduct record never verifies as a transparency root", async () => {
    const signed = await signStatement(conductBody());
    expect((await verifyStatement(signed, jwks, { expectedTyp: ROOT })).reasons).toEqual([REASONS.typ_mismatch]);
    expect((await verifyStatement({ ...signed, typ: ROOT }, jwks, { expectedTyp: ROOT })).reasons).toEqual([
      REASONS.signature_invalid,
    ]);
  });

  const pairs = STATEMENT_TYPES.flatMap((from) => STATEMENT_TYPES.filter((to) => to !== from).map((to) => [from, to] as const));
  it.each(pairs)("%s is refused when %s is expected, as signed or relabelled", async (from, to) => {
    const signed = await signStatement(bodyFor(from));
    const opts = { expectedTyp: to };
    expect((await verifyStatement(signed, jwks, opts)).reasons).toEqual([REASONS.typ_mismatch]);
    expect((await verifyStatement({ ...signed, typ: to }, jwks, opts)).reasons).toEqual([REASONS.signature_invalid]);
  });

  it.each(STATEMENT_TYPES.map((t) => [t] as const))("%s verifies under its own expectedTyp", async (typ) => {
    const signed = await signStatement(bodyFor(typ));
    expect((await verifyStatement(signed, jwks, { expectedTyp: typ })).reasons).toEqual([]);
  });

  it("an expectedTyp outside STATEMENT_TYPES is refused before anything else", async () => {
    const signed = await signStatement(rootBody());
    for (const bad of ["AAP-RecordBundle/v1", "", "aap-transparencyroot/v1", 7]) {
      const res = await verifyStatement(signed, jwks, { expectedTyp: bad as StatementTyp });
      expect(res.reasons).toEqual([REASONS.unsupported_expected_typ]);
    }
    // Even on an input with no valid typ or signature.
    expect((await verifyStatement({ typ: "nope" }, jwks, { expectedTyp: "nope" as StatementTyp })).reasons).toEqual([
      REASONS.unsupported_expected_typ,
    ]);
  });

  it("typ_mismatch fires before any key lookup", async () => {
    const signed = await signStatement({ ...rootBody(), signing_key_id: "aap-not-published" });
    expect((await verifyStatement(signed, jwks, { expectedTyp: CONDUCT })).reasons).toEqual([REASONS.typ_mismatch]);
    expect((await verifyStatement(signed, jwks, { expectedTyp: ROOT })).reasons).toEqual([REASONS.key_not_found]);
  });
});

describe("verifyStatement: expectedDigest", () => {
  it("passes when it equals the statement digest", async () => {
    const signed = await signStatement(conductBody());
    const res = await verifyStatement(signed, jwks, { expectedTyp: CONDUCT, expectedDigest: statementDigest(signed) });
    expect(res.valid).toBe(true);
  });

  it("fails with digest_mismatch on any other string, matched exactly", async () => {
    const signed = await signStatement(conductBody());
    const digest = statementDigest(signed);
    for (const wrong of ["0".repeat(64), digest.toUpperCase(), ""]) {
      const res = await verifyStatement(signed, jwks, { expectedTyp: CONDUCT, expectedDigest: wrong });
      expect(res.reasons).toEqual([REASONS.digest_mismatch]);
      expect(res.digest).toBe(digest);
    }
  });

  it("is checked after the signature: a bad signature reads signature_invalid, not digest_mismatch", async () => {
    const signed = await signStatement(conductBody());
    const res = await verifyStatement({ ...signed, signature: "A".repeat(86) }, jwks, { expectedDigest: "0".repeat(64) });
    expect(res.reasons).toEqual([REASONS.signature_invalid]);
  });

  it("fails alone, before the body checks (a share card with a bad line)", async () => {
    const card = await signStatement({ ...shareCardBody(), lines: [{ class: "estimate", text: "x" }] });
    expect((await verifyStatement(card, jwks)).reasons).toEqual([REASONS.card_line_class_not_allowed]);
    expect((await verifyStatement(card, jwks, { expectedDigest: "0".repeat(64) })).reasons).toEqual([
      REASONS.digest_mismatch,
    ]);
  });

  it("leaving the options out changes nothing", async () => {
    const signed = await signStatement(rootBody());
    expect(await verifyStatement(signed, jwks, {})).toEqual(await verifyStatement(signed, jwks));
  });

  it("a non-object options value from an untyped caller is read as no options", async () => {
    const signed = await signStatement(rootBody());
    const plain = await verifyStatement(signed, jwks);
    expect(plain.valid).toBe(true);
    // An array carrying option-like keys must not be read as options either.
    const arrayish = Object.assign([], { expectedTyp: CONDUCT, expectedDigest: "0".repeat(64) });
    for (const bad of [null, "AAP-ConductRecord/v1", 42, true, arrayish]) {
      const res = await verifyStatement(signed, jwks, bad as unknown as Parameters<typeof verifyStatement>[2]);
      expect(res, String(bad)).toEqual(plain);
    }
  });
});
