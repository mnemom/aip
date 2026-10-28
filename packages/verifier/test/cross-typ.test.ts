import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { REASONS, STATEMENT_TYPES, type RecordJwks, type StatementTyp } from "../src/statements.js";
import { verifyStatement } from "../src/verify-record.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = <T = unknown>(name: string): T =>
  JSON.parse(readFileSync(resolve(here, "fixtures/record", `${name}.json`), "utf8")) as T;

const jwks = fixture<RecordJwks>("jwks");

// One validly signed statement per record typ (golden fixtures, signed with the test key).
const signed: Record<StatementTyp, Record<string, unknown>> = {
  "AAP-ConductRecord/v1": fixture("golden-conduct"),
  "AAP-PRRecord/v1": fixture("golden-pr-record"),
  "AAP-Outcome/v1": fixture("golden-outcome"),
  "AAP-ShareCard/v1": fixture("golden-share-card"),
};

const swaps = STATEMENT_TYPES.flatMap((from) =>
  STATEMENT_TYPES.filter((to) => to !== from).map((to) => [from, to] as const),
);

describe("cross-typ relabel: a signed statement never verifies under another record typ", () => {
  it("covers all 12 ordered typ pairs", () => expect(swaps).toHaveLength(12));

  it.each(STATEMENT_TYPES.map((t) => [t] as const))("control: the untouched %s verifies", async (typ) => {
    const res = await verifyStatement(signed[typ], jwks);
    expect(res.reasons).toEqual([]);
    expect(res.valid).toBe(true);
    expect(res.typ).toBe(typ);
  });

  it.each(swaps)("%s relabelled as %s is rejected with signature_invalid", async (from, to) => {
    const res = await verifyStatement({ ...signed[from], typ: to }, jwks);
    expect(res.valid).toBe(false);
    expect(res.reasons).toEqual([REASONS.signature_invalid]);
    expect(res.typ).toBe(to);
  });

  it("a ShareCard-typed statement is not accepted as a PRRecord", async () => {
    const res = await verifyStatement({ ...signed["AAP-ShareCard/v1"], typ: "AAP-PRRecord/v1" }, jwks);
    expect(res.valid).toBe(false);
    expect(res.reasons).toEqual([REASONS.signature_invalid]);
  });

  it("a PRRecord-typed statement is not accepted as a ShareCard", async () => {
    const res = await verifyStatement({ ...signed["AAP-PRRecord/v1"], typ: "AAP-ShareCard/v1" }, jwks);
    expect(res.valid).toBe(false);
    expect(res.reasons).toEqual([REASONS.signature_invalid]);
  });
});
