// K1.17: claim-lint over golden renderings produced by the real record builder.
//
// The fixture is copied byte for byte from mnemom-api (private), captured by K-L04 from
// src/record/claims.ts and src/record/builder.ts. aip CI cannot read mnemom-api, so the copy is
// pinned here by source commit and sha256; any hand edit to the fixture fails the first test.
// When claims.ts changes, mnemom-api's own test fails and the regenerated file comes back here
// with a new pin in the same PR.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { lintRendering, LINT_RULES, type Rendering } from "../src/claim-lint.js";

const SOURCE = {
  repo: "mnemom/mnemom-api",
  pr: 4096,
  commit: "b82269b0810a79e174caaca91d8671bd5202de2a",
  path: "src/__tests__/fixtures/record-claims/golden-renderings.json",
  sha256: "d60c3824aef2981f75fed256856d564306e67d33a6641cd58c6f87fc3969b21b",
} as const;

const here = dirname(fileURLToPath(import.meta.url));
const raw = readFileSync(join(here, "fixtures", "record", "golden-renderings.json"));
const fixture = JSON.parse(raw.toString("utf8")) as { source: string; renderings: (Rendering & { id: string })[] };

describe("golden renderings from the record builder (K1.17)", () => {
  it("fixture is the pinned copy from mnemom-api", () => {
    expect(createHash("sha256").update(raw).digest("hex")).toBe(SOURCE.sha256);
    expect(fixture.renderings.length).toBe(14);
  });

  it.each(fixture.renderings.map((r) => [r.id, r] as const))("%s passes claim-lint on its own surface", (_id, r) => {
    expect(lintRendering(r).violations).toEqual([]);
  });

  it("every rendering lints clean as a set", () => {
    const failing = fixture.renderings.filter((r) => !lintRendering(r).ok).map((r) => r.id);
    expect(failing).toEqual([]);
  });

  // Negative control: the same lines on a card must fail, so a lint that passes everything
  // cannot turn K1.17 green.
  it("the pending µ line fails on a share card (A-S-001)", () => {
    const pending = fixture.renderings.find((r) => r.id === "table.cost.pending");
    expect(pending).toBeDefined();
    const rules = lintRendering({ ...pending!, surface: "share_card" }).violations.map((v) => v.rule);
    expect(rules).toContain(LINT_RULES.provisional_mu_on_card);
  });
});
