import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { canonicalJson, shareCardSigningInput, SHARE_CARD_TYP, verifyShareCard } from "../src/sharecard.js";
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
  '"statements":[{"hash":"' + "1".repeat(64) + '","typ":"AAP-Statement/v1"},{"hash":"' + "2".repeat(64) + '","typ":"AAP-Statement/v1"}],' +
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
