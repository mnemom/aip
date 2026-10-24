/**
 * Builds the golden fixtures under fixtures/<case>/ from the test signer, and
 * fails when the committed files drift. `npm run fixtures` rewrites them.
 * Signing is deterministic, so the build is reproducible byte for byte.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { TEST_KID, signStatement, testJwks } from "../../verifier/test/helpers/sign.js";
import { readOutcomes } from "../src/adapter.js";
import { buildReport } from "../src/build.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");
const H = (c: string) => c.repeat(64);
const QUALIFYING = (n: number) => ({
  method: "lower_bound",
  counting_floor_tokens: 200000,
  net_of_mu: true,
  reports_loss: true,
  net_lower_bound: n,
});

async function outcome(o: Record<string, unknown>) {
  return signStatement({
    typ: "AAP-Outcome/v1",
    signing_key_id: TEST_KID,
    built_at: "2026-11-30T19:00:00.000Z",
    unit_kind: "pull_request",
    window_days: 7,
    ...o,
  });
}

async function buildCases(): Promise<Record<string, unknown[]>> {
  const both = [
    await outcome({ pr_record_digest: H("1"), merge_sha: H("a"), outcome: "accepted_no_revert", team_id: "team_alpha", arm: "treatment", merged_by: "human", estimate: QUALIFYING(1200) }),
    await outcome({ pr_record_digest: H("2"), merge_sha: H("b"), outcome: "accepted_no_revert", team_id: "team_alpha", arm: "treatment", merged_by: "automation", estimate: QUALIFYING(300) }),
    await outcome({ pr_record_digest: H("3"), merge_sha: H("c"), outcome: "reverted", team_id: "team_beta", arm: "treatment", merged_by: "human" }),
    await outcome({ pr_record_digest: H("4"), merge_sha: H("d"), outcome: "accepted_no_revert", team_id: "team_beta", arm: "control", merged_by: "automation", estimate: { method: "median", counting_floor_tokens: 60000, net_of_mu: false, reports_loss: false } }),
    await outcome({ pr_record_digest: H("5"), merge_sha: H("e"), outcome: "accepted_no_revert", team_id: "team_alpha", arm: "control", merged_by: "human", estimate: QUALIFYING(0) }),
  ];
  const single = [
    await outcome({ pr_record_digest: H("6"), merge_sha: H("f"), outcome: "accepted_no_revert", team_id: "team_alpha", arm: "treatment", merged_by: "automation" }),
    await outcome({ pr_record_digest: H("7"), merge_sha: H("9"), outcome: "reverted", team_id: "team_alpha", arm: "treatment", merged_by: "automation" }),
  ];
  return { "both-arms": both, "single-arm": single };
}

const json = (v: unknown) => JSON.stringify(v, null, 2) + "\n";

describe("golden fixtures", async () => {
  const cases = await buildCases();
  const jwks = await testJwks();
  for (const [name, statements] of Object.entries(cases)) {
    it(`${name} matches the committed files`, async () => {
      const report = buildReport(await readOutcomes(statements, jwks)).markdown;
      const files: Record<string, string> = { "outcomes.json": json(statements), "jwks.json": json(jwks), "report.md": report };
      for (const [file, content] of Object.entries(files)) {
        const path = join(ROOT, name, file);
        if (process.env.RESULTS_FIXTURES === "write") {
          mkdirSync(join(ROOT, name), { recursive: true });
          writeFileSync(path, content);
        } else {
          expect(existsSync(path), `${path} missing; run npm run fixtures`).toBe(true);
          expect(readFileSync(path, "utf8")).toBe(content);
        }
      }
    });
  }
});
