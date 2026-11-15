/**
 * A reference producer for `AAP-ConductRecord/v2` test statements, built the
 * way specs/aap-conductrecord-v2.md §3-§8 says the api builds one: the full
 * citation and act lists go in, the summaries come out. Unsigned; pass the
 * result to `signStatement`.
 */

import { protectionVerb, type Mode, type ProtectionVerdict } from "../../src/claim-table.js";
import { ACTS_SEED_HEX, CKPT_SEED_HEX, SUMMARY_TAIL_MAX, decisionRef, fold, groupActs, groupLineText } from "../../src/conduct-summary.js";
import type { ActTuple, CheckpointTuple } from "../../src/statements.js";
import { TEST_KID } from "./sign.js";

const H = (c: string) => c.repeat(64);

/** A bound, carded, unbound or uncarded citation, numbered `n`. */
export function citation(n: number, kind: "bound" | "no_card_hash" | "unbound" = "bound"): CheckpointTuple {
  const id = `ic-00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  if (kind === "unbound") {
    return { checkpoint_id: id, card_hash: H("c"), combined_commitment: null, commitment_signature: null, commitment_key_id: null };
  }
  return {
    checkpoint_id: id,
    card_hash: kind === "no_card_hash" ? null : H("c"),
    combined_commitment: "Y29tbWl0LQ" + String(n),
    commitment_signature: "c2ln" + "e".repeat(82),
    commitment_key_id: "aap-prod-2026-05-23",
  };
}

/** Citations 1..n: every seventh unbound, every fifth without a card hash. */
export function citations(n: number): CheckpointTuple[] {
  return Array.from({ length: n }, (_, i) =>
    citation(i + 1, (i + 1) % 7 === 0 ? "unbound" : (i + 1) % 5 === 0 ? "no_card_hash" : "bound"),
  );
}

/** A decision id numbered `n`, and its act tuple carrying `decision_id` as a lists file does. */
export function act(
  n: number,
  mode: Mode,
  verdict: ProtectionVerdict,
  tool: string | null,
  withheld = false,
): ActTuple & { decision_id: string } {
  const decision_id = `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  return {
    decision_id,
    decision_ref: decisionRef(decision_id),
    mode,
    tool_name: withheld ? null : tool,
    tool_withheld: withheld,
    verdict,
  };
}

/** The act tuple as it is folded: without `decision_id`. */
export function stripId(a: ActTuple & { decision_id?: string }): ActTuple {
  const { decision_id: _drop, ...t } = a;
  return t;
}

export interface V2Input {
  lineage_key: string;
  built_at: string;
  previous_digest: string | null;
  checkpoints: readonly CheckpointTuple[];
  acts: readonly (ActTuple & { decision_id?: string })[];
  /** Tail length; defaults to min(count, 32). */
  tail?: number;
}

/** Build the unsigned v2 statement for `input`. */
export function buildConductV2(input: V2Input): Record<string, unknown> {
  const list = input.checkpoints;
  const k = input.tail ?? Math.min(list.length, SUMMARY_TAIL_MAX);
  const head = list.slice(0, list.length - k);
  const tail = list.slice(list.length - k);
  const tail_from_digest = fold(CKPT_SEED_HEX, head);
  const tuples = input.acts.map(stripId);
  const groups = groupActs(tuples);
  const lists_as_of = new Date(Date.parse(input.built_at) - 5000).toISOString();
  // The v1 lines in v1 order (spec §8), with the api's wording.
  const lines: Record<string, unknown>[] = [
    { class: "measured", key: "cost.model", text: "model cost 530000 mmu" },
    { class: "measured", key: "cost.mu", text: "µ 21200 mmu" },
    { class: "measured", key: "goal.mode", text: "sealed contract" },
    { class: "measured", key: "goal.node", text: "Canon node mn-b2c3d4" },
    { class: "verdict", key: "goal.verdict", text: "3 of 4 judged turns on goal, 4 of 5 turns judged" },
  ];
  if (groups.by.length === 0 || groups.by.every((g) => g.mode === "off")) {
    lines.push({ class: "measured", key: "protection.mode", text: "not checked" });
  }
  groups.by.forEach((g, i) => {
    if (protectionVerb(g.mode, g.verdict) === null) return;
    lines.push({ class: "verdict", key: `protection.group.${i}`, text: groupLineText(g) });
  });
  lines.push(
    { class: "measured", key: "people.messages", text: "3 messages from a person" },
    { class: "measured", key: "context.compactions", text: "1 compactions" },
  );
  return {
    typ: "AAP-ConductRecord/v2",
    signing_key_id: TEST_KID,
    unit_kind: "conversation",
    org_id: "org-test0001",
    lineage_key: input.lineage_key,
    built_at: input.built_at,
    lists_as_of,
    previous_digest: input.previous_digest,
    goal: {
      mode: "sealed",
      contract_sha256: H("1"),
      seal_version: 1,
      seal_reason: null,
      previous_contract_sha256: null,
      canon_node_status: "written",
      canon_node_id: "mn-b2c3d4",
      on_goal: 3,
      judged: 4,
      turns: 5,
    },
    cost: {
      model_cost_mmu: "530000",
      mu_charged_mmu: "21200",
      mu_provisional_mmu: null,
      mu_status: "final",
      mu_rate_bps: 400,
      row_count: 12,
      as_of: input.built_at,
    },
    people: { messages_from_person: 3, compactions: 1 },
    protection: {
      acts_total: tuples.length,
      acts_digest: fold(ACTS_SEED_HEX, tuples),
      by: groups.by,
      tools_folded: groups.tools_folded,
      tool_names_withheld: groups.tool_names_withheld,
    },
    checkpoints: {
      count: list.length,
      bound_count: list.filter((c) => c.combined_commitment !== null && c.commitment_signature !== null).length,
      card_hash_count: list.filter((c) => c.card_hash !== null).length,
      digest: fold(tail_from_digest, tail),
      tail_from_digest,
      tail,
    },
    lines,
  };
}

/** The `AAP-RecordLists/v1` file for a v2 statement built from `input`. */
export function listsFor(statementDigest: string, statement: Record<string, unknown>, input: V2Input) {
  return {
    typ: "AAP-RecordLists/v1",
    statement_digest: statementDigest,
    lists_as_of: statement.lists_as_of,
    checkpoints: [...input.checkpoints],
    acts: [...input.acts],
  };
}
