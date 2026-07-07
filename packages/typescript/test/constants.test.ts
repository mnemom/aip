/**
 * Cross-language constants parity test.
 *
 * Reads schemas/constants.json (canonical source of truth for all shared AIP
 * constants) and verifies every constant in the TypeScript SDK matches the spec
 * value. The parallel Python test at
 * packages/python/tests/test_constants_parity.py makes the same assertions
 * against constants.py. Both must pass for a change to schemas/constants.json
 * to land.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import * as C from "../src/constants.js";

const here = dirname(fileURLToPath(import.meta.url));
const specPath = resolve(here, "../../../schemas/constants.json");
const spec = JSON.parse(readFileSync(specPath, "utf8")) as Record<string, unknown>;

const SPEC_CONSCIENCE_VALUES = spec.DEFAULT_CONSCIENCE_VALUES as Array<{
  id: string;
  type: string;
  content: string;
}>;
const SPEC_EU_WINDOW = spec.EU_COMPLIANCE_WINDOW_CONFIG as Record<string, unknown>;
const SPEC_EU_POLICY = spec.EU_COMPLIANCE_FAILURE_POLICY as Record<string, unknown>;

describe("constants parity with schemas/constants.json", () => {
  describe("scalar constants", () => {
    it("AIP_VERSION", () => expect(C.AIP_VERSION).toBe(spec.AIP_VERSION));
    it("ALGORITHM_VERSION", () => expect(C.ALGORITHM_VERSION).toBe(spec.ALGORITHM_VERSION));
    it("DEFAULT_SUSTAINED_CHECKS_THRESHOLD", () =>
      expect(C.DEFAULT_SUSTAINED_CHECKS_THRESHOLD).toBe(spec.DEFAULT_SUSTAINED_CHECKS_THRESHOLD));
    it("DRIFT_SEVERITY_LOW_THRESHOLD", () =>
      expect(C.DRIFT_SEVERITY_LOW_THRESHOLD).toBe(spec.DRIFT_SEVERITY_LOW_THRESHOLD));
    it("DRIFT_SEVERITY_MEDIUM_THRESHOLD", () =>
      expect(C.DRIFT_SEVERITY_MEDIUM_THRESHOLD).toBe(spec.DRIFT_SEVERITY_MEDIUM_THRESHOLD));
    it("DEFAULT_THINKING_TOKEN_BUDGET", () =>
      expect(C.DEFAULT_THINKING_TOKEN_BUDGET).toBe(spec.DEFAULT_THINKING_TOKEN_BUDGET));
    it("DEFAULT_OUTPUT_TOKEN_BUDGET", () =>
      expect(C.DEFAULT_OUTPUT_TOKEN_BUDGET).toBe(spec.DEFAULT_OUTPUT_TOKEN_BUDGET));
    it("TRUNCATION_HEAD_RATIO", () =>
      expect(C.TRUNCATION_HEAD_RATIO).toBe(spec.TRUNCATION_HEAD_RATIO));
    it("TRUNCATION_TAIL_RATIO", () =>
      expect(C.TRUNCATION_TAIL_RATIO).toBe(spec.TRUNCATION_TAIL_RATIO));
    it("MAX_EVIDENCE_LENGTH", () => expect(C.MAX_EVIDENCE_LENGTH).toBe(spec.MAX_EVIDENCE_LENGTH));
    it("DEFAULT_MIN_EVIDENCE_TOKENS", () =>
      expect(C.DEFAULT_MIN_EVIDENCE_TOKENS).toBe(spec.DEFAULT_MIN_EVIDENCE_TOKENS));
    it("DEFAULT_ANALYSIS_TIMEOUT_MS", () =>
      expect(C.DEFAULT_ANALYSIS_TIMEOUT_MS).toBe(spec.DEFAULT_ANALYSIS_TIMEOUT_MS));
    it("DEFAULT_ANALYSIS_MAX_TOKENS", () =>
      expect(C.DEFAULT_ANALYSIS_MAX_TOKENS).toBe(spec.DEFAULT_ANALYSIS_MAX_TOKENS));
    it("DEFAULT_WINDOW_MAX_SIZE", () =>
      expect(C.DEFAULT_WINDOW_MAX_SIZE).toBe(spec.DEFAULT_WINDOW_MAX_SIZE));
    it("MIN_WINDOW_SIZE", () => expect(C.MIN_WINDOW_SIZE).toBe(spec.MIN_WINDOW_SIZE));
    it("DEFAULT_WINDOW_MAX_AGE_SECONDS", () =>
      expect(C.DEFAULT_WINDOW_MAX_AGE_SECONDS).toBe(spec.DEFAULT_WINDOW_MAX_AGE_SECONDS));
    it("CONFIDENCE_NATIVE", () => expect(C.CONFIDENCE_NATIVE).toBe(spec.CONFIDENCE_NATIVE));
    it("CONFIDENCE_EXPLICIT", () => expect(C.CONFIDENCE_EXPLICIT).toBe(spec.CONFIDENCE_EXPLICIT));
    it("CONFIDENCE_FALLBACK", () => expect(C.CONFIDENCE_FALLBACK).toBe(spec.CONFIDENCE_FALLBACK));
    it("WEBHOOK_MAX_RETRIES", () => expect(C.WEBHOOK_MAX_RETRIES).toBe(spec.WEBHOOK_MAX_RETRIES));
    it("AIP_CONTENT_TYPE", () => expect(C.AIP_CONTENT_TYPE).toBe(spec.AIP_CONTENT_TYPE));
    it("AIP_VERSION_HEADER", () => expect(C.AIP_VERSION_HEADER).toBe(spec.AIP_VERSION_HEADER));
    it("AIP_SIGNATURE_HEADER", () =>
      expect(C.AIP_SIGNATURE_HEADER).toBe(spec.AIP_SIGNATURE_HEADER));
    it("CHECKPOINT_ID_PREFIX", () =>
      expect(C.CHECKPOINT_ID_PREFIX).toBe(spec.CHECKPOINT_ID_PREFIX));
    it("DRIFT_ALERT_ID_PREFIX", () =>
      expect(C.DRIFT_ALERT_ID_PREFIX).toBe(spec.DRIFT_ALERT_ID_PREFIX));
    it("REGISTRATION_ID_PREFIX", () =>
      expect(C.REGISTRATION_ID_PREFIX).toBe(spec.REGISTRATION_ID_PREFIX));
  });

  describe("WEBHOOK_RETRY_DELAYS_MS", () => {
    it("matches spec array", () =>
      expect([...C.WEBHOOK_RETRY_DELAYS_MS]).toEqual(spec.WEBHOOK_RETRY_DELAYS_MS));
  });

  describe("EU_COMPLIANCE_WINDOW_CONFIG", () => {
    it("max_size", () =>
      expect(C.EU_COMPLIANCE_WINDOW_CONFIG.max_size).toBe(SPEC_EU_WINDOW.max_size));
    it("mode", () => expect(C.EU_COMPLIANCE_WINDOW_CONFIG.mode).toBe(SPEC_EU_WINDOW.mode));
    it("session_boundary", () =>
      expect(C.EU_COMPLIANCE_WINDOW_CONFIG.session_boundary).toBe(
        SPEC_EU_WINDOW.session_boundary,
      ));
    it("max_age_seconds", () =>
      expect(C.EU_COMPLIANCE_WINDOW_CONFIG.max_age_seconds).toBe(SPEC_EU_WINDOW.max_age_seconds));
  });

  describe("EU_COMPLIANCE_FAILURE_POLICY", () => {
    it("mode", () => expect(C.EU_COMPLIANCE_FAILURE_POLICY.mode).toBe(SPEC_EU_POLICY.mode));
    it("analysis_timeout_ms", () =>
      expect(C.EU_COMPLIANCE_FAILURE_POLICY.analysis_timeout_ms).toBe(
        SPEC_EU_POLICY.analysis_timeout_ms,
      ));
  });

  describe("DEFAULT_CONSCIENCE_VALUES", () => {
    it("count matches spec", () =>
      expect(C.DEFAULT_CONSCIENCE_VALUES.length).toBe(SPEC_CONSCIENCE_VALUES.length));

    it("all IDs present", () => {
      const specIds = new Set(SPEC_CONSCIENCE_VALUES.map((v) => v.id));
      const sdkIds = new Set(C.DEFAULT_CONSCIENCE_VALUES.map((v) => v.id));
      expect(sdkIds).toEqual(specIds);
    });

    for (const { id, type, content } of SPEC_CONSCIENCE_VALUES) {
      it(`[${id}] type matches`, () => {
        const cv = C.DEFAULT_CONSCIENCE_VALUES.find((v) => v.id === id);
        expect(cv?.type).toBe(type);
      });
      it(`[${id}] content matches`, () => {
        const cv = C.DEFAULT_CONSCIENCE_VALUES.find((v) => v.id === id);
        expect(cv?.content).toBe(content);
      });
    }
  });
});
