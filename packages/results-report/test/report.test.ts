import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { lintRendering } from "@mnemom/aip-verifier";

import { TEST_KID, signStatement, testJwks } from "../../verifier/test/helpers/sign.js";
import { readOutcomes, type Outcome } from "../src/adapter.js";
import { buildReport } from "../src/build.js";

const FIX = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");
const load = async (name: string) =>
  readOutcomes(JSON.parse(readFileSync(join(FIX, name, "outcomes.json"), "utf8")), JSON.parse(readFileSync(join(FIX, name, "jwks.json"), "utf8")));

describe("results report", () => {
  it("rebuilds byte for byte, in any input order", async () => {
    const os = await load("both-arms");
    const a = buildReport(os).markdown;
    expect(buildReport([...os].reverse()).markdown).toBe(a);
    expect(a).toBe(readFileSync(join(FIX, "both-arms", "report.md"), "utf8"));
  });

  it("lists reverts", async () => {
    const md = buildReport(await load("both-arms")).markdown;
    expect(md).toMatch(/team_beta: revert of merge cccccccccccc/);
  });

  it("shows head-to-head only when both arms ran", async () => {
    expect(buildReport(await load("both-arms")).markdown).toContain("## Head-to-head");
    expect(buildReport(await load("single-arm")).markdown).not.toContain("Head-to-head");
  });

  it("never says saved, and says accepted only of human merges", async () => {
    for (const c of ["both-arms", "single-arm"]) {
      const md = buildReport(await load(c)).markdown;
      expect(md).not.toMatch(/\bsaved\b/i);
    }
    const md = buildReport(await load("single-arm")).markdown;
    expect(md).not.toMatch(/accepted/i); // automation merges only
    expect(md).toContain("1 automation-merged with no revert");
  });

  it("shows an estimate only for a team whose outcomes all qualify", async () => {
    const md = buildReport(await load("both-arms")).markdown;
    expect(md).toContain("team_alpha: net lower-bound estimate 1500 mu");
    expect(md).not.toMatch(/team_beta: net lower-bound/);
    expect(buildReport(await load("single-arm")).markdown).not.toMatch(/estimate/i);
  });

  it("shows team totals only: no person or agent field is read", async () => {
    const jwks = await testJwks();
    const s = await signStatement({
      typ: "AAP-Outcome/v1", signing_key_id: TEST_KID, outcome: "accepted_no_revert", team_id: "team_x", arm: "treatment",
      merged_by: "human", merge_sha: "a".repeat(40), author_login: "someone-secret", agent_id: "agent-secret",
    });
    const md = buildReport(await readOutcomes([s], jwks)).markdown;
    expect(md).not.toMatch(/secret/);
  });

  it("passes claim-lint on every fixture report", async () => {
    for (const c of ["both-arms", "single-arm"]) {
      const { lines } = buildReport(await load(c));
      expect(lintRendering({ surface: "record_page", lines }).ok).toBe(true);
    }
  });

  it("claim-lint rejects a forbidden line the builder never writes", () => {
    const r = lintRendering({ surface: "record_page", lines: [{ class: "outcome", field: "outcome", text: "Costs saved this quarter" }] });
    expect(r.ok).toBe(false);
  });

  it("refuses to build from a tampered outcome", async () => {
    const jwks = await testJwks();
    const raw = JSON.parse(readFileSync(join(FIX, "both-arms", "outcomes.json"), "utf8"));
    raw[0].outcome = "reverted";
    await expect(readOutcomes(raw, jwks)).rejects.toThrow(/signature_invalid/);
  });

  it("refuses unknown outcome words and missing team or arm", async () => {
    const jwks = await testJwks();
    const base = { typ: "AAP-Outcome/v1", signing_key_id: TEST_KID, team_id: "t", arm: "treatment", outcome: "accepted_no_revert" };
    for (const bad of [{ outcome: "mystery" }, { team_id: "" }, { arm: "other" }]) {
      await expect(readOutcomes([await signStatement({ ...base, ...bad })], jwks)).rejects.toThrow();
    }
  });

  it("an empty set builds a report that says so", () => {
    const md = buildReport([] as Outcome[]).markdown;
    expect(md).toContain("No outcomes recorded.");
    expect(md).toContain("No reverts recorded.");
  });
});
