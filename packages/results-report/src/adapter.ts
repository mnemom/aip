/**
 * Input adapter: the only module that knows what a signed outcome looks like.
 *
 * Two readers. `readOutcomes` reads signed `AAP-Outcome/v1` statements (the
 * verifier's golden shape) plus the fields the report needs, each ASSUMED here
 * and nowhere else; mnemom-api has no emitter of that statement yet.
 * `readRecordRows` reads what C3 (mnemom-api #4129) actually produces today:
 * the record app's unsigned outcome rows. Assumed fields of the first:
 *
 *   outcome       "<word>_no_revert" or "reverted" / "reverted_<word>"
 *   team_id       opaque team id (the only grouping the report ever shows)
 *   arm           "treatment" | "control"
 *   merged_by     "human" | "automation"; absent reads as automation
 *   estimate      optional estimator self-description (see estimateQualifies)
 *
 * Change this file only for input shapes; `build.ts` sees `Outcome`.
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
  /** Null for record-app rows, which carry no arm: they never enter a head-to-head. */
  arm: Arm | null;
  /** Display reference when there is no merge sha (record-app rows); `owner/repo#N`. */
  ref?: string;
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

/**
 * The record app's outcome rows, as the pilot report rebuilds from them
 * (mnemom-api src/org-scan/pilot-report-schema.ts `PilotSignedOutcome`, from
 * src/record/app-outcome.ts; mnemom-api #4129). This is the real C3 shape and
 * it differs from `AAP-Outcome/v1`:
 *
 *   repo, pr_number, team, merged_at, mu_charged_mmu
 *   merged_by_kind  "person" | "automation" | "unknown"
 *   status          "watching" | "reverted" | "settled"
 *
 * These rows carry NO signature, no arm and no estimate. So this reader is a
 * separate, explicit path: nothing here proves provenance (use `readOutcomes`
 * for that), no head-to-head is ever built from it, and `estimateQualifies`
 * always sees no estimate, so none is shown. A `watching` row has not
 * settled, so it is left out (never counted, never estimated). `unknown`
 * merger reads as automation, so "accepted" is never said of it (T15). The
 * identifiers read are repo and PR number only; no person or agent field is.
 */
const MERGED_BY_KINDS = ["person", "automation", "unknown"] as const;
const STATUSES = ["watching", "reverted", "settled"] as const;
const REPO_RE = /^[a-z0-9_.-]+\/[a-z0-9_.-]+$/i;

export function readRecordRows(input: unknown): Outcome[] {
  const list = isObject(input) && Array.isArray(input.rows) ? input.rows : input;
  if (!Array.isArray(list)) throw new Error("record rows input must be a list of rows or { rows }");
  const out: Outcome[] = [];
  const seen = new Set<string>();
  for (const [i, r] of list.entries()) {
    if (!isObject(r)) throw new Error(`row ${i} is not an object`);
    if (typeof r.repo !== "string" || !REPO_RE.test(r.repo)) throw new Error(`row ${i} has an invalid repo`);
    if (typeof r.pr_number !== "number" || !Number.isSafeInteger(r.pr_number) || r.pr_number <= 0) {
      throw new Error(`row ${i} has an invalid pr_number`);
    }
    if (typeof r.team !== "string" || r.team === "") throw new Error(`row ${i} has no team`);
    if (!MERGED_BY_KINDS.includes(r.merged_by_kind as never)) throw new Error(`row ${i} has unknown merged_by_kind`);
    if (!STATUSES.includes(r.status as never)) throw new Error(`row ${i} has unknown status`);
    const ref = `${r.repo}#${r.pr_number}`;
    if (seen.has(ref)) throw new Error(`row ${i} repeats ${ref}`);
    seen.add(ref);
    if (r.status === "watching") continue;
    out.push({
      digest: ref,
      ref,
      team: r.team,
      arm: null,
      merge_sha: typeof r.merge_commit_sha === "string" ? r.merge_commit_sha : "",
      reverted: r.status === "reverted",
      merged_by: r.merged_by_kind === "person" ? "human" : "automation",
      window_days: typeof r.window_seconds === "number" ? r.window_seconds / 86_400 : null,
      estimate: undefined,
    });
  }
  return out;
}
