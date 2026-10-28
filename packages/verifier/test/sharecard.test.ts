import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getPublicKeyAsync, signAsync } from "@noble/ed25519";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";
import { describe, expect, it } from "vitest";
import { RETIRED_PRIVATE_KEY_HEX } from "./helpers/sign.js";
import { canonicalJson, shareCardSigningInput, SHARE_CARD_STATEMENT_TYPES, SHARE_CARD_TYP, verifyShareCard } from "../src/sharecard.js";
import {
  baseCard, buildFixtures, signWithTestKey, testPublicKeyHex, TRANSPARENCY_ROOT_TYP, TEST_KEY_ID, b64url,
} from "./helpers/sharecard-fixtures.js";

const dir = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "sharecard");
const read = (n: string) => JSON.parse(readFileSync(join(dir, n), "utf8"));

// Golden bytes of the signing input for fixtures/sharecard/valid.json. Do not edit
// without a format version bump: changing this breaks every issued card.
const GOLDEN =
  '{"card_id":"card-valid-0001","issued_at":"2026-10-08T00:00:00.000Z","lines":[' +
  '{"id":"l1","kind":"count","label":"Changes reviewed","statement_hash":"' + "1".repeat(64) + '","value":42},' +
  '{"id":"l2","kind":"count","label":"Checks passed","statement_hash":"' + "2".repeat(64) + '","value":40}],' +
  '"period":{"end":"2026-10-07","start":"2026-10-01"},"signing_key_id":"test-sharecard-key-1",' +
  '"statements":[{"hash":"' + "1".repeat(64) + '","typ":"AAP-ConductRecord/v1"},{"hash":"' + "2".repeat(64) + '","typ":"AAP-PRRecord/v1"}],' +
  '"typ":"AAP-ShareCard/v1"}';

describe("fixtures", () => {
  it("committed fixtures match deterministic regeneration (UPDATE_FIXTURES=1 rewrites)", async () => {
    const f = (await buildFixtures()) as Record<string, any>;
    const files: Record<string, unknown> = {
      "valid.json": f.valid, "tampered.json": f.tampered, "period-revert.json": f.period,
      "identifying-repo.json": f.identifying.repo, "identifying-branch.json": f.identifying.branch,
      "identifying-pr_title.json": f.identifying.pr_title, "identifying-commit_message.json": f.identifying.commit_message,
    };
    for (const [name, obj] of Object.entries(files)) {
      const text = JSON.stringify(obj, null, 2) + "\n";
      if (process.env.UPDATE_FIXTURES) writeFileSync(join(dir, name), text);
      expect(readFileSync(join(dir, name), "utf8")).toBe(text);
    }
    const golden = shareCardSigningInput(f.valid) + "\n";
    if (process.env.UPDATE_FIXTURES) writeFileSync(join(dir, "valid.canonical.txt"), golden);
    expect(readFileSync(join(dir, "valid.canonical.txt"), "utf8")).toBe(golden);
  });
});

describe("canonical JSON", () => {
  it("is byte-for-byte golden", () => {
    expect(shareCardSigningInput(read("valid.json"))).toBe(GOLDEN);
    expect(readFileSync(join(dir, "valid.canonical.txt"), "utf8")).toBe(GOLDEN + "\n");
  });
  it("sorts keys, no whitespace, excludes signature", () => {
    expect(canonicalJson({ b: [1, { z: 1, a: 2 }], a: "x" })).toBe('{"a":"x","b":[1,{"a":2,"z":1}]}');
    expect(shareCardSigningInput({ b: 1, signature: "s", a: 2 })).toBe('{"a":2,"b":1}');
  });
});

