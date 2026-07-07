/**
 * Canonical JSON schema parity tests for conscience-value.schema.json.
 *
 * Validates that every TypeScript-side enumeration and required-field set
 * declared for ConscienceValue and ConscienceValueType matches the canonical
 * schema at schemas/conscience-value.schema.json.
 * These tests fail fast on drift — catching schema/implementation divergence at
 * PR time rather than in production.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import type { ConscienceValueType } from "../../src/schemas/conscience.js";

const here = dirname(fileURLToPath(import.meta.url));
const schemaPath = resolve(here, "../../../../schemas/conscience-value.schema.json");
const schema = JSON.parse(readFileSync(schemaPath, "utf8"));

const SCHEMA_CONSCIENCE_VALUE_TYPE_ENUM = new Set<string>(schema.properties.type.enum);

// TS Literal mirror — must stay in sync with src/schemas/conscience.ts.
const TS_CONSCIENCE_VALUE_TYPE_LITERAL: ConscienceValueType[] = [
  "BOUNDARY",
  "FEAR",
  "COMMITMENT",
  "BELIEF",
  "HOPE",
];

// Required-field mirror. We iterate the schema list with toContain so that
// failure messages name the specific missing field.
const TS_CONSCIENCE_VALUE_REQUIRED_FIELDS = [
  "type",
  "content",
] as const;

describe("schemas/conscience-value.schema.json — ConscienceValueType parity", () => {
  it("schema enum matches the TS Literal union in src/schemas/conscience.ts", () => {
    expect(new Set(TS_CONSCIENCE_VALUE_TYPE_LITERAL)).toEqual(
      SCHEMA_CONSCIENCE_VALUE_TYPE_ENUM,
    );
  });
});

describe("schemas/conscience-value.schema.json — ConscienceValue required fields", () => {
  const SCHEMA_REQUIRED_FIELDS: string[] = schema.required;

  it("every schema required field is present in the TS ConscienceValue interface", () => {
    for (const field of SCHEMA_REQUIRED_FIELDS) {
      expect(TS_CONSCIENCE_VALUE_REQUIRED_FIELDS).toContain(field);
    }
  });
});
