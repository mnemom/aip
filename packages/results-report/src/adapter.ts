/**
 * Input adapter: the only module that knows what a signed outcome looks like.
 *
 * C3 (signed outcomes) has not shipped. Until it does this adapter reads the
 * `AAP-Outcome/v1` shape in the verifier's golden fixture plus the fields the
 * report needs, each ASSUMED here and nowhere else:
 *
 *   outcome       "<word>_no_revert" or "reverted" / "reverted_<word>"
 *   team_id       opaque team id (the only grouping the report ever shows)
 *   arm           "treatment" | "control"
 *   merged_by     "human" | "automation"; absent reads as automation
 *   estimate      optional estimator self-description (see estimateQualifies)
 *
 * When C3 lands, change this file only; `build.ts` sees `Outcome`.
 *
 * Every statement is verified against the JWKS first. One failed signature
 * throws: a report is never built from data it cannot prove. Person and agent
 * identifiers are never read, so the report cannot show them.
 */

import { verifyStatement, type RecordJwks } from "@mnemom/aip-verifier";

export type Arm = "treatment" | "control";

export interface Outcome {
  digest: string;
  team: string;
  arm: Arm;
  merge_sha: string;
  reverted: boolean;
  merged_by: "human" | "automation";
  window_days: number | null;
  estimate: unknown;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export async function readOutcomes(input: unknown, jwks: RecordJwks): Promise<Outcome[]> {
  const list = isObject(input) && Array.isArray(input.statements) ? input.statements : input;
  if (!Array.isArray(list)) throw new Error("outcomes input must be a list of statements or a bundle");
  const out: Outcome[] = [];
  const seen = new Set<string>();
  for (const [i, s] of list.entries()) {
    const v = await verifyStatement(s, jwks);
    if (!v.valid || v.digest === null) throw new Error(`outcome ${i} failed verification: ${v.reasons.join(",")}`);
    if (v.typ !== "AAP-Outcome/v1") throw new Error(`outcome ${i} is ${v.typ}, not AAP-Outcome/v1`);
    if (seen.has(v.digest)) throw new Error(`outcome ${i} repeats digest ${v.digest}`);
    seen.add(v.digest);
    const st = s as Record<string, unknown>;
    const word = st.outcome;
    if (typeof word !== "string") throw new Error(`outcome ${i} has no outcome field`);
    let reverted: boolean;
    if (word === "reverted" || word.startsWith("reverted_")) reverted = true;
    else if (word.endsWith("_no_revert")) reverted = false;
    else throw new Error(`outcome ${i} has unknown outcome "${word}"`);
    if (typeof st.team_id !== "string" || st.team_id === "") throw new Error(`outcome ${i} has no team_id`);
    if (st.arm !== "treatment" && st.arm !== "control") throw new Error(`outcome ${i} has unknown arm`);
    out.push({
      digest: v.digest,
      team: st.team_id,
      arm: st.arm,
      merge_sha: typeof st.merge_sha === "string" ? st.merge_sha : "",
      reverted,
      merged_by: st.merged_by === "human" ? "human" : "automation",
      window_days: typeof st.window_days === "number" ? st.window_days : null,
      estimate: st.estimate,
    });
  }
  return out;
}
