/**
 * AAP-ConductRecord/v2 summaries (specs/aap-conductrecord-v2.md): the fold,
 * decision refs, grouping and the lists check, against the shared vectors in
 * schemas/aap-conductrecord-v2.vectors.json.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { canonicalJson, statementDigest } from "../src/canonical.js";
import { MODES, PROTECTION_VERDICTS } from "../src/claim-table.js";
import {
  ACTS_SEED_HEX,
  ACTS_SEED_STRING,
  CKPT_SEED_HEX,
  CKPT_SEED_STRING,
  SUMMARY_GROUPS_MAX,
  SUMMARY_TAIL_MAX,
  checkConductLists,
  conductSummaryReasons,
  decisionRef,
  extensionFlags,
  fold,
  groupActs,
  isActTuple,
  isCheckpointTuple,
} from "../src/conduct-summary.js";
import { FLAGS, LISTS_MISMATCHES, REASONS, type ActTuple, type CheckpointTuple } from "../src/statements.js";
import { act, buildConductV2, citation, citations, listsFor, stripId } from "./helpers/conduct-v2.js";

const here = dirname(fileURLToPath(import.meta.url));
const schemas = resolve(here, "..", "..", "..", "schemas");
const vectors = JSON.parse(readFileSync(resolve(schemas, "aap-conductrecord-v2.vectors.json"), "utf8"));
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

describe("seeds and vectors (§5)", () => {
  it("each seed is the SHA-256 of its string", () => {
    expect(sha(CKPT_SEED_STRING)).toBe(CKPT_SEED_HEX);
    expect(sha(ACTS_SEED_STRING)).toBe(ACTS_SEED_HEX);
    expect(vectors.seeds.checkpoints).toEqual({ string: CKPT_SEED_STRING, sha256: CKPT_SEED_HEX });
    expect(vectors.seeds.acts).toEqual({ string: ACTS_SEED_STRING, sha256: ACTS_SEED_HEX });
  });

  it("pins the spec's checkpoint fold values", () => {
    const { t1, t2, t3 } = vectors.checkpoint_tuples;
    expect(fold(CKPT_SEED_HEX, [t1])).toBe("671303fab4db2d8aa733d92564d080a8486c02d374dbfdb8318296f1d8b5f4a6");
    expect(fold(CKPT_SEED_HEX, [t1, t2, t3])).toBe("2d38faed1001ad9359a4700129e419255175858f0d57716ff84a4f648e59ed32");
    expect(fold(fold(CKPT_SEED_HEX, [t1]), [t2, t3])).toBe(fold(CKPT_SEED_HEX, [t1, t2, t3]));
    expect(fold(CKPT_SEED_HEX, [])).toBe(CKPT_SEED_HEX);
  });

  it("matches every fold in the vectors file", () => {
    const resolveFrom = (from: string, seed: string, items: Record<string, unknown>) =>
      from === "seed" ? seed : fold(seed, [items[/\[(\w+)\]/.exec(from)![1]!]]);
    for (const f of vectors.checkpoint_folds) {
      const items = f.items.map((k: string) => vectors.checkpoint_tuples[k]);
      expect(fold(resolveFrom(f.from, CKPT_SEED_HEX, vectors.checkpoint_tuples), items)).toBe(f.result);
    }
    for (const f of vectors.act_folds) {
      const items = f.items.map((k: string) => vectors.act_tuples[k]);
      expect(fold(ACTS_SEED_HEX, items)).toBe(f.result);
    }
    // The act fold includes the tool_withheld key (the spec's pre-key value is not normative).
    expect(vectors.act_folds[0].result).toBe("b3fca034e59964185d75141b39c11f9133b31c48712baa932e9306c25ac98439");
  });

  it("canonical tuple bytes are exactly the §4 templates", () => {
    expect(canonicalJson(vectors.checkpoint_tuples.t2)).toBe(
      '{"card_hash":null,"checkpoint_id":"ic-00000000-0000-4000-8000-000000000002","combined_commitment":null,"commitment_key_id":null,"commitment_signature":null}',
    );
    expect(canonicalJson(vectors.checkpoint_tuples.t1)).toBe(vectors.checkpoint_tuple_canonical.t1);
    expect(canonicalJson(vectors.act_tuples.a1)).toBe(
      '{"decision_ref":"6699a3dfa4f36d42c83041bf2631208c431b6acef26617ec7cc694d63132a200","mode":"enforce","tool_name":"Bash","tool_withheld":false,"verdict":"block"}',
    );
    expect(canonicalJson(vectors.act_tuples.a3)).toBe(vectors.act_tuple_canonical.a3);
  });

  it("splits at every k: fold(fold(seed, head), tail) is fold(seed, all)", () => {
    const list = citations(40);
    const whole = fold(CKPT_SEED_HEX, list);
    for (let k = 0; k <= list.length; k++) {
      expect(fold(fold(CKPT_SEED_HEX, list.slice(0, k)), list.slice(k))).toBe(whole);
    }
  });

  it("refuses a starting state that is not 64 lowercase hex", () => {
    expect(() => fold(CKPT_SEED_HEX.toUpperCase(), [])).toThrow(TypeError);
    expect(() => fold("00", [])).toThrow(TypeError);
  });
});

describe("decisionRef (§4)", () => {
  it("hashes the prefix and the lowercased id", () => {
    for (const r of vectors.decision_refs.refs) expect(decisionRef(r.id)).toBe(r.decision_ref);
    expect(decisionRef("00000000-0000-4000-8000-000000000001")).toBe(
      "6699a3dfa4f36d42c83041bf2631208c431b6acef26617ec7cc694d63132a200",
    );
    expect(decisionRef("00000000-0000-4000-8000-000000000002")).toBe(
      "e4dd51cca034337eca15c8e5bb09706f59de3524fc395442c9897426735ccd85",
    );
    expect(decisionRef("x")).toBe(sha("AAP-DecisionRef/v1\nx"));
  });
});

describe("tuple shapes", () => {
  it("accepts the vector tuples and rejects extra keys and free text", () => {
    for (const t of Object.values(vectors.checkpoint_tuples)) expect(isCheckpointTuple(t)).toBe(true);
    for (const a of Object.values(vectors.act_tuples)) expect(isActTuple(a)).toBe(true);
    const t1 = vectors.checkpoint_tuples.t1 as CheckpointTuple;
    expect(isCheckpointTuple({ ...t1, note: "hi" })).toBe(false);
    expect(isCheckpointTuple({ ...t1, checkpoint_id: "has spaces in it" })).toBe(false);
    expect(isCheckpointTuple({ ...t1, combined_commitment: null })).toBe(false); // half bound
    expect(isCheckpointTuple({ ...t1, card_hash: "A".repeat(64) })).toBe(false);
    const a1 = vectors.act_tuples.a1 as ActTuple;
    expect(isActTuple({ ...a1, tool_name: "rm -rf /" })).toBe(false);
    expect(isActTuple({ ...a1, tool_withheld: true })).toBe(false); // withheld but named
    expect(isActTuple({ ...a1, verdict: "flagged" })).toBe(false);
    expect(isActTuple({ ...a1, decision_id: "x" })).toBe(false);
    expect(isActTuple({ ...a1, decision_id: "x" }, true)).toBe(true);
  });
});

describe("groupActs (§7)", () => {
  it("groups at most 64 keys one row per key, in mode, verdict, tool order", () => {
    const acts = [
      act(1, "enforce", "block", "Bash"),
      act(2, "enforce", "block", "Bash"),
      act(3, "observe", "warn", null),
      act(4, "enforce", "block", "Agent"),
      act(5, "off", "pass", null),
      act(6, "enforce", "block", null, true),
    ];
    const g = groupActs(acts);
    expect(g.by).toEqual([
      { mode: "off", verdict: "pass", tool_name: null, count: 1 },
      { mode: "observe", verdict: "warn", tool_name: null, count: 1 },
      { mode: "enforce", verdict: "block", tool_name: null, count: 1 },
      { mode: "enforce", verdict: "block", tool_name: "Agent", count: 1 },
      { mode: "enforce", verdict: "block", tool_name: "Bash", count: 2 },
    ]);
    expect(g.tools_folded).toBe(0);
    expect(g.tool_names_withheld).toBe(1);
    expect(groupActs([])).toEqual({ by: [], tools_folded: 0, tool_names_withheld: 0 });
  });

  it("orders tool names by code point, as COLLATE \"C\"", () => {
    const g = groupActs([act(1, "enforce", "block", "b"), act(2, "enforce", "block", "B"), act(3, "enforce", "block", "_")]);
    expect(g.by.map((r) => r.tool_name)).toEqual(["B", "_", "b"]);
  });

  it("over 64 keys keeps 44 named rows, line-bearing and largest first, and folds the rest", () => {
    const acts: ReturnType<typeof act>[] = [];
    let n = 0;
    // 70 named keys that bear a line (enforce/block), tool T00..T69, Tnn used nn+1 times.
    for (let t = 0; t < 70; t++) {
      for (let c = 0; c <= t; c++) acts.push(act(++n, "enforce", "block", `T${String(t).padStart(2, "0")}`));
    }
    // 5 named keys with no line (observe/pass), each used 1000 times: big but not line-bearing.
    for (let t = 0; t < 5; t++) for (let c = 0; c < 1000; c++) acts.push(act(++n, "observe", "pass", `P${t}`));
    const g = groupActs(acts);
    expect(g.by.length).toBeLessThanOrEqual(SUMMARY_GROUPS_MAX);
    const named = g.by.filter((r) => r.tool_name !== null);
    expect(named).toHaveLength(44);
    // The 44 kept are T26..T69 (the largest line-bearing); the observe/pass rows fold.
    expect(named.map((r) => r.tool_name)).toEqual(Array.from({ length: 44 }, (_, i) => `T${i + 26}`));
    const enforceNull = g.by.find((r) => r.mode === "enforce" && r.tool_name === null)!;
    expect(enforceNull.count).toBe((26 * 27) / 2); // T00..T25
    const observeNull = g.by.find((r) => r.mode === "observe" && r.tool_name === null)!;
    expect(observeNull.count).toBe(5000);
    expect(g.tools_folded).toBe((26 * 27) / 2 + 5000);
    expect(g.by.reduce((s, r) => s + r.count, 0)).toBe(acts.length);
  });

  it("breaks count ties by mode, verdict, then tool name", () => {
    const acts: ReturnType<typeof act>[] = [];
    let n = 0;
    for (let t = 0; t < 70; t++) acts.push(act(++n, "enforce", "block", `Z${String(69 - t).padStart(2, "0")}`));
    const g = groupActs(acts);
    expect(g.by.filter((r) => r.tool_name !== null).map((r) => r.tool_name)).toEqual(
      Array.from({ length: 44 }, (_, i) => `Z${String(i).padStart(2, "0")}`),
    );
    expect(g.tools_folded).toBe(26);
  });

  it("keeps the enums in step with the schema", () => {
    const schema = JSON.parse(readFileSync(resolve(schemas, "aap-conductrecord-v2.schema.json"), "utf8"));
    const by = schema.properties.protection.properties.by;
    expect(by.maxItems).toBe(SUMMARY_GROUPS_MAX);
    expect(by.items.properties.mode.enum).toEqual([...MODES]);
    expect(by.items.properties.verdict.enum).toEqual([...PROTECTION_VERDICTS]);
    expect(schema.properties.checkpoints.properties.tail.maxItems).toBe(SUMMARY_TAIL_MAX);
  });
});

describe("conductSummaryReasons (§11.1)", () => {
  const base = () =>
    buildConductV2({
      lineage_key: "conv_x",
      built_at: "2026-11-14T10:00:00.000Z",
      previous_digest: null,
      checkpoints: citations(40),
      acts: [act(1, "enforce", "block", "Bash"), act(2, "observe", "warn", null), act(3, "enforce", "block", null, true)],
    }) as any;
  const reasons = (edit: (s: any) => void) => {
    const s = base();
    edit(s);
    return conductSummaryReasons(s);
  };
  const INC = [REASONS.summary_inconsistent];

  it("passes a statement built by the reference producer, at every tail length", () => {
    expect(conductSummaryReasons(base())).toEqual([]);
    for (const n of [0, 1, 31, 32, 33, 100]) {
      for (const tail of [0, Math.min(n, 1), Math.min(n, 32)]) {
        const s = buildConductV2({
          lineage_key: "l",
          built_at: "2026-11-14T10:00:00.000Z",
          previous_digest: null,
          checkpoints: citations(n),
          acts: [],
          tail,
        });
        expect(conductSummaryReasons(s), `n=${n} tail=${tail}`).toEqual([]);
      }
    }
  });

  it("each broken rule is summary_inconsistent", () => {
    expect(reasons((s) => (s.protection.by[0].count += 1))).toEqual(INC);
    expect(reasons((s) => (s.protection.tools_folded = s.protection.acts_total))).toEqual(INC);
    expect(reasons((s) => (s.protection = { acts_total: 0, acts_digest: "0".repeat(64), by: [], tools_folded: 0, tool_names_withheld: 0 }))).toEqual(INC);
    expect(reasons((s) => (s.checkpoints.bound_count = s.checkpoints.count + 1))).toEqual(INC);
    expect(reasons((s) => (s.checkpoints.card_hash_count = s.checkpoints.count + 1))).toEqual(INC);
    // More bound citations in the tail than bound_count allows.
    expect(reasons((s) => (s.checkpoints.bound_count = 3))).toEqual(INC);
    expect(reasons((s) => (s.checkpoints.tail_from_digest = CKPT_SEED_HEX))).toEqual(INC);
    expect(reasons((s) => (s.checkpoints.tail[5].checkpoint_id = "ic-other"))).toEqual(INC);
    expect(reasons((s) => (s.lists_as_of = "2026-11-14T10:00:00.001Z"))).toEqual(INC);
    expect(reasons((s) => (s.lists_as_of = "2026-11-14T10:00:00Z"))).toEqual(INC);
    expect(reasons((s) => (s.checkpoints.tail[0].extra = "text"))).toEqual(INC);
    expect(reasons((s) => (s.protection.note = "free text"))).toEqual(INC);
    expect(reasons((s) => (s.protection.by[0].tool_name = "two words"))).toEqual(INC);
    expect(reasons((s) => (s.checkpoints.count = 1.5))).toEqual(INC);
    expect(reasons((s) => delete s.checkpoints)).toEqual(INC);
    expect(reasons((s) => (s.protection = []))).toEqual(INC);
  });

  it("a full tail with a non-seed fold before it, or a seed with a partial tail, is inconsistent", () => {
    const small = buildConductV2({ lineage_key: "l", built_at: "2026-11-14T10:00:00.000Z", previous_digest: null, checkpoints: citations(5), acts: [] }) as any;
    expect(conductSummaryReasons(small)).toEqual([]);
    expect(conductSummaryReasons({ ...small, checkpoints: { ...small.checkpoints, count: 6 } })).toEqual(INC);
    expect(conductSummaryReasons({ ...small, checkpoints: { ...small.checkpoints, tail_from_digest: "1".repeat(64) } })).toEqual(INC);
  });

  it("the over-bound tail and group list are inconsistent", () => {
    const over = buildConductV2({ lineage_key: "l", built_at: "2026-11-14T10:00:00.000Z", previous_digest: null, checkpoints: citations(40), acts: [], tail: 33 });
    expect(conductSummaryReasons(over)).toEqual(INC);
    const s = base();
    s.protection.by = Array.from({ length: 65 }, (_, i) => ({ mode: "observe", verdict: "warn", tool_name: `t${i}`, count: 1 }));
    s.protection.acts_total = 65;
    expect(conductSummaryReasons(s)).toEqual(INC);
  });

  it("a malformed summary digest is digest_malformed", () => {
    expect(reasons((s) => (s.protection.acts_digest = s.protection.acts_digest.toUpperCase()))).toEqual([REASONS.digest_malformed]);
    expect(reasons((s) => (s.checkpoints.digest = "nope"))).toEqual([REASONS.digest_malformed]);
    expect(reasons((s) => (s.checkpoints.tail_from_digest = 7))).toContain(REASONS.digest_malformed);
  });

  it("never throws on junk", () => {
    for (const junk of [null, 1, "s", [], {}, { protection: null, checkpoints: { tail: "x" } }]) {
      expect(() => conductSummaryReasons(junk)).not.toThrow();
      expect(conductSummaryReasons(junk)).toContain(REASONS.summary_inconsistent);
    }
  });
});

describe("extensionFlags (§11.3)", () => {
  const v2 = (n: number, list = citations(n)) =>
    buildConductV2({ lineage_key: "l", built_at: "2026-11-14T10:00:00.000Z", previous_digest: null, checkpoints: list, acts: [] });
  const v1 = (n: number) => ({ typ: "AAP-ConductRecord/v1", checkpoints: citations(n) });
  const D = "f".repeat(64);

  it("proves v1 -> v2 and v2 -> v2 when the predecessor ends inside the tail", () => {
    expect(extensionFlags(v1(10), v2(40), D)).toEqual([]);
    expect(extensionFlags(v2(40), v2(45), D)).toEqual([]);
    expect(extensionFlags(v2(40), v2(40), D)).toEqual([]);
    expect(extensionFlags(v1(0), v2(5), D)).toEqual([]);
  });

  it("flags a changed citation and a shrunk list", () => {
    const changed = citations(45).map((c, i) => (i === 35 ? citation(999) : c));
    expect(extensionFlags(v2(40), v2(45, changed), D)).toEqual([{ flag: FLAGS.checkpoints_changed, subject: D }]);
    expect(extensionFlags(v2(45), v2(40), D)).toEqual([{ flag: FLAGS.checkpoints_removed, subject: D, count: 5 }]);
    const changedEarly = citations(40).map((c, i) => (i === 9 ? citation(999) : c));
    expect(extensionFlags(v1(10), v2(40, changedEarly), D)).toEqual([{ flag: FLAGS.checkpoints_changed, subject: D }]);
  });

  it("does not check when growth outran the tail", () => {
    // v1 had 3, v2 has 40 with a tail of 32: the first 8 are only in the digest.
    expect(extensionFlags(v1(3), v2(40), D)).toEqual([]);
    const changed = citations(40).map((c, i) => (i === 0 ? citation(999) : c));
    expect(extensionFlags(v1(3), v2(40, changed), D)).toEqual([]);
  });

  it("ignores a non-v2 successor and a malformed predecessor", () => {
    expect(extensionFlags(v2(5), v1(6), D)).toEqual([]);
    expect(extensionFlags({ typ: "AAP-ConductRecord/v1" }, v2(5), D)).toEqual([]);
    expect(extensionFlags(null, v2(5), D)).toEqual([]);
  });
});

describe("checkConductLists (§11.4)", () => {
  const input = {
    lineage_key: "l",
    built_at: "2026-11-14T10:00:00.000Z",
    previous_digest: null,
    checkpoints: citations(45),
    acts: [act(1, "enforce", "block", "Bash"), act(2, "observe", "warn", null), act(3, "enforce", "block", null, true)],
  };
  const statement = buildConductV2(input);
  const digest = statementDigest(statement);
  const lists = listsFor(digest, statement, input);
  const fail = (part: string, mismatch: string) => ({ ok: false, part, mismatch });

  it("accepts the producer's own lists, with or without decision ids, each part alone", () => {
    expect(checkConductLists(statement, lists)).toEqual({ ok: true });
    expect(checkConductLists(statement, { ...lists, acts: lists.acts.map(stripId) })).toEqual({ ok: true });
    const { acts: _a, ...onlyCheckpoints } = lists;
    expect(checkConductLists(statement, onlyCheckpoints)).toEqual({ ok: true });
    const { checkpoints: _c, ...onlyActs } = lists;
    expect(checkConductLists(statement, onlyActs)).toEqual({ ok: true });
  });

  it("names every mismatch", () => {
    const M = LISTS_MISMATCHES;
    expect(checkConductLists(statement, { ...lists, checkpoints: lists.checkpoints.slice(1) })).toEqual(fail("checkpoints", M.count_mismatch));
    expect(
      checkConductLists(statement, { ...lists, checkpoints: lists.checkpoints.map((c, i) => (i === 0 ? citation(1, "unbound") : c)) }),
    ).toEqual(fail("checkpoints", M.binding_count_mismatch));
    expect(
      checkConductLists(statement, { ...lists, checkpoints: lists.checkpoints.map((c, i) => (i === 44 ? { ...c, commitment_key_id: "k2" } : c)) }),
    ).toEqual(fail("checkpoints", M.tail_mismatch));
    expect(
      checkConductLists(statement, { ...lists, checkpoints: lists.checkpoints.map((c, i) => (i === 2 ? { ...c, commitment_key_id: "k2" } : c)) }),
    ).toEqual(fail("checkpoints", M.digest_mismatch));
    expect(checkConductLists(statement, { ...lists, acts: lists.acts.slice(1) })).toEqual(fail("acts", M.count_mismatch));
    expect(
      checkConductLists(statement, { ...lists, acts: lists.acts.map((a, i) => (i === 0 ? { ...a, decision_id: "other" } : a)) }),
    ).toEqual(fail("acts", M.decision_ref_mismatch));
    expect(
      checkConductLists(statement, { ...lists, acts: lists.acts.map((a, i) => (i === 0 ? { ...a, verdict: "quarantine" } : a)) }),
    ).toEqual(fail("acts", M.digest_mismatch));
    expect(checkConductLists(statement, { ...lists, lists_as_of: "2026-11-14T09:00:00.000Z" })).toEqual(fail("statement", M.as_of_mismatch));
    expect(checkConductLists(statement, { ...lists, statement_digest: "0".repeat(64) })).toEqual(fail("statement", M.statement_not_found));
    expect(checkConductLists({ ...statement, typ: "AAP-ConductRecord/v1" }, lists)).toEqual(fail("statement", M.not_conduct_v2));
    expect(checkConductLists(statement, { ...lists, typ: "AAP-RecordLists/v2" })).toEqual(fail("statement", M.list_malformed));
    expect(checkConductLists(statement, { ...lists, checkpoints: [{ junk: 1 }] })).toEqual(fail("checkpoints", M.list_malformed));
  });

  it("recomputes the groups: a signed statement whose groups disagree with its acts fails groups_mismatch", () => {
    // A producer bug, not tampering: acts fold to the digest but were grouped wrongly.
    const s = JSON.parse(JSON.stringify(statement));
    s.protection.by = [{ mode: "enforce", verdict: "block", tool_name: null, count: 3 }];
    s.protection.tool_names_withheld = 1;
    const l = { ...lists, statement_digest: statementDigest(s) };
    expect(conductSummaryReasons(s)).toEqual([]);
    expect(checkConductLists(s, l)).toEqual(fail("acts", LISTS_MISMATCHES.groups_mismatch));
  });
});
