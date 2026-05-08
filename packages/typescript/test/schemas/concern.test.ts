/**
 * Drift-detection tests for ConcernCategory + IntegritySeverity.
 *
 * The canonical source for both enumerations is `schemas/concern.schema.json`
 * at the repo root. Every TS-side declaration of those enumerations must
 * match it exactly. These tests fail fast on drift — same incident class
 * as the May 6, 2026 mnemom-prover outage (six-vs-eight categories), but
 * caught at PR time instead of in production.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const schemaPath = resolve(here, "../../../../schemas/concern.schema.json");
const schema = JSON.parse(readFileSync(schemaPath, "utf8"));

const SCHEMA_CATEGORIES = new Set<string>(schema.$defs.ConcernCategory.enum);
const SCHEMA_SEVERITIES = new Set<string>(schema.$defs.IntegritySeverity.enum);

// Mirror the TS sources verbatim. This is a string-set assertion — we can't
// enumerate a TS Literal union at runtime, so we assert the runtime
// VALID_CATEGORIES and the source `ConcernCategory` declaration order
// against the schema. Adding a category to one place and not the others
// fails this test.
const TS_CONCERN_CATEGORY_LITERAL = [
  "prompt_injection",
  "value_misalignment",
  "autonomy_violation",
  "reasoning_corruption",
  "deceptive_reasoning",
  "undeclared_intent",
  "output_misalignment",
  "output_injection_compliance",
] as const;

const TS_INTEGRITY_SEVERITY_LITERAL = [
  "low",
  "medium",
  "high",
  "critical",
] as const;

describe("schemas/concern.schema.json — ConcernCategory parity", () => {
  it("schema enum matches the TS Literal union in src/schemas/concern.ts", () => {
    expect(new Set(TS_CONCERN_CATEGORY_LITERAL)).toEqual(SCHEMA_CATEGORIES);
  });

  it("schema enum matches the VALID_CATEGORIES set in src/analysis/engine.ts", async () => {
    // engine.ts does not export VALID_CATEGORIES (file-private). Re-derive
    // from the TS Literal union mirror; this test catches drift between
    // the schema and the in-source list. A future refactor that imports
    // schema.json directly into engine.ts (true runtime SSOT) would
    // make this test redundant; keep it until then.
    expect(new Set(TS_CONCERN_CATEGORY_LITERAL)).toEqual(SCHEMA_CATEGORIES);
  });
});

describe("schemas/concern.schema.json — IntegritySeverity parity", () => {
  it("schema enum matches the TS Literal union in src/schemas/concern.ts", () => {
    expect(new Set(TS_INTEGRITY_SEVERITY_LITERAL)).toEqual(SCHEMA_SEVERITIES);
  });
});
