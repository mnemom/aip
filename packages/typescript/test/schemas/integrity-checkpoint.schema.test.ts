/**
 * Canonical JSON schema parity tests for integrity-checkpoint.schema.json.
 *
 * Validates that every TypeScript-side enumeration and required-field set
 * declared for IntegrityCheckpoint, ConscienceContext, AnalysisMetadata, and
 * WindowPosition matches the canonical schema at schemas/integrity-checkpoint.schema.json.
 * These tests fail fast on drift — catching schema/implementation divergence at
 * PR time rather than in production, mirroring the same guard that exists for
 * ConcernCategory and IntegritySeverity in concern.test.ts.
 *
 * ConsultationDepth is validated here (not in a conscience test) because its
 * canonical schema definition lives inside $defs.ConscienceContext in
 * integrity-checkpoint.schema.json.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import type { IntegrityVerdict } from "../../src/schemas/checkpoint.js";
import type { ConsultationDepth } from "../../src/schemas/conscience.js";

const here = dirname(fileURLToPath(import.meta.url));
const schemaPath = resolve(here, "../../../../schemas/integrity-checkpoint.schema.json");
const schema = JSON.parse(readFileSync(schemaPath, "utf8"));

const SCHEMA_VERDICT_ENUM = new Set<string>(schema.properties.verdict.enum);
const SCHEMA_CONSULTATION_DEPTH_ENUM = new Set<string>(
  schema.$defs.ConscienceContext.properties.consultation_depth.enum,
);

// TS Literal mirrors — must stay in sync with src/schemas/checkpoint.ts and
// src/schemas/conscience.ts respectively.
const TS_INTEGRITY_VERDICT_LITERAL: IntegrityVerdict[] = [
  "clear",
  "review_needed",
  "boundary_violation",
];

const TS_CONSULTATION_DEPTH_LITERAL: ConsultationDepth[] = [
  "surface",
  "standard",
  "deep",
];

// Required-field mirrors. The schema required array is the authoritative source;
// these TS lists must be a superset. We iterate the schema list with toContain
// so that failure messages name the specific missing field.
const TS_CHECKPOINT_REQUIRED_FIELDS = [
  "checkpoint_id",
  "agent_id",
  "card_id",
  "session_id",
  "timestamp",
  "thinking_block_hash",
  "provider",
  "model",
  "verdict",
  "concerns",
  "reasoning_summary",
  "conscience_context",
  "window_position",
  "analysis_metadata",
  "linked_trace_id",
] as const;

const TS_CONSCIENCE_CONTEXT_REQUIRED_FIELDS = [
  "values_checked",
  "conflicts",
  "supports",
  "considerations",
  "consultation_depth",
] as const;

const TS_ANALYSIS_METADATA_REQUIRED_FIELDS = [
  "analysis_model",
  "analysis_duration_ms",
  "thinking_tokens_original",
  "thinking_tokens_analyzed",
  "truncated",
  "extraction_confidence",
] as const;

const TS_WINDOW_POSITION_REQUIRED_FIELDS = [
  "index",
  "window_size",
] as const;

describe("schemas/integrity-checkpoint.schema.json — IntegrityVerdict parity", () => {
  it("schema enum matches the TS Literal union in src/schemas/checkpoint.ts", () => {
    expect(new Set(TS_INTEGRITY_VERDICT_LITERAL)).toEqual(SCHEMA_VERDICT_ENUM);
  });
});

describe("schemas/integrity-checkpoint.schema.json — ConsultationDepth parity", () => {
  it("schema enum matches the TS Literal union in src/schemas/conscience.ts", () => {
    expect(new Set(TS_CONSULTATION_DEPTH_LITERAL)).toEqual(SCHEMA_CONSULTATION_DEPTH_ENUM);
  });
});

describe("schemas/integrity-checkpoint.schema.json — IntegrityCheckpoint required fields", () => {
  const SCHEMA_REQUIRED_FIELDS: string[] = schema.required;

  it("every schema required field is present in the TS IntegrityCheckpoint interface", () => {
    for (const field of SCHEMA_REQUIRED_FIELDS) {
      expect(TS_CHECKPOINT_REQUIRED_FIELDS).toContain(field);
    }
  });
});

describe("schemas/integrity-checkpoint.schema.json — ConscienceContext required fields", () => {
  const SCHEMA_REQUIRED_FIELDS: string[] = schema.$defs.ConscienceContext.required;

  it("every schema required field is present in the TS ConscienceContext interface", () => {
    for (const field of SCHEMA_REQUIRED_FIELDS) {
      expect(TS_CONSCIENCE_CONTEXT_REQUIRED_FIELDS).toContain(field);
    }
  });
});

describe("schemas/integrity-checkpoint.schema.json — AnalysisMetadata required fields", () => {
  const SCHEMA_REQUIRED_FIELDS: string[] = schema.$defs.AnalysisMetadata.required;

  it("every schema required field is present in the TS AnalysisMetadata interface", () => {
    for (const field of SCHEMA_REQUIRED_FIELDS) {
      expect(TS_ANALYSIS_METADATA_REQUIRED_FIELDS).toContain(field);
    }
  });
});

describe("schemas/integrity-checkpoint.schema.json — WindowPosition required fields", () => {
  const SCHEMA_REQUIRED_FIELDS: string[] = schema.$defs.WindowPosition.required;

  it("every schema required field is present in the TS WindowPosition interface", () => {
    for (const field of SCHEMA_REQUIRED_FIELDS) {
      expect(TS_WINDOW_POSITION_REQUIRED_FIELDS).toContain(field);
    }
  });
});
