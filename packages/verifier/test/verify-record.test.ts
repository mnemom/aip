import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { canonicalJson } from "../src/canonical.js";
import { FLAGS, REASONS, type RecordJwks } from "../src/statements.js";
import { statementDigest, verify, verifyStatement } from "../src/verify-record.js";
import { RETIRED_KID, RETIRED_PRIVATE_KEY_HEX, TEST_KID, retiredJwk, signStatement, testJwk } from "./helpers/sign.js";
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
      expect(res.statements[0]!.digest).toBe(verdicts.digests[key]);
      expect(statementDigest(s)).toBe(verdicts.digests[key]);
    }
  });

  it("links statements by digest: the PR record names the last conduct build", () => {
    const bundle = fixture<{ statements: Record<string, unknown>[] }>("golden-bundle");
    const [c1, c2, pr, outcome, card] = bundle.statements;
    expect(c2!.previous_digest).toBe(statementDigest(c1!));
    expect(pr!.conduct_digests).toEqual([statementDigest(c2!)]);
    expect(outcome!.pr_record_digest).toBe(statementDigest(pr!));
    expect(card!.source_digest).toBe(statementDigest(pr!));
  });
});

describe("verify: tampered fixtures fail closed with the named reason", () => {
  const cases = fixture<TamperedCase[]>("tampered");
  it.each(cases.map((c) => [c.name, c] as const))("%s", async (_name, c) => {
    const res = await verify(
      c.input,
      jwks,
      c.expected_head_sha === undefined ? {} : { expected_head_sha: c.expected_head_sha },
    );
    expect(res.valid).toBe(false);
    expect(res.reasons).toContain(c.reason);
  });
});

