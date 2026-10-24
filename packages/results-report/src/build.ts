/**
 * Report builder: a pure function from verified outcomes to markdown.
 *
 * Deterministic by construction: no clock, no randomness, no environment,
 * stable sorting, LF line endings and one trailing newline, so a rebuild from
 * the same signed outcomes is byte for byte the same file.
 *
 * Claim rules, enforced here and again by claim-lint over every line:
 *   - team totals only (no person or agent figure is ever read)
 *   - reverts are listed
 *   - head-to-head only when both arms ran
 *   - an estimate only when `estimateQualifies`, never on a card or PR comment
 *   - "accepted" is never said of an automation merge
 *   - the word "saved" never appears
 */

import { estimateQualifies, lintRendering, type RenderedLine } from "@mnemom/aip-verifier";
import type { Outcome } from "./adapter.js";

interface Tally {
  human_kept: number;
  automation_kept: number;
  reverted: number;
}

const FORBIDDEN_REPORT_WORD = /\bsaved\b/i;

function tally(os: Outcome[]): Tally {
  const t: Tally = { human_kept: 0, automation_kept: 0, reverted: 0 };
  for (const o of os) {
    if (o.reverted) t.reverted += 1;
    else if (o.merged_by === "human") t.human_kept += 1;
    else t.automation_kept += 1;
  }
  return t;
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** One line per tally; "accepted" only for merges a person made. */
function tallyText(t: Tally): string {
  const total = t.human_kept + t.automation_kept + t.reverted;
  const parts = [plural(total, "PR", "PRs")];
  // A kind with none is left out, so "accepted" never appears without a human merge behind it.
  if (t.human_kept > 0) parts.push(`${t.human_kept} human-merged and accepted with no revert`);
  if (t.automation_kept > 0) parts.push(`${t.automation_kept} automation-merged with no revert`);
  parts.push(plural(t.reverted, "revert", "reverts"));
  return parts.join(", ");
}

function short(s: string): string {
  return s.slice(0, 12);
}

const by = <T>(f: (x: T) => string) => (a: T, b: T) => (f(a) < f(b) ? -1 : f(a) > f(b) ? 1 : 0);

export interface Report {
  markdown: string;
  lines: RenderedLine[];
}

export function buildReport(outcomes: Outcome[]): Report {
  const lines: RenderedLine[] = [];
  const md: string[] = ["# D90 results report", ""];
  const section = (title: string) => md.push(`## ${title}`, "");
  const line = (cls: string, field: string, text: string) => {
    lines.push({ class: cls, field, text });
    md.push(`- ${text}`);
  };

  const all = [...outcomes].sort(by((o) => o.digest));
  const teams = [...new Set(all.map((o) => o.team))].sort();

  section("Team totals");
  if (teams.length === 0) line("outcome", "outcome", "No outcomes recorded.");
  for (const team of teams) {
    line("outcome", "outcome", `${team}: ${tallyText(tally(all.filter((o) => o.team === team)))}`);
  }
  md.push("");

  section("Reverts");
  const reverts = all.filter((o) => o.reverted).sort(by((o) => `${o.team}\u0000${o.digest}`));
  if (reverts.length === 0) line("outcome", "outcome", "No reverts recorded.");
  for (const o of reverts) {
    line("outcome", "outcome", `${o.team}: revert of merge ${short(o.merge_sha)} (outcome ${short(o.digest)})`);
  }
  md.push("");

  const arm = (a: Outcome["arm"]) => all.filter((o) => o.arm === a);
  if (arm("treatment").length > 0 && arm("control").length > 0) {
    section("Head-to-head");
    line("outcome", "outcome", `Treatment arm: ${tallyText(tally(arm("treatment")))}`);
    line("outcome", "outcome", `Control arm: ${tallyText(tally(arm("control")))}`);
    md.push("");
  }

  // Estimate: per team, only when every outcome of the team carries an
  // estimate that qualifies. One that does not keeps the whole team's out.
  const estimateLines: string[] = [];
  for (const team of teams) {
    const mine = all.filter((o) => o.team === team);
    const quals = mine.map((o) => estimateQualifies(o.estimate).qualifies);
    if (mine.length === 0 || !quals.every(Boolean)) continue;
    const sum = mine.reduce((n, o) => n + ((o.estimate as { net_lower_bound: number }).net_lower_bound ?? 0), 0);
    estimateLines.push(`${team}: net lower-bound estimate ${sum} mu`);
  }
  if (estimateLines.length > 0) {
    section("Estimate");
    for (const t of estimateLines) line("estimate", "savings_estimate", t);
    md.push("");
  }

  while (md[md.length - 1] === "") md.pop();
  const markdown = md.join("\n") + "\n";

  if (FORBIDDEN_REPORT_WORD.test(markdown)) throw new Error('report contains the word "saved"');
  const lint = lintRendering({ surface: "record_page", lines });
  if (!lint.ok) {
    throw new Error("claim-lint failed: " + lint.violations.map((v) => `${v.rule}@${v.line}`).join(", "));
  }
  return { markdown, lines };
}