describe("verifyShareCard", () => {
  it("accepts the valid card and returns its lines", async () => {
    const r = await verifyShareCard(read("valid.json"), { publicKey: await testPublicKeyHex() });
    expect(r.errors).toEqual([]);
    expect(r.valid).toBe(true);
    expect(r.lines.map((l) => l.value)).toEqual([42, 40]);
  });
  it("accepts a period card containing a revert line", async () => {
    const r = await verifyShareCard(read("period-revert.json"), { publicKey: await testPublicKeyHex() });
    expect(r.valid).toBe(true);
    expect(r.lines.some((l) => l.kind === "revert" && l.value === 2)).toBe(true);
  });
  it("rejects a tampered number and returns no lines", async () => {
    const r = await verifyShareCard(read("tampered.json"), { publicKey: await testPublicKeyHex() });
    expect(r.valid).toBe(false);
    expect(r.lines).toEqual([]);
  });
  it("rejects every tampered field", async () => {
    const pk = await testPublicKeyHex();
    const mutations: ((c: any) => void)[] = [
      (c) => (c.lines[1].value += 1), (c) => (c.lines[0].label = "x"), (c) => (c.period.end = "2026-10-08"),
      (c) => (c.card_id = "other"), (c) => (c.issued_at = "2026-10-09T00:00:00.000Z"), (c) => (c.signing_key_id = "k2"),
      (c) => (c.statements[0].hash = "9".repeat(64)),
    ];
    for (const m of mutations) {
      const c = read("valid.json");
      m(c);
      expect((await verifyShareCard(c, { publicKey: pk })).valid).toBe(false);
    }
  });
  it.each(["repo", "branch", "pr_title", "commit_message"])("rejects a validly-signed card with identifying field %s", async (k) => {
    const c = read(`identifying-${k}.json`);
    const r = await verifyShareCard(c, { publicKey: await testPublicKeyHex() });
    expect(r.valid).toBe(false);
    expect(r.lines).toEqual([]);
    expect(r.errors.join("\n")).toContain("identifying field");
  });
  it("rejects top-level identifying/unknown fields even when signed", async () => {
    const c = baseCard();
    (c as any).repo = "x";
    const r = await verifyShareCard(await signWithTestKey(c), { publicKey: await testPublicKeyHex() });
    expect(r.valid).toBe(false);
  });
  it("rejects a line whose statement_hash is not committed", async () => {
    const c: any = baseCard();
    c.lines[0].statement_hash = "f".repeat(64);
    expect((await verifyShareCard(await signWithTestKey(c), { publicKey: await testPublicKeyHex() })).valid).toBe(false);
  });
  it("rejects unsigned, wrong key, malformed input", async () => {
    const pk = await testPublicKeyHex();
    const { signature: _s, ...unsigned } = read("valid.json");
    expect((await verifyShareCard(unsigned, { publicKey: pk })).valid).toBe(false);
    expect((await verifyShareCard(read("valid.json"), { publicKey: "00".repeat(32) })).valid).toBe(false);
    expect((await verifyShareCard({ ...read("valid.json"), signature: "!!!" }, { publicKey: pk })).valid).toBe(false);
    for (const bad of [null, 1, "x", [], {}]) expect((await verifyShareCard(bad, { publicKey: pk })).valid).toBe(false);
  });
});

describe("typ pinning", () => {
  it("pins the typ constant", () => expect(SHARE_CARD_TYP).toBe("AAP-ShareCard/v1"));
  it("a TransparencyRoot-signed payload does not verify as a ShareCard", async () => {
    const pk = await testPublicKeyHex();
    const root = await signWithTestKey({
      typ: TRANSPARENCY_ROOT_TYP, tree_size: 7, root_hash: "a".repeat(64),
      published_at: "2026-10-08T00:00:00.000Z", signing_key_id: TEST_KEY_ID,
    });
    expect((await verifyShareCard(root, { publicKey: pk })).valid).toBe(false);
    // Same key, full card body, but signed under the Root typ.
    const asRoot = await signWithTestKey({ ...baseCard(), typ: TRANSPARENCY_ROOT_TYP });
    expect((await verifyShareCard(asRoot, { publicKey: pk })).valid).toBe(false);
    // Relabelling a root-signed card as ShareCard breaks the signature.
    const relabelled = { ...asRoot, typ: SHARE_CARD_TYP };
    expect((await verifyShareCard(relabelled, { publicKey: pk })).valid).toBe(false);
    expect(b64url(new Uint8Array([251, 255]))).toBe("-_8");
  });
});