describe("verify: previous_digest chain and head binding (K1.20)", () => {
  const golden = () => fixture<{ typ: string; statements: Record<string, unknown>[] }>("golden-bundle");
  const HEAD = "f".repeat(40);

  it("passes the golden bundle with its own head, and without the option", async () => {
    expect((await verify(golden(), jwks, { expected_head_sha: HEAD })).reasons).toEqual([]);
    expect((await verify(golden(), jwks)).valid).toBe(true);
  });

  it("flags a lineage truncated by retention: absent predecessor on the chain's first statement", async () => {
    // Retention (mnemom-api record-retention.ts) deleted conduct1; the oldest
    // surviving build names it. Honest bundle: valid, with a non-failing flag.
    const b = golden();
    const res = await verify({ ...b, statements: b.statements.slice(1) }, jwks, { expected_head_sha: HEAD });
    expect(res.reasons).toEqual([]);
    expect(res.valid).toBe(true);
    expect(res.flags).toContainEqual({ flag: FLAGS.lineage_truncated, subject: b.statements[1]!.previous_digest });
    // The predecessor is a chain question, never the generic link flag.
    expect(res.flags.filter((f) => f.flag === FLAGS.linked_statement_not_in_bundle)).toEqual([]);
  });

  it("fails an absent predecessor mid-chain as chain_broken", async () => {
    const b = golden();
    const [c1, c2] = b.statements;
    const c3 = await signStatement({ ...c2!, previous_digest: statementDigest(c2!), built_at: "2026-10-23T18:40:00.000Z" });
    // c1 present, c2 missing, c3 names c2: a gap inside the bundle.
    const gap = await verify({ ...b, statements: [c1!, c3] }, jwks);
    expect(gap.reasons).toEqual([`1:${REASONS.chain_broken}`]);
    expect(gap.flags.map((f) => f.flag)).not.toContain(FLAGS.lineage_truncated);
    // Truncated head, then a gap: the first is a flag, the second still fails.
    const c4 = await signStatement({ ...c3, previous_digest: "9".repeat(64), built_at: "2026-10-23T18:50:00.000Z" });
    const both = await verify({ ...b, statements: [c2!, c4] }, jwks);
    expect(both.reasons).toEqual([`1:${REASONS.chain_broken}`]);
    expect(both.flags).toContainEqual({ flag: FLAGS.lineage_truncated, subject: c2!.previous_digest });
    // A truncated root takes the chain's root: a later genesis is a second history.
    const c1Again = await signStatement({ ...c1!, built_at: "2026-10-23T18:45:00.000Z" });
    expect((await verify({ ...b, statements: [c2!, c1Again] }, jwks)).reasons).toEqual([`1:${REASONS.chain_broken}`]);
  });

  it("keeps the strict order rule: a predecessor later in the bundle fails, it is not truncation", async () => {
    const b = golden();
    const [c1, c2] = b.statements;
    const res = await verify({ ...b, statements: [c2!, c1!] }, jwks);
    expect(res.reasons).toEqual([`0:${REASONS.chain_broken}`]);
    expect(res.flags.map((f) => f.flag)).not.toContain(FLAGS.lineage_truncated);
  });

  it("does not flag truncation on a statement that fails its signature", async () => {
    const b = golden();
    const edited = { ...b.statements[1]!, cost: { mu_millimu: 1 } };
    const res = await verify({ ...b, statements: [edited, ...b.statements.slice(2)] }, jwks);
    expect(res.reasons).toContain(`0:${REASONS.signature_invalid}`);
    expect(res.flags.map((f) => f.flag)).not.toContain(FLAGS.lineage_truncated);
  });

  it("an edited predecessor fails its signature and breaks its successor's link", async () => {
    const b = golden();
    const edited = { ...b.statements[0]!, cost: { mu_millimu: 1 } };
    const res = await verify({ ...b, statements: [edited, ...b.statements.slice(1)] }, jwks);
    expect(res.reasons).toEqual([`0:${REASONS.signature_invalid}`, `1:${REASONS.chain_broken}`]);
  });

  it("does not check the chain of a bare statement", async () => {
    const res = await verify(fixture("golden-conduct"), jwks);
    expect(res.valid).toBe(true);
  });

  it("binds a bare PR record to the head too", async () => {
    const pr = fixture<Record<string, unknown>>("golden-pr-record");
    expect((await verify(pr, jwks, { expected_head_sha: HEAD })).valid).toBe(true);
    expect((await verify(pr, jwks, { expected_head_sha: "1".repeat(40) })).reasons).toEqual([REASONS.head_mismatch]);
  });

  it("uses the latest PR record when there are several", async () => {
    const b = golden();
    const pr = b.statements[2]!;
    const newer = await signStatement({
      ...pr,
      previous_digest: statementDigest(pr),
      head_sha: "2".repeat(40),
      built_at: "2026-10-23T20:00:00.000Z",
    });
    const statements = [...b.statements, newer];
    expect((await verify({ ...b, statements }, jwks, { expected_head_sha: "2".repeat(40) })).valid).toBe(true);
    expect((await verify({ ...b, statements }, jwks, { expected_head_sha: HEAD })).reasons).toEqual([REASONS.head_mismatch]);
  });

  it("an edited PR record head binds nothing: signature_invalid and head_unbound", async () => {
    const b = golden();
    const statements = [...b.statements];
    statements[2] = { ...statements[2]!, head_sha: "a".repeat(40) };
    const res = await verify({ ...b, statements }, jwks, { expected_head_sha: "a".repeat(40) });
    expect(res.reasons).toEqual([`2:${REASONS.signature_invalid}`, REASONS.head_unbound]);
  });

  it("reads head_sha from the PR record shape main signs (mnemom-api pr-record.ts)", async () => {
    // Field set of record-sandbox#350's PR record at e05a9ffa: issued_at, both
    // prev_digest and previous_digest, no repo or pr_number.
    const b = golden();
    const pr = await signStatement({
      typ: "AAP-PRRecord/v1",
      signing_key_id: TEST_KID,
      issued_at: "2026-11-03T22:00:00.000Z",
      built_at: "2026-11-03T22:00:00.000Z",
      prev_digest: null,
      previous_digest: null,
      unit_kind: "pull_request",
      head_sha: "4085847847e146869092d3948ed7a7136313ff6c",
      conduct_digests: [statementDigest(b.statements[1]!)],
      commits: { bound: 1, total: 1 },
    });
    const bundle = { ...b, statements: [b.statements[0]!, b.statements[1]!, pr] };
    const head = "4085847847e146869092d3948ed7a7136313ff6c";
    expect((await verify(bundle, jwks, { expected_head_sha: head })).reasons).toEqual([]);
    // The bundle commit is not the bound head.
    expect((await verify(bundle, jwks, { expected_head_sha: "e05a9ffa63b8981773cb8a0eb6dc4ea7bc4da8c2" })).reasons).toEqual([
      REASONS.head_mismatch,
    ]);
  });

  it("fails a statement whose prev_digest and previous_digest aliases differ", async () => {
    const b = golden();
    const [c1, c2] = b.statements;
    const prev = statementDigest(c1!);
    const other = "9".repeat(64);
    // Equal aliases (both null, or the same digest) pass.
    const c1Both = await signStatement({ ...c1!, prev_digest: null });
    const c2Both = await signStatement({ ...c2!, previous_digest: statementDigest(c1Both), prev_digest: statementDigest(c1Both) });
    expect((await verify({ ...b, statements: [c1Both, c2Both] }, jwks)).reasons).toEqual([]);
    // A differing pair fails as chain_broken, once, in a bundle and on its own.
    const cases: [string, Record<string, unknown>, number][] = [
      ["null vs digest", await signStatement({ ...c1!, prev_digest: prev }), 0],
      ["digest vs null", await signStatement({ ...c2!, prev_digest: null }), 1],
      ["two digests", await signStatement({ ...c2!, prev_digest: other }), 1],
    ];
    for (const [name, bad, i] of cases) {
      const statements = i === 0 ? [bad, c2!] : [c1!, bad];
      const inBundle = await verify({ ...b, statements }, jwks);
      expect(inBundle.reasons.filter((r) => r.startsWith(`${i}:`)), name).toEqual([`${i}:${REASONS.chain_broken}`]);
      expect((await verify(bad, jwks)).reasons, name).toEqual([`0:${REASONS.chain_broken}`]);
    }
  });

  it("reports chain_broken once when an alias mismatch and a missing predecessor meet", async () => {
    const b = golden();
    // previous_digest names conduct1, which is not in the bundle; prev_digest disagrees too.
    const c2 = await signStatement({ ...b.statements[1]!, prev_digest: "9".repeat(64) });
    const res = await verify({ ...b, statements: [c2] }, jwks);
    expect(res.reasons).toEqual([`0:${REASONS.chain_broken}`]);
  });

  it("a malformed previous_digest in a bundle is digest_malformed, not chain_broken", async () => {
    const b = golden();
    const c2 = await signStatement({ ...b.statements[1]!, previous_digest: "not-a-digest" });
    const res = await verify({ ...b, statements: [b.statements[0]!, c2] }, jwks);
    expect(res.reasons).toEqual([`1:${REASONS.digest_malformed}`]);
  });

  it("a non-object entry fails on its own and leaves the chain and head checks intact", async () => {
    const b = golden();
    for (const junk of [null, "x", 42]) {
      // At the front it shifts every index; at the end it sits after the PR record.
      const front = await verify({ ...b, statements: [junk, ...b.statements] }, jwks, { expected_head_sha: HEAD });
      expect(front.reasons, String(junk)).toEqual([`0:${REASONS.not_an_object}`]);
      const end = await verify({ ...b, statements: [...b.statements, junk] }, jwks, { expected_head_sha: HEAD });
      expect(end.reasons, String(junk)).toEqual([`${b.statements.length}:${REASONS.not_an_object}`]);
    }
  });

  it("skips a verified PR record with no string head_sha when binding the head", async () => {
    const b = golden();
    const pr = b.statements[2]!;
    const noHead: Record<string, unknown> = { ...pr, previous_digest: statementDigest(pr), built_at: "2026-10-23T20:00:00.000Z" };
    delete noHead.head_sha;
    const latest = await signStatement(noHead);
    // The earlier PR record still binds the head.
    const res = await verify({ ...b, statements: [...b.statements, latest] }, jwks, { expected_head_sha: HEAD });
    expect(res.reasons).toEqual([]);
    // Alone, a PR record without a head binds nothing.
    const bare = await signStatement({ ...noHead, previous_digest: null, head_sha: 7 });
    expect((await verify(bare, jwks, { expected_head_sha: HEAD })).reasons).toEqual([REASONS.head_unbound]);
  });

  it("refuses a malformed expected head before reading the input", async () => {
    const nonString = [42, null, ["f".repeat(40)]] as unknown as string[];
    for (const bad of ["F".repeat(40), "f".repeat(39), "", "HEAD", ...nonString]) {
      const res = await verify(golden(), jwks, { expected_head_sha: bad });
      expect(res.reasons).toEqual([REASONS.expected_head_malformed]);
      expect(res.statements).toEqual([]);
    }
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

  it("names a mis-typed bundle rather than treating it as one unknown statement", async () => {
    const res = await verify({ typ: "AAP-RecordBundle/v2", statements: [] }, jwks);
    expect(res.reasons).toEqual([REASONS.bundle_unknown_typ]);
    expect(res.statements).toEqual([]);
    // A bare statement with an unknown typ and no `statements` is still a statement.
    const one = await verify({ typ: "AAP-RecordBundle/v2" }, jwks);
    expect(one.reasons).toEqual([`0:${REASONS.unknown_typ}`]);
  });

  it("reports a non-string digest reference instead of skipping it", async () => {
    const digests = ["a".repeat(64), 7];
    const s = await signStatement({
      typ: "AAP-PRRecord/v1",
      signing_key_id: TEST_KID,
      conduct_digests: digests,
    });
    expect((await verifyStatement(s, jwks)).reasons).toEqual([REASONS.digest_malformed]);
    const notArray = await signStatement({
      typ: "AAP-PRRecord/v1",
      signing_key_id: TEST_KID,
      conduct_digests: "a".repeat(64),
    });
    expect((await verifyStatement(notArray, jwks)).reasons).toEqual([REASONS.digest_malformed]);
    const nullSource = await signStatement({
      typ: "AAP-ShareCard/v1",
      signing_key_id: TEST_KID,
      source_digest: null,
      lines: [],
    });
    expect((await verifyStatement(nullSource, jwks)).reasons).toEqual([REASONS.digest_malformed]);
    // `previous_digest: null` is the first build and stays valid.
    const first = await signStatement({
      typ: "AAP-ConductRecord/v1",
      signing_key_id: TEST_KID,
      previous_digest: null,
    });
    expect((await verifyStatement(first, jwks)).valid).toBe(true);
  });

  it("a checkpoint with card hash and signed commitment carries no flag", async () => {
    const s = fixture<{ checkpoints: unknown[] }>("golden-conduct");
    expect(s.checkpoints).toHaveLength(1);
    const res = await verifyStatement(s, jwks);
    expect(res.flags).toEqual([]);
  });
});

describe("key rotation: statements signed by a retired key", () => {
  const oldStatement = async () =>
    signStatement(
      { ...fixture<Record<string, unknown>>("golden-conduct"), signing_key_id: RETIRED_KID },
      RETIRED_PRIVATE_KEY_HEX,
    );

  it("verifies old-key and new-key statements against a JWKS holding both", async () => {
    const both: RecordJwks = { keys: [await retiredJwk(), await testJwk()] };
    const old = await verifyStatement(await oldStatement(), both);
    expect(old.reasons).toEqual([]);
    expect(old.valid).toBe(true);
    expect(old.signing_key_id).toBe(RETIRED_KID);
    const current = await verifyStatement(fixture("golden-conduct"), both);
    expect(current.valid).toBe(true);
    expect(current.signing_key_id).toBe(TEST_KID);
  });

  it("fails key_not_found once the retired key is dropped from the JWKS", async () => {
    const res = await verifyStatement(await oldStatement(), { keys: [await testJwk()] });
    expect(res.valid).toBe(false);
    expect(res.reasons).toEqual([REASONS.key_not_found]);
  });
});
