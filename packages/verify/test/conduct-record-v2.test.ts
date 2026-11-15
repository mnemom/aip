/**
 * `verify` on AAP-ConductRecord/v2 statements and bundles
 * (specs/aap-conductrecord-v2.md §9, §11): the golden v1 -> v2 -> v2 chain,
 * links across the typ change in both directions, the extension flags, and
 * the opt-in lists check.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { CKPT_SEED_HEX } from "../src/conduct-summary.js";
import { BUNDLE_TYP, FLAGS, LISTS_MISMATCHES, REASONS, type RecordJwks, type RecordLists } from "../src/statements.js";
import { checkConductLists, statementDigest, verify, verifyStatement } from "../src/verify-record.js";
import type { TamperedListsCase } from "./helpers/build-fixtures.js";
import { act, buildConductV2, citation, citations, listsFor } from "./helpers/conduct-v2.js";
import { signStatement } from "./helpers/sign.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = <T = any>(name: string): T =>
  JSON.parse(readFileSync(resolve(here, "fixtures/record", `${name}.json`), "utf8")) as T;

const jwks = fixture<RecordJwks>("jwks");
const golden = () => fixture<{ typ: string; statements: Record<string, any>[] }>("golden-bundle-v1-v2");
const verdicts = fixture("golden-verdicts").conduct_v2;
const goldenLists = fixture<{ lists: RecordLists; tampered: TamperedListsCase[] }>("golden-lists-v2");

describe("AAP-ConductRecord/v2: golden fixtures", () => {
  it("the golden v2 statement verifies on its own, with the summary flags", async () => {
    const s = fixture("golden-conduct-v2");
    const res = await verifyStatement(s, jwks);
    expect(res.reasons).toEqual([]);
    expect(res.valid).toBe(true);
    expect(res.typ).toBe("AAP-ConductRecord/v2");
    expect(res.digest).toBe(verdicts.digests.v2b);
    expect(res.flags).toEqual([
      { flag: FLAGS.summarized, subject: res.digest, count: 13 },
      { flag: FLAGS.card_hash_not_recorded, subject: s.checkpoints.digest, count: 8 },
      { flag: FLAGS.card_not_bound, subject: s.checkpoints.digest, count: 6 },
    ]);
  });

  it("the golden v2 statement stays bounded: its summary carries 32 citations of 45", () => {
    const s = fixture("golden-conduct-v2");
    expect(s.checkpoints.count).toBe(45);
    expect(s.checkpoints.tail).toHaveLength(32);
    expect(s.checkpoints.tail_from_digest).not.toBe(CKPT_SEED_HEX);
    expect(Buffer.byteLength(JSON.stringify(s))).toBeLessThan(131072);
  });

  it("verifies the v1 -> v2 -> v2 bundle with the committed flags and no extension flag", async () => {
    const res = await verify(golden(), jwks);
    expect(res.reasons).toEqual([]);
    expect(res.valid).toBe(true);
    expect(res.statements.map((s) => s.typ)).toEqual([
      "AAP-ConductRecord/v1",
      "AAP-ConductRecord/v2",
      "AAP-ConductRecord/v2",
    ]);
    expect(res.flags).toEqual(verdicts.bundle.flags);
    expect(res.statements.map((s) => s.digest)).toEqual([verdicts.digests.v1, verdicts.digests.v2a, verdicts.digests.v2b]);
    expect(res.lists_checked).toBeUndefined();
  });

  it("v1 bytes and verdicts are unchanged: the v1 golden bundle still verifies as before", async () => {
    const res = await verify(fixture("golden-bundle"), jwks);
    expect(res.valid).toBe(true);
    expect(res.flags).toEqual(fixture("golden-verdicts").bundle.flags);
    expect(res.flags.every((f) => f.count === undefined)).toBe(true);
  });
});

describe("AAP-ConductRecord/v2: chain across typs (§9)", () => {
  const lineage = "conv_" + "e".repeat(32);
  const v2At = (built_at: string, previous_digest: string | null, n: number) =>
    signStatement(buildConductV2({ lineage_key: lineage, built_at, previous_digest, checkpoints: citations(n), acts: [] }));
  const v1At = (built_at: string, previous_digest: string | null, n: number) =>
    signStatement({
      typ: "AAP-ConductRecord/v1",
      signing_key_id: golden().statements[0]!.signing_key_id,
      built_at,
      previous_digest,
      unit_kind: "conversation",
      lineage_key: lineage,
      checkpoints: citations(n),
    });

  it("a v2 -> v1 link is valid (a writer rollback), with no reason and no flag of its own", async () => {
    const a = await v2At("2026-11-14T10:00:00.000Z", null, 40);
    const b = await v1At("2026-11-14T11:00:00.000Z", statementDigest(a), 41);
    const res = await verify({ typ: BUNDLE_TYP, statements: [a, b] }, jwks);
    expect(res.reasons).toEqual([]);
    expect(res.valid).toBe(true);
    expect(res.flags.map((f) => f.flag)).not.toContain(FLAGS.checkpoints_changed);
  });

  it("a v2 fork and a second v2 genesis in one lineage are chain_broken", async () => {
    expect((await verify(fixture<any[]>("tampered").find((c) => c.name === "v2-chain-fork")!.input, jwks)).reasons).toEqual([
      `2:${REASONS.chain_broken}`,
    ]);
    const a = await v1At("2026-11-14T09:00:00.000Z", null, 3);
    const b = await v2At("2026-11-14T10:00:00.000Z", null, 40);
    expect((await verify({ typ: BUNDLE_TYP, statements: [a, b] }, jwks)).reasons).toEqual([`1:${REASONS.chain_broken}`]);
  });

  it("a v2 whose first build names an absent predecessor is lineage truncated, as v1", async () => {
    const b = golden();
    const res = await verify({ ...b, statements: b.statements.slice(1) }, jwks);
    expect(res.valid).toBe(true);
    expect(res.flags).toContainEqual({ flag: FLAGS.lineage_truncated, subject: b.statements[1]!.previous_digest });
  });

  it("a PR record and a share card may link a v2 conduct record", async () => {
    const b = golden();
    const v2b = b.statements[2]!;
    const pr = await signStatement({
      typ: "AAP-PRRecord/v1",
      signing_key_id: v2b.signing_key_id,
      built_at: "2026-11-14T12:00:00.000Z",
      previous_digest: null,
      unit_kind: "pull_request",
      conduct_digests: [statementDigest(v2b)],
      head_sha: "f".repeat(40),
      commits: { bound: 1, total: 1 },
    });
    const card = await signStatement({
      typ: "AAP-ShareCard/v1",
      signing_key_id: v2b.signing_key_id,
      built_at: "2026-11-14T12:30:00.000Z",
      source_digest: statementDigest(v2b),
      lines: [{ class: "measured", text: "45 checkpoints" }],
    });
    const res = await verify({ ...b, statements: [...b.statements, pr, card] }, jwks);
    expect(res.reasons).toEqual([]);
    expect(res.valid).toBe(true);
    expect(res.flags.map((f) => f.flag)).not.toContain(FLAGS.linked_statement_not_in_bundle);
  });
});

describe("AAP-ConductRecord/v2: extension check in a bundle (§11.3)", () => {
  it("flags a v2 build whose citations do not extend the build before it", async () => {
    const b = golden();
    const [v1, v2a] = b.statements;
    // The new build rewrites citation 36: inside its tail and among the 40 v2a signed.
    const changed = citations(45).map((c, i) => (i === 35 ? citation(999) : c));
    const v2bChanged = await signStatement(
      buildConductV2({
        lineage_key: v2a!.lineage_key,
        built_at: "2026-11-14T11:00:00.000Z",
        previous_digest: statementDigest(v2a!),
        checkpoints: changed,
        acts: [],
      }),
    );
    const res = await verify({ ...b, statements: [v1!, v2a!, v2bChanged] }, jwks);
    expect(res.valid).toBe(true);
    expect(res.flags).toContainEqual({ flag: FLAGS.checkpoints_changed, subject: statementDigest(v2bChanged) });
  });

  it("flags a v2 build that cites fewer checkpoints than the build before it", async () => {
    const b = golden();
    const [v1, v2a] = b.statements;
    const shrunk = await signStatement(
      buildConductV2({
        lineage_key: v2a!.lineage_key,
        built_at: "2026-11-14T11:00:00.000Z",
        previous_digest: statementDigest(v2a!),
        checkpoints: citations(38),
        acts: [],
      }),
    );
    const res = await verify({ ...b, statements: [v1!, v2a!, shrunk] }, jwks);
    expect(res.valid).toBe(true);
    expect(res.flags).toContainEqual({ flag: FLAGS.checkpoints_removed, subject: statementDigest(shrunk), count: 2 });
  });

  it("skips the check against an invalid predecessor", async () => {
    const b = golden();
    const bad = { ...b.statements[1]!, signature: "A".repeat(86) };
    const res = await verify({ ...b, statements: [b.statements[0]!, bad, b.statements[2]!] }, jwks);
    expect(res.valid).toBe(false);
    expect(res.flags.map((f) => f.flag)).not.toContain(FLAGS.checkpoints_changed);
  });
});

describe("AAP-ConductRecord/v2: per-statement checks", () => {
  it("an invalid v2 statement carries no flags", async () => {
    const c = fixture<any[]>("tampered").find((t) => t.name === "v2-group-count")!;
    const res = await verifyStatement(c.input, jwks);
    expect(res.reasons).toEqual([REASONS.summary_inconsistent]);
    expect(res.flags).toEqual([]);
  });

  it("digest_malformed on a summary digest is reported once", async () => {
    const c = fixture<any[]>("tampered").find((t) => t.name === "v2-acts-digest-malformed")!;
    const res = await verifyStatement(c.input, jwks);
    expect(res.reasons).toEqual([REASONS.digest_malformed]);
  });

  it("a v2 statement with no acts and no checkpoints verifies", async () => {
    const s = await signStatement(
      buildConductV2({ lineage_key: "l", built_at: "2026-11-14T10:00:00.000Z", previous_digest: null, checkpoints: [], acts: [] }),
    );
    const res = await verifyStatement(s, jwks);
    expect(res.reasons).toEqual([]);
    expect(res.flags).toEqual([{ flag: FLAGS.summarized, subject: res.digest, count: 0 }]);
  });

  it("the signature still covers everything: an unsigned edit is signature_invalid, not a summary reason", async () => {
    const s = fixture("golden-conduct-v2");
    const res = await verifyStatement({ ...s, checkpoints: { ...s.checkpoints, count: 46 } }, jwks);
    expect(res.reasons).toEqual([REASONS.signature_invalid]);
  });
});

describe("AAP-ConductRecord/v2: lists check (§11.4)", () => {
  it("the golden lists fold to the golden statement's digests", async () => {
    const res = await verify(golden(), jwks, { lists: goldenLists.lists });
    expect(res.reasons).toEqual([]);
    expect(res.valid).toBe(true);
    expect(res.lists_checked).toEqual([
      { statement_digest: verdicts.digests.v2b, part: "checkpoints", ok: true },
      { statement_digest: verdicts.digests.v2b, part: "acts", ok: true },
    ]);
    // The bare statement path takes lists too.
    const bare = await verify(fixture("golden-conduct-v2"), jwks, { lists: [goldenLists.lists] });
    expect(bare.valid).toBe(true);
    expect(bare.lists_checked).toHaveLength(2);
  });

  it.each(goldenLists.tampered.map((c) => [c.name, c] as const))("%s fails summary_list_mismatch", async (_n, c) => {
    const res = await verify(golden(), jwks, { lists: c.lists as RecordLists });
    expect(res.valid).toBe(false);
    expect(res.reasons).toEqual([REASONS.summary_list_mismatch]);
    expect(res.lists_checked).toContainEqual({
      statement_digest: verdicts.digests.v2b,
      part: c.part,
      ok: false,
      mismatch: c.mismatch,
    });
  });

  it("a lists file for a statement not in the input, or an invalid one, is a mismatch", async () => {
    const missing = { ...goldenLists.lists, statement_digest: "0".repeat(64) };
    const res = await verify(golden(), jwks, { lists: missing });
    expect(res.reasons).toEqual([REASONS.summary_list_mismatch]);
    expect(res.lists_checked).toEqual([
      { statement_digest: "0".repeat(64), part: "statement", ok: false, mismatch: LISTS_MISMATCHES.statement_not_found },
    ]);
    const b = golden();
    b.statements[2] = { ...b.statements[2]!, signature: "A".repeat(86) };
    const invalid = await verify(b, jwks, { lists: goldenLists.lists });
    expect(invalid.lists_checked).toEqual([
      { statement_digest: verdicts.digests.v2b, part: "statement", ok: false, mismatch: LISTS_MISMATCHES.statement_invalid },
    ]);
  });

  it("checks a v1 bundle's lists file as not_conduct_v2", async () => {
    const v1 = golden().statements[0]!;
    const res = await verify(golden(), jwks, { lists: { ...goldenLists.lists, statement_digest: statementDigest(v1) } });
    expect(res.lists_checked).toEqual([
      { statement_digest: statementDigest(v1), part: "statement", ok: false, mismatch: LISTS_MISMATCHES.not_conduct_v2 },
    ]);
  });

  it("acts lists recompute the groups the statement signed", async () => {
    const acts = [act(1, "enforce", "block", "Bash"), act(2, "enforce", "block", "Bash"), act(3, "nudge", "nudge", null)];
    const s = await signStatement(
      buildConductV2({ lineage_key: "l", built_at: "2026-11-14T10:00:00.000Z", previous_digest: null, checkpoints: [], acts }),
    );
    const lists = { typ: "AAP-RecordLists/v1" as const, statement_digest: statementDigest(s), lists_as_of: s.lists_as_of as string, acts };
    const res = await verify(s, jwks, { lists });
    expect(res.valid).toBe(true);
    // Only the acts were supplied: the checkpoints are reported as not supplied, not as checked.
    expect(res.lists_checked).toEqual([
      { statement_digest: statementDigest(s), part: "checkpoints", ok: false, not_supplied: true },
      { statement_digest: statementDigest(s), part: "acts", ok: true },
    ]);
    expect(res.reasons).not.toContain(REASONS.summary_list_mismatch);
  });

  it("checkConductLists proves counts only for a statement that verifies, and only with both lists", async () => {
    const input = {
      lineage_key: "l",
      built_at: "2026-11-14T10:00:00.000Z",
      previous_digest: null,
      checkpoints: citations(50),
      acts: [act(1, "enforce", "block", "Bash"), act(2, "observe", "warn", null)],
    };
    const unsigned = buildConductV2(input);
    const s = await signStatement(unsigned);
    const lists = listsFor(statementDigest(s), s, input) as RecordLists;
    expect(await checkConductLists(s, lists, jwks)).toEqual({ ok: true });
    // A fabricated statement and lists that agree with each other prove nothing.
    const fake = listsFor(statementDigest(unsigned), unsigned, input) as RecordLists;
    expect(await checkConductLists(unsigned, fake, jwks)).toEqual({
      ok: false,
      part: "statement",
      mismatch: LISTS_MISMATCHES.statement_invalid,
    });
    const { acts: _a, ...onlyCheckpoints } = lists;
    expect(await checkConductLists(s, onlyCheckpoints as RecordLists, jwks)).toEqual({ ok: false, part: "acts", not_supplied: true });
    // Through verify(): a page that is not an object, names no statement, or is not a lists object.
    const res = await verify(s, jwks, {
      lists: [7, { acts: [] }, { ...lists, typ: "AAP-RecordLists/v2" }, { ...lists, lists_as_of: undefined }] as unknown as RecordLists[],
    });
    expect(res.reasons).toContain(REASONS.summary_list_mismatch);
    expect(res.lists_checked).toEqual([
      { statement_digest: "", part: "statement", ok: false, mismatch: LISTS_MISMATCHES.list_malformed },
      { statement_digest: "", part: "statement", ok: false, mismatch: LISTS_MISMATCHES.list_malformed },
      { statement_digest: statementDigest(s), part: "statement", ok: false, mismatch: LISTS_MISMATCHES.list_malformed },
      { statement_digest: statementDigest(s), part: "statement", ok: false, mismatch: LISTS_MISMATCHES.list_malformed },
    ]);
    // No lists at all: not supplied, not malformed.
    expect(await checkConductLists(s, undefined, jwks)).toEqual({ ok: false, part: "checkpoints", not_supplied: true });
    expect(await checkConductLists(s, [], jwks)).toEqual({ ok: false, part: "checkpoints", not_supplied: true });
    // Pages naming the same statement continue its lists.
    const pages = [
      { ...lists, checkpoints: lists.checkpoints!.slice(0, 20), acts: undefined },
      { ...lists, checkpoints: lists.checkpoints!.slice(20), acts: lists.acts },
    ].map((p) => JSON.parse(JSON.stringify(p)));
    expect(await checkConductLists(s, pages, jwks)).toEqual({ ok: true });
    async function* gen() {
      for (const p of pages) yield p;
    }
    expect(await checkConductLists(s, gen(), jwks)).toEqual({ ok: true });
  });
});
