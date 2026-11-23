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
import { MODES, PROTECTION_VERDICTS, type Mode, type ProtectionVerdict } from "../src/claim-table.js";
import {
  ACTS_SEED_HEX,
  ACTS_SEED_STRING,
  CKPT_SEED_HEX,
  CKPT_SEED_STRING,
  SUMMARY_GROUPS_MAX,
  SUMMARY_TAIL_MAX,
  V2_CEILING_BYTES,
  V2_MAX_BYTES,
  ConductListsCheck,
  conductSummaryReasons,
  decisionRef,
  actFromRow,
  citationFromRow,
  extensionFlags,
  fold,
  groupActCounts,
  groupActs,
  isActTuple,
  isCheckpointTuple,
  listsHeaderMismatch,
  listsMalformed,
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

describe("row normalisation (§4, shared with the api pgTAP tests)", () => {
  it("each stored checkpoint row gives the vector tuple, or fails the build", () => {
    expect(vectors.row_normalisation.checkpoints.length).toBeGreaterThan(10);
    for (const v of vectors.row_normalisation.checkpoints) {
      if (v.tuple === null) {
        expect(() => citationFromRow(v.row), v.name).toThrow(TypeError);
        continue;
      }
      const t = citationFromRow(v.row);
      expect(canonicalJson(t), v.name).toBe(v.tuple);
      expect(isCheckpointTuple(t), v.name).toBe(true);
    }
  });

  it("each stored decision row gives the vector tuple", () => {
    for (const v of vectors.row_normalisation.acts) {
      const t = actFromRow(v.row);
      expect(canonicalJson(t), v.name).toBe(v.tuple);
      expect(isActTuple(t), v.name).toBe(true);
    }
    expect(() => actFromRow({ id: "x", mode: "strict", verdict: "block", tool_name: null })).toThrow(TypeError);
  });
});

describe("grouping vectors (§7, shared with the api)", () => {
  it("groupActCounts gives each vector's expected rows", () => {
    for (const c of vectors.grouping.cases) {
      expect(groupActCounts(c.counts, c.withheld), c.name).toEqual(c.expect);
    }
  });

  it("groupActs over one act per count gives the same rows", () => {
    for (const c of vectors.grouping.cases) {
      let n = 0;
      const acts = c.counts.flatMap((r: { mode: Mode; verdict: ProtectionVerdict; tool_name: string | null; count: number }) =>
        Array.from({ length: r.count }, () => act(++n, r.mode, r.verdict, r.tool_name)),
      );
      // Withheld names are null-tool acts flagged withheld; mark that many of them.
      let w = c.withheld;
      for (const a of acts) {
        if (w === 0) break;
        if (a.tool_name === null) {
          a.tool_withheld = true;
          w--;
        }
      }
      expect(groupActs(acts), c.name).toEqual(c.expect);
    }
  });

  it("refuses counts outside the format", () => {
    expect(() => groupActCounts([{ mode: "enforce", verdict: "block", tool_name: "Bash", count: 0 }], 0)).toThrow(TypeError);
    expect(() => groupActCounts([{ mode: "enforce", verdict: "block", tool_name: "two words", count: 1 }], 0)).toThrow(TypeError);
    expect(() => groupActCounts([], -1)).toThrow(TypeError);
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
    expect(isActTuple({ ...a1, decision_id: "" }, true)).toBe(false);
    expect(isActTuple({ ...a1, decision_id: "d".repeat(256) }, true)).toBe(true);
    expect(isActTuple({ ...a1, decision_id: "d".repeat(257) }, true)).toBe(false);
    expect(isActTuple({ ...a1, decision_id: 7 }, true)).toBe(false);
    expect(isActTuple({ ...a1, decision_ref: a1.decision_ref.toUpperCase() })).toBe(false);
    expect(isActTuple({ ...a1, decision_ref: "ab" })).toBe(false);
    for (const junk of [null, "a", 1, [a1]]) expect(isActTuple(junk)).toBe(false);
    // Unbound with a key id, and a key id that is not an id.
    const t2 = vectors.checkpoint_tuples.t2 as CheckpointTuple;
    expect(isCheckpointTuple({ ...t2, commitment_key_id: "key-001" })).toBe(false);
    expect(isCheckpointTuple({ ...t1, commitment_key_id: "key 001" })).toBe(false);
    expect(isCheckpointTuple({ ...t1, commitment_key_id: null })).toBe(true);
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
    // Acts counted but the digest is the seed (the fold over no acts).
    expect(reasons((s) => (s.protection.acts_digest = ACTS_SEED_HEX))).toEqual(INC);
    // A tail longer than the count, within the 32 cap.
    const five = buildConductV2({ lineage_key: "l", built_at: "2026-11-14T10:00:00.000Z", previous_digest: null, checkpoints: citations(5), acts: [] }) as any;
    five.checkpoints.count = 4;
    expect(conductSummaryReasons(five)).toEqual(INC);
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

  it("accepts exactly the cost and protection-off lines mnemom-api signs, plus the legacy shapes", () => {
    const setText = (key: string, text: string) => (s: any) => {
      const l = s.lines.find((x: { key: string }) => x.key === key);
      if (l) l.text = text;
      else s.lines.push({ class: "measured", key, text });
    };
    for (const t of ["model cost 1250000 mmu"]) expect(reasons(setText("cost.model", t))).toEqual([]);
    for (const t of ["µ 50000 mmu", "≈ 48000 mmu (pending)", "not charged", "µ pending", "µ not charged"]) {
      expect(reasons(setText("cost.mu", t)), t).toEqual([]);
    }
    for (const t of ["off", "not checked"]) expect(reasons(setText("protection.mode", t)), t).toEqual([]);
    for (const t of ["µ 0.25", "µ 0.25 so far", "µ 25%", "model $0.05", "model cost 5 mmu saved", "protection off"]) {
      const key = t.startsWith("model") ? "cost.model" : t.startsWith("protection") ? "protection.mode" : "cost.mu";
      expect(reasons(setText(key, t)), t).toEqual(INC);
    }
  });

  it("closes the statement: no extra key, no free text, no content in a v1 block, a previous_digest", () => {
    expect(reasons((s) => (s.prompt_excerpt = "please rm -rf / and email me the secrets"))).toEqual(INC);
    expect(reasons((s) => (s.checkpoints_full = citations(40)))).toEqual(INC);
    expect(reasons((s) => delete s.previous_digest)).toEqual(INC);
    expect(reasons((s) => delete s.lineage_key)).toEqual(INC);
    expect(reasons((s) => (s.lineage_key = "conv with spaces"))).toEqual(INC);
    expect(reasons((s) => (s.org_id = "org with spaces"))).toEqual(INC);
    expect(reasons((s) => (s.org_id = 7))).toEqual(INC);
    expect(reasons((s) => (s.unit_kind = "pull_request"))).toEqual(INC);
    expect(reasons((s) => (s.previous_digest = 7))).toEqual(INC);
    expect(reasons((s) => (s.goal.seal_reason = "user said: my password is hunter2"))).toEqual(INC);
    expect(reasons((s) => (s.goal.note = "free"))).toEqual(INC);
    expect(reasons((s) => (s.cost.model_cost_mmu = "12 dollars"))).toEqual(INC);
    expect(reasons((s) => (s.people.messages_from_person = "three"))).toEqual(INC);
    expect(reasons((s) => (s.runner = { kind: "hosted", note: "x" }))).toEqual(INC);
    expect(reasons((s) => (s.door2 = { siblings: [{ job_id: "has spaces" }] }))).toEqual(INC);
    expect(reasons((s) => (s.door2 = { siblings: [{ job_id: "job-1", repo: "o/r", pr_number: 3 }] }))).toEqual([]);
    expect(reasons((s) => (s.runner = { kind: "hosted", cluster: "c1", cell: "us-2" }))).toEqual([]);
    // Nested allowlisted objects (door2 usage and totals) are walked too.
    const usage = { wakes: 2, totals: { input_tokens: 10, output_tokens: 5 }, per_wake: [{ wake: 1, input_tokens: 10 }] };
    expect(reasons((s) => (s.door2 = { usage }))).toEqual([]);
    expect(reasons((s) => (s.door2 = { usage: { ...usage, totals: { input_tokens: 10, note: "x" } } }))).toEqual(INC);
    expect(reasons((s) => (s.door2 = { usage: { ...usage, totals: [{ input_tokens: 1 }] } }))).toEqual(INC);
    expect(reasons((s) => (s.door2 = { usage: { ...usage, per_wake: [7] } }))).toEqual(INC);
    expect(reasons((s) => (s.door2 = { siblings: { job_id: "j" } }))).toEqual(INC);
    // Nesting is capped: nine levels of allowlisted objects fail.
    let deep: Record<string, unknown> = { input_tokens: 1 };
    for (let i = 0; i < 9; i++) deep = { usage: deep };
    expect(reasons((s) => (s.door2 = deep))).toEqual(INC);
    let shallow: Record<string, unknown> = { input_tokens: 1 };
    for (let i = 0; i < 3; i++) shallow = { usage: shallow };
    expect(reasons((s) => (s.door2 = shallow))).toEqual([]);
  });

  it("accepts goal.nudges as a count and nothing else (mnemom-api migration 679)", () => {
    expect(reasons((s) => (s.goal.nudges = 0))).toEqual([]);
    expect(reasons((s) => (s.goal.nudges = 3))).toEqual([]);
    expect(reasons((s) => (s.goal.nudges = "3"))).toEqual(INC);
    expect(reasons((s) => (s.goal.nudges = -1))).toEqual(INC);
    expect(reasons((s) => (s.goal.nudges = 1.5))).toEqual(INC);
    expect(reasons((s) => (s.goal.nudges = "nudged: stop editing the billing code"))).toEqual(INC);
  });

  describe("door2.context_receipt (mnemom-api ContextReceipt)", () => {
    const H = (c: string) => c.repeat(64);
    const receipt = () => ({
      context_status: "pinned",
      digest: H("e"),
      pinned_at: "2026-11-20T11:00:00.000Z",
      omitted: 2,
      nodes: [
        { node_id: "mn-aaaaaa", node_role: "canon", version: 3, sha256: H("1") },
        { node_id: "mn-cccccc", node_role: "contract", version: 1, sha256: H("b") },
      ],
    });
    const door2 = (r: unknown) => ({ session_id: "11111111-1111-4111-8111-111111111111", batch_id: null, reseals: [], siblings: [], context_receipt: r });

    it("accepts a well-formed receipt at every status the producer writes", () => {
      expect(reasons((s) => (s.door2 = door2(receipt())))).toEqual([]);
      for (const context_status of ["pinned", "none", "unavailable", "drifted"]) {
        expect(reasons((s) => (s.door2 = door2({ ...receipt(), context_status })))).toEqual([]);
      }
      expect(reasons((s) => (s.door2 = door2({ ...receipt(), context_status: "none", omitted: 0, nodes: [] })))).toEqual([]);
      expect(reasons((s) => (s.door2 = door2({ ...receipt(), pinned_at: "2026-11-20T11:00:00Z" })))).toEqual([]);
    });

    it("refuses a malformed receipt", () => {
      const bad = (edit: (r: any) => void) => {
        const r: any = receipt();
        edit(r);
        return reasons((s) => (s.door2 = door2(r)));
      };
      expect(bad((r) => (r.digest = "E".repeat(64)))).toEqual(INC);
      expect(bad((r) => (r.digest = H("e").slice(1)))).toEqual(INC);
      expect(bad((r) => (r.nodes[0].sha256 = "z".repeat(64)))).toEqual(INC);
      expect(bad((r) => (r.nodes[0].sha256 = `sha256:${H("1")}`))).toEqual(INC);
      expect(bad((r) => (r.context_status = "too_large"))).toEqual(INC);
      expect(bad((r) => (r.context_status = "user said: my password is hunter2"))).toEqual(INC);
      expect(bad((r) => (r.nodes[0].node_role = "rule"))).toEqual(INC);
      expect(bad((r) => (r.nodes[0].node_id = "mn-AAAAAA"))).toEqual(INC);
      expect(bad((r) => (r.nodes[0].node_id = "some free text"))).toEqual(INC);
      expect(bad((r) => (r.nodes[0].version = -1))).toEqual(INC);
      expect(bad((r) => (r.nodes[0].version = "3"))).toEqual(INC);
      expect(bad((r) => (r.omitted = 1.5))).toEqual(INC);
      expect(bad((r) => (r.pinned_at = "yesterday"))).toEqual(INC);
      // Extra keys carrying content, at either level, and missing or null fields.
      expect(bad((r) => (r.text = "the pinned node's text"))).toEqual(INC);
      expect(bad((r) => (r.nodes[0].text = "the pinned node's text"))).toEqual(INC);
      expect(bad((r) => (r.nodes[0].slug = "billing-rules"))).toEqual(INC);
      expect(bad((r) => delete r.digest)).toEqual(INC);
      expect(bad((r) => delete r.nodes[1].version)).toEqual(INC);
      expect(bad((r) => (r.digest = null))).toEqual(INC);
      expect(bad((r) => (r.nodes = { node_id: "mn-aaaaaa" }))).toEqual(INC);
      expect(bad((r) => (r.nodes = [7]))).toEqual(INC);
      expect(reasons((s) => (s.door2 = door2(null)))).toEqual(INC);
      expect(reasons((s) => (s.door2 = door2([receipt()])))).toEqual(INC);
    });

    it("keeps the receipt's keys out of every other block and the rest of door2", () => {
      expect(reasons((s) => (s.goal.context_receipt = receipt()))).toEqual(INC);
      expect(reasons((s) => (s.goal.digest = H("e")))).toEqual(INC);
      expect(reasons((s) => (s.runner = { kind: "hosted", sha256: H("1") }))).toEqual(INC);
      expect(reasons((s) => (s.door2 = { digest: H("e") }))).toEqual(INC);
      expect(reasons((s) => (s.door2 = { nodes: receipt().nodes }))).toEqual(INC);
      expect(reasons((s) => (s.door2 = { usage: { wakes: 1, context_receipt: receipt() } }))).toEqual(INC);
      // The rest of door2 is still held to the allowlist when a receipt is present.
      expect(reasons((s) => (s.door2 = { ...door2(receipt()), note: "free" }))).toEqual(INC);
      expect(reasons((s) => (s.door2 = { ...door2(receipt()), siblings: [{ job_id: "has spaces" }] }))).toEqual(INC);
    });

    it("leaves a v2 statement without a receipt unchanged", () => {
      expect(reasons((s) => (s.door2 = { siblings: [{ job_id: "job-1", repo: "o/r", pr_number: 3 }] }))).toEqual([]);
      expect(reasons(() => {})).toEqual([]);
    });
  });

  it("closes the lines: fixed wording, one line per line-bearing group, at most 72", () => {
    expect(reasons((s) => s.lines.push({ class: "measured", key: "x", text: "user said: my password is hunter2" }))).toEqual(INC);
    expect(reasons((s) => s.lines.push({ class: "measured", key: "people.note", text: "my password is hunter2" }))).toEqual(INC);
    expect(reasons((s) => (s.lines[0].text = "model cost 5 mmu, user said hi"))).toEqual(INC);
    expect(reasons((s) => (s.lines[0].extra = "x"))).toEqual(INC);
    expect(reasons((s) => s.lines.push({ ...s.lines[0] }))).toEqual(INC); // a key twice
    expect(reasons((s) => s.lines.push({ class: "verdict", key: `protection.group.${s.protection.by.length}`, text: "flagged" }))).toEqual(INC);
    expect(reasons((s) => (s.lines = s.lines.filter((l: { key: string }) => !l.key.startsWith("protection.group."))))).toEqual(INC);
    expect(
      reasons((s) => {
        for (let i = 0; i < 5000; i++) s.lines.push({ class: "verdict", key: `protection.group.${i}`, text: "flagged" });
      }),
    ).toEqual(INC);
    const g = base().lines.find((l: { key: string }) => l.key.startsWith("protection.group."));
    expect(reasons((s) => (s.lines.find((l: { key: string }) => l.key === g.key).text = "stopped Write"))).toEqual(INC);
  });

  it("closes protection.by: strictly in output order, folding only with a null row and 44 names", () => {
    expect(reasons((s) => s.protection.by.reverse())).toEqual(INC);
    // A duplicate key: the same act counted under two rows.
    const dup = buildConductV2({
      lineage_key: "l",
      built_at: "2026-11-14T10:00:00.000Z",
      previous_digest: null,
      checkpoints: [],
      acts: [act(1, "enforce", "block", "Bash"), act(2, "enforce", "block", "Bash")],
    }) as any;
    dup.protection.by = [
      { mode: "enforce", verdict: "block", tool_name: "Bash", count: 1 },
      { mode: "enforce", verdict: "block", tool_name: "Bash", count: 1 },
    ];
    dup.lines = dup.lines.filter((l: { key: string }) => !l.key.startsWith("protection.group."));
    dup.lines.splice(5, 0, { class: "verdict", key: "protection.group.0", text: "stopped Bash" }, { class: "verdict", key: "protection.group.1", text: "stopped Bash" });
    expect(conductSummaryReasons(dup)).toEqual(INC);
    // Folded tools with no null row, or with fewer than 44 named rows left.
    expect(reasons((s) => (s.protection.tools_folded = 1))).toEqual(INC);
    // Withheld names sit in a null row.
    const onlyNamed = buildConductV2({ lineage_key: "l", built_at: "2026-11-14T10:00:00.000Z", previous_digest: null, checkpoints: [], acts: [act(1, "enforce", "block", "Bash")] }) as any;
    onlyNamed.protection.tool_names_withheld = 1;
    expect(conductSummaryReasons(onlyNamed)).toEqual(INC);
  });

  it("a statement over the byte ceiling is inconsistent, whatever it holds", () => {
    expect(V2_CEILING_BYTES).toBe(2 * V2_MAX_BYTES);
    const big = reasons((s) => (s.door2 = { siblings: Array.from({ length: 3000 }, (_, i) => ({ job_id: `job-${"x".repeat(80)}-${i}` })) }));
    expect(big).toEqual(INC);
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
  const v1 = (n: number, list = citations(n)) => ({
    typ: "AAP-ConductRecord/v1",
    built_at: "2026-11-14T09:00:00.000Z",
    checkpoints: list,
  });
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

  it("says extension not checked when growth outran the tail, honest or rewritten alike", () => {
    // v1 had 3, v2 has 40 with a tail of 32: citations 4..8 are only in the digest.
    const notChecked = [{ flag: FLAGS.extension_not_checked, subject: D, count: 5 }];
    expect(extensionFlags(v1(3), v2(40), D)).toEqual(notChecked);
    const changed = citations(40).map((c, i) => (i === 0 ? citation(999) : c));
    expect(extensionFlags(v1(3), v2(40, changed), D)).toEqual(notChecked);
    // A full rewrite of a v2 predecessor's 40 citations by 200 others is not proven either.
    const other = Array.from({ length: 200 }, (_, i) => citation(1000 + i));
    expect(extensionFlags(v2(40), v2(200, other), D)).toEqual([{ flag: FLAGS.extension_not_checked, subject: D, count: 128 }]);
  });

  it("says extension not checked when the successor's cut-off is before the predecessor's", () => {
    const later = { ...v2(40), lists_as_of: "2026-11-14T10:00:10.000Z" };
    expect(extensionFlags(later, v2(30), D)).toEqual([{ flag: FLAGS.extension_not_checked, subject: D }]);
    // A v1 built at T can hold rows created in (T - 5 s, T] that a v2 built just after it lacks.
    const v1Late = { ...v1(41), built_at: "2026-11-14T09:59:58.000Z" };
    expect(extensionFlags(v1Late, v2(40), D)).toEqual([{ flag: FLAGS.extension_not_checked, subject: D }]);
  });

  it("checks a v1 successor of a v2 build (a writer rollback) against the v1's full list", () => {
    expect(extensionFlags(v2(5), v1(6), D)).toEqual([]);
    expect(extensionFlags(v2(40), v1(45), D)).toEqual([]);
    const changed = citations(45).map((c, i) => (i === 0 ? citation(999) : c));
    expect(extensionFlags(v2(40), v1(45, changed), D)).toEqual([{ flag: FLAGS.checkpoints_changed, subject: D }]);
    expect(extensionFlags(v2(40), v1(30), D)).toEqual([{ flag: FLAGS.checkpoints_removed, subject: D, count: 10 }]);
  });

  it("ignores a v1 -> v1 link and a malformed predecessor", () => {
    expect(extensionFlags(v1(5), v1(6), D)).toEqual([]);
    expect(extensionFlags({ typ: "AAP-ConductRecord/v1" }, v2(5), D)).toEqual([]);
    expect(extensionFlags(null, v2(5), D)).toEqual([]);
  });
});

/**
 * The digest-only lists check of one statement and one lists object (the
 * pieces `verify` wires together after the signature): the header, then each
 * supplied part through `ConductListsCheck`.
 */
function checkConductLists(statement: Record<string, unknown>, lists: any) {
  const fail = (part: string, mismatch: string) => ({ ok: false, part, mismatch });
  if (listsMalformed(lists)) return fail("statement", LISTS_MISMATCHES.list_malformed);
  if (lists.statement_digest !== statementDigest(statement)) return fail("statement", LISTS_MISMATCHES.statement_not_found);
  const header = listsHeaderMismatch(statement, lists);
  if (header !== null) return fail("statement", header);
  if (conductSummaryReasons(statement).length > 0) return fail("statement", LISTS_MISMATCHES.statement_invalid);
  const check = new ConductListsCheck(statement);
  if (lists.checkpoints !== undefined) check.addCheckpoints(lists.checkpoints);
  if (lists.acts !== undefined) check.addActs(lists.acts);
  for (const part of ["checkpoints", "acts"] as const) {
    if (!check.supplied(part)) continue;
    const m = check.result(part);
    if (m !== null) return fail(part, m);
  }
  return { ok: true };
}

describe("ConductListsCheck (§11.4)", () => {
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
    const asV1 = { ...statement, typ: "AAP-ConductRecord/v1" };
    expect(checkConductLists(asV1, { ...lists, statement_digest: statementDigest(asV1) })).toEqual(fail("statement", M.not_conduct_v2));
    expect(checkConductLists(statement, { ...lists, typ: "AAP-RecordLists/v2" })).toEqual(fail("statement", M.list_malformed));
    expect(checkConductLists(statement, { ...lists, checkpoints: [{ junk: 1 }] })).toEqual(fail("checkpoints", M.list_malformed));
    expect(checkConductLists(statement, { ...lists, acts: [{ junk: 1 }] })).toEqual(fail("acts", M.list_malformed));
    expect(checkConductLists(statement, { ...lists, acts: "not a list" })).toEqual(fail("acts", M.list_malformed));
    // A bad act page spoils the part even when a good page follows.
    const check = new ConductListsCheck(statement);
    check.addActs(7);
    check.addActs(lists.acts);
    expect(check.result("acts")).toBe(M.list_malformed);
  });

  it("folds pages fed one at a time exactly as the whole list", () => {
    for (const size of [1, 7, 45, 1000]) {
      const check = new ConductListsCheck(statement);
      for (let i = 0; i < lists.checkpoints.length; i += size) check.addCheckpoints(lists.checkpoints.slice(i, i + size));
      for (let i = 0; i < lists.acts.length; i += size) check.addActs(lists.acts.slice(i, i + size));
      expect(check.result("checkpoints")).toBeNull();
      expect(check.result("acts")).toBeNull();
    }
    // Pages out of order fold to another digest.
    const check = new ConductListsCheck(statement);
    check.addCheckpoints(lists.checkpoints.slice(10));
    check.addCheckpoints(lists.checkpoints.slice(0, 10));
    expect(check.result("checkpoints")).toBe(LISTS_MISMATCHES.tail_mismatch);
    expect(check.supplied("acts")).toBe(false);
  });

  it("recomputes the groups: a signed statement whose groups disagree with its acts fails groups_mismatch", () => {
    // A producer bug, not tampering: acts fold to the digest but were grouped wrongly.
    const s = JSON.parse(JSON.stringify(statement));
    s.protection.by = [{ mode: "enforce", verdict: "block", tool_name: null, count: 3 }];
    s.protection.tool_names_withheld = 1;
    s.lines = s.lines
      .filter((l: { key: string }) => !l.key.startsWith("protection.group."))
      .concat([{ class: "verdict", key: "protection.group.0", text: "stopped" }]);
    const l = { ...lists, statement_digest: statementDigest(s) };
    expect(conductSummaryReasons(s)).toEqual([]);
    expect(checkConductLists(s, l)).toEqual(fail("acts", LISTS_MISMATCHES.groups_mismatch));
  });
});
