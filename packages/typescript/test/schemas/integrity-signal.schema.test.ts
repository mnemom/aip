/**
 * Canonical JSON schema parity tests for integrity-signal.schema.json.
 *
 * Validates that every TypeScript-side enumeration and required-field set
 * declared for IntegritySignal, WindowSummary, and its verdicts object matches
 * the canonical schema at schemas/integrity-signal.schema.json.
 * These tests fail fast on drift — catching schema/implementation divergence at
 * PR time rather than in production.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import type { RecommendedAction } from "../../src/schemas/signal.js";

const here = dirname(fileURLToPath(import.meta.url));
const schemaPath = resolve(here, "../../../../schemas/integrity-signal.schema.json");
const schema = JSON.parse(readFileSync(schemaPath, "utf8"));

const SCHEMA_RECOMMENDED_ACTION_ENUM = new Set<string>(
  schema.properties.recommended_action.enum,
);

// TS Literal mirror — must stay in sync with src/schemas/signal.ts.
const TS_RECOMMENDED_ACTION_LITERAL: RecommendedAction[] = [
  "continue",
  "log_and_continue",
  "pause_for_review",
  "deny_and_escalate",
];

// Required-field mirrors. We iterate the schema list with toContain so that
// failure messages name the specific missing field.
const TS_INTEGRITY_SIGNAL_REQUIRED_FIELDS = [
  "checkpoint",
  "proceed",
  "recommended_action",
  "window_summary",
] as const;

const TS_WINDOW_SUMMARY_REQUIRED_FIELDS = [
  "size",
  "max_size",
  "verdicts",
  "integrity_ratio",
  "drift_alert_active",
] as const;

const TS_VERDICT_COUNTS_REQUIRED_FIELDS = [
  "clear",
  "review_needed",
  "boundary_violation",
] as const;

describe("schemas/integrity-signal.schema.json — RecommendedAction parity", () => {
  it("schema enum matches the TS Literal union in src/schemas/signal.ts", () => {
    expect(new Set(TS_RECOMMENDED_ACTION_LITERAL)).toEqual(SCHEMA_RECOMMENDED_ACTION_ENUM);
  });
});

describe("schemas/integrity-signal.schema.json — IntegritySignal required fields", () => {
  const SCHEMA_REQUIRED_FIELDS: string[] = schema.required;

  it("every schema required field is present in the TS IntegritySignal interface", () => {
    for (const field of SCHEMA_REQUIRED_FIELDS) {
      expect(TS_INTEGRITY_SIGNAL_REQUIRED_FIELDS).toContain(field);
    }
  });
});

describe("schemas/integrity-signal.schema.json — WindowSummary required fields", () => {
  const SCHEMA_REQUIRED_FIELDS: string[] = schema.$defs.WindowSummary.required;

  it("every schema required field is present in the TS WindowSummary interface", () => {
    for (const field of SCHEMA_REQUIRED_FIELDS) {
      expect(TS_WINDOW_SUMMARY_REQUIRED_FIELDS).toContain(field);
    }
  });
});

describe("schemas/integrity-signal.schema.json — verdicts object required fields", () => {
  const SCHEMA_REQUIRED_FIELDS: string[] =
    schema.$defs.WindowSummary.properties.verdicts.required;

  it("every schema required field is present in the TS verdicts inline type", () => {
    for (const field of SCHEMA_REQUIRED_FIELDS) {
      expect(TS_VERDICT_COUNTS_REQUIRED_FIELDS).toContain(field);
    }
  });
});