describe("hardening (MNE-9022 review findings 1-4)", () => {
  const verifySigned = async (mutate: (c: any) => void) => {
    const c: any = baseCard();
    mutate(c);
    return verifyShareCard(await signWithTestKey(c), { publicKey: await testPublicKeyHex() });
  };
  const rejects = async (mutate: (c: any) => void, needle: string) => {
    const r = await verifySigned(mutate);
    expect(r.valid).toBe(false);
    expect(r.lines).toEqual([]);
    expect(r.errors.join("\n")).toContain(needle);
  };

  it("rejects non-opaque card_id and line ids", async () => {
    await rejects((c) => (c.card_id = "feat/internal-thing"), "card_id");
    await rejects((c) => (c.card_id = "Card-UPPER"), "card_id");
    await rejects((c) => (c.card_id = "a".repeat(65)), "card_id");
    await rejects((c) => (c.lines[0].id = "mnemom/secret"), "lines[0].id");
    await rejects((c) => (c.lines[0].id = ""), "lines[0].id");
  });
  it("rejects labels that carry repo paths, '#', URLs or are too long", async () => {
    await rejects((c) => (c.lines[0].label = "mnemom/secret-repo PR: Fix customer X outage"), "label");
    await rejects((c) => (c.lines[0].label = "Issue #1234"), "label");
    await rejects((c) => (c.lines[0].label = "see https://example.com"), "label");
    await rejects((c) => (c.lines[0].label = "www.example.com"), "label");
    await rejects((c) => (c.lines[0].label = "a".repeat(41)), "label");
    await rejects((c) => (c.lines[0].label = ""), "label");
  });
  it("rejects a non-canonical or wrong-length signature", async () => {
    const pk = await testPublicKeyHex();
    const valid = read("valid.json");
    expect(valid.signature).toHaveLength(86);
    // Last char flipped to another char with the same decoded bytes (trailing bits ignored by atob).
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    const last = valid.signature.slice(-1);
    const idx = alphabet.indexOf(last);
    const sibling = alphabet[idx ^ 1]!; // differs only in the low (unused) bit
    expect(sibling).not.toBe(last);
    const r = await verifyShareCard({ ...valid, signature: valid.signature.slice(0, -1) + sibling }, { publicKey: pk });
    expect(r.valid).toBe(false);
    expect(r.errors.join("\n")).toContain("signature");
    for (const bad of [valid.signature.slice(0, -1), valid.signature + "A", valid.signature + "=="]) {
      expect((await verifyShareCard({ ...valid, signature: bad }, { publicKey: pk })).valid).toBe(false);
    }
  });
  it("rejects a non-strict issued_at", async () => {
    for (const bad of ["1", "October 5", "2026-10-08", "2026-10-08T00:00:00", "2026-13-08T00:00:00Z", "2026-02-30T00:00:00Z", "2026-10-08T24:00:00Z", "2026-10-08 00:00:00Z"]) {
      await rejects((c) => (c.issued_at = bad), "issued_at");
    }
  });
  it("accepts RFC 3339 issued_at with offset", async () => {
    expect((await verifySigned((c) => (c.issued_at = "2026-10-08T01:02:03+05:30"))).valid).toBe(true);
  });
  it("rejects impossible period dates and start > end", async () => {
    await rejects((c) => (c.period.start = "2026-13-45"), "period.start");
    await rejects((c) => (c.period.end = "2026-02-30"), "period.end");
    await rejects((c) => (c.period = { start: "2026-10-07", end: "2026-10-01" }), "start must be <= end");
    expect((await verifySigned((c) => (c.period = { start: "2026-10-07", end: "2026-10-07" }))).valid).toBe(true);
  });
  it("pins statement typ to the three real record statement types", () => {
    expect([...SHARE_CARD_STATEMENT_TYPES]).toEqual(["AAP-ConductRecord/v1", "AAP-PRRecord/v1", "AAP-Outcome/v1"]);
  });
  it("rejects the old placeholder, the card's own typ, and the bundle typ as a statement typ", async () => {
    for (const t of ["AAP-Statement/v1", "AAP-ShareCard/v1", "AAP-RecordBundle/v1"]) {
      await rejects((c) => (c.statements[0].typ = t), "statements[0].typ");
    }
  });
  it("accepts each of the three real types", async () => {
    const pk = await testPublicKeyHex();
    for (const t of ["AAP-ConductRecord/v1", "AAP-PRRecord/v1", "AAP-Outcome/v1"]) {
      const c = baseCard() as any;
      c.statements[0].typ = t;
      expect((await verifyShareCard(await signWithTestKey(c), { publicKey: pk })).valid).toBe(true);
    }
  });
  it("keeps the schema enum in step with the verifier constant", () => {
    const schema = JSON.parse(readFileSync(join(dir, "..", "..", "..", "..", "..", "schemas", "aap-sharecard.schema.json"), "utf8"));
    expect(schema.properties.statements.items.properties.typ.enum).toEqual([...SHARE_CARD_STATEMENT_TYPES]);
  });
  it("rejects unknown statement typ", async () => {
    await rejects((c) => (c.statements[0].typ = "anything"), "statements[0].typ");
    await rejects((c) => (c.statements[0].typ = "mnemom/secret-repo"), "statements[0].typ");
  });
  it("rejects a statement no line references", async () => {
    await rejects((c) => c.statements.push({ typ: "AAP-Outcome/v1", hash: "9".repeat(64) }), "not referenced by any line");
  });
  it("rejects duplicate line ids", async () => {
    await rejects((c) => (c.lines[1].id = c.lines[0].id), "duplicate line id");
  });
});

describe("key rotation: card signed by a retired key", () => {
  const signWithRetired = async () => {
    const card = { ...baseCard(), signing_key_id: "retired-sharecard-key" };
    const sig = await signAsync(utf8ToBytes(shareCardSigningInput(card)), hexToBytes(RETIRED_PRIVATE_KEY_HEX));
    return { ...card, signature: b64url(sig) };
  };

  it("verifies with the retired public key and fails with the current one", async () => {
    const card = await signWithRetired();
    const retiredPk = bytesToHex(await getPublicKeyAsync(hexToBytes(RETIRED_PRIVATE_KEY_HEX)));
    const ok = await verifyShareCard(card, { publicKey: retiredPk });
    expect(ok.errors).toEqual([]);
    expect(ok.valid).toBe(true);
    const bad = await verifyShareCard(card, { publicKey: await testPublicKeyHex() });
    expect(bad.valid).toBe(false);
    expect(bad.lines).toEqual([]);
    expect(bad.errors).toEqual(["signature: verification failed"]);
  });
});
