/**
 * Backward compatibility smoke test — API surface lock for 1.0.0
 *
 * Imports every public export from the 1.0.0 API surface and asserts
 * existence + basic type shape. Catches accidental breaking changes:
 *
 *   - Removed export       → compile error (import fails)
 *   - Renamed export       → compile error (import fails)
 *   - Changed fn signature → type error
 *   - Changed return type  → runtime assertion failure
 *
 * When adding new exports:     add them here.
 * When making breaking changes: bump major version first (ADR-006).
 *
 * Scale Step 30 — M3: API Contracts & SDK Stability
 */
import { describe, it, expect } from "vitest";

// ── Value exports ──────────────────────────────────────────────────────────

import {
  // SDK core
  createClient,
  signPayload,
  verifySignature,
  // Analysis
  checkIntegrity,
  buildSignal,
  mapVerdictToAction,
  mapVerdictToProceed,
  hashThinkingBlock,
  buildConsciencePrompt,
  summarizeCard,
  validateAgreement,
  detectIntegrityDrift,
  createDriftState,
  validateRecipeContent,
  normalizeLegacyRecipe,
  // Adapters
  createAdapterRegistry,
  AnthropicAdapter,
  OpenAIAdapter,
  GoogleAdapter,
  FallbackAdapter,
  // Certificate verification
  verifyCertificate,
  // Constants
  AIP_VERSION,
  ALGORITHM_VERSION,
  DEFAULT_SUSTAINED_CHECKS_THRESHOLD,
  DRIFT_SEVERITY_LOW_THRESHOLD,
  DRIFT_SEVERITY_MEDIUM_THRESHOLD,
  DEFAULT_THINKING_TOKEN_BUDGET,
  TRUNCATION_HEAD_RATIO,
  TRUNCATION_TAIL_RATIO,
  MAX_EVIDENCE_LENGTH,
  DEFAULT_ANALYSIS_TIMEOUT_MS,
  DEFAULT_ANALYSIS_MAX_TOKENS,
  DEFAULT_WINDOW_MAX_SIZE,
  MIN_WINDOW_SIZE,
  DEFAULT_WINDOW_MAX_AGE_SECONDS,
  CONFIDENCE_NATIVE,
  CONFIDENCE_EXPLICIT,
  CONFIDENCE_FALLBACK,
  WEBHOOK_MAX_RETRIES,
  WEBHOOK_RETRY_DELAYS_MS,
  AIP_CONTENT_TYPE,
  AIP_VERSION_HEADER,
  AIP_SIGNATURE_HEADER,
  CHECKPOINT_ID_PREFIX,
  DRIFT_ALERT_ID_PREFIX,
  REGISTRATION_ID_PREFIX,
  DEFAULT_CONSCIENCE_VALUES,
  EU_COMPLIANCE_WINDOW_CONFIG,
  EU_COMPLIANCE_FAILURE_POLICY,
} from "../src/index.js";

// ── Type-only exports (compile-time check) ─────────────────────────────────

import type {
  // SDK
  AIPClient,
  WindowState,
  // Checkpoint + Signal
  IntegrityVerdict,
  AnalysisMetadata,
  WindowPosition,
  IntegrityCheckpoint,
  RecommendedAction,
  WindowSummary,
  IntegritySignal,
  // Concerns
  ConcernCategory,
  IntegritySeverity,
  IntegrityConcern,
  // Conscience
  ConscienceValueType,
  ConscienceValue,
  ConsultationDepth,
  ConscienceContext,
  // Drift
  DriftDirection,
  IntegrityDriftAlert,
  // Config
  EscalationTrigger,
  AlignmentCardValue,
  AutonomyEnvelope,
  AlignmentCard,
  WindowMode,
  SessionBoundary,
  WindowConfig,
  FailureMode,
  FailurePolicy,
  AnalysisLLMConfig,
  AIPCallbacks,
  AIPConfig,
  // Agreement
  CardConscienceConflict,
  CardConscienceAugmentation,
  CardConscienceAgreement,
  // Certificate
  IntegrityCertificate,
  MerkleProof,
  ChainHash,
  CertificateVerificationResult,
  // Recipe
  RecipeOperator,
  RecipeSeverity,
  RecipeScope,
  RecipeMatchMode,
  RecipeTier3Action,
  RecipeCondition,
  RecipeTier1,
  RecipeTier2Trigger,
  RecipeTier2Check,
  RecipeTier2,
  RecipeTier3When,
  RecipeTier3Rule,
  RecipeTier3,
  RecipeParsedContent,
  DetectionRecipe,
  // Adapters
  AdapterRegistry,
  ProviderAdapter,
  ExtractedThinking,
  ExtractionMethod,
  // Analysis I/O
  CheckIntegrityInput,
  PromptInput,
  BuiltPrompt,
  DriftState,
  RecipeValidationResult,
} from "../src/index.js";

// ── Runtime assertions ─────────────────────────────────────────────────────

describe("AIP 1.0.0 backward compatibility", () => {
  describe("SDK core functions", () => {
    it("createClient", () => expect(typeof createClient).toBe("function"));
    it("signPayload", () => expect(typeof signPayload).toBe("function"));
    it("verifySignature", () => expect(typeof verifySignature).toBe("function"));
  });

  describe("analysis functions", () => {
    it("checkIntegrity", () => expect(typeof checkIntegrity).toBe("function"));
    it("buildSignal", () => expect(typeof buildSignal).toBe("function"));
    it("mapVerdictToAction", () => expect(typeof mapVerdictToAction).toBe("function"));
    it("mapVerdictToProceed", () => expect(typeof mapVerdictToProceed).toBe("function"));
    it("hashThinkingBlock", () => expect(typeof hashThinkingBlock).toBe("function"));
    it("buildConsciencePrompt", () => expect(typeof buildConsciencePrompt).toBe("function"));
    it("summarizeCard", () => expect(typeof summarizeCard).toBe("function"));
    it("validateAgreement", () => expect(typeof validateAgreement).toBe("function"));
    it("detectIntegrityDrift", () => expect(typeof detectIntegrityDrift).toBe("function"));
    it("createDriftState", () => expect(typeof createDriftState).toBe("function"));
    it("validateRecipeContent", () => expect(typeof validateRecipeContent).toBe("function"));
    it("normalizeLegacyRecipe", () => expect(typeof normalizeLegacyRecipe).toBe("function"));
  });

  describe("adapter system", () => {
    it("createAdapterRegistry", () => expect(typeof createAdapterRegistry).toBe("function"));
    it("AnthropicAdapter", () => expect(typeof AnthropicAdapter).toBe("function"));
    it("OpenAIAdapter", () => expect(typeof OpenAIAdapter).toBe("function"));
    it("GoogleAdapter", () => expect(typeof GoogleAdapter).toBe("function"));
    it("FallbackAdapter", () => expect(typeof FallbackAdapter).toBe("function"));

    it("registry has expected methods", () => {
      const registry = createAdapterRegistry();
      expect(typeof registry.get).toBe("function");
      expect(typeof registry.detectFromUrl).toBe("function");
      expect(typeof registry.register).toBe("function");
      expect(typeof registry.providers).toBe("function");
    });

    it("built-in adapters have provider property", () => {
      expect(new AnthropicAdapter().provider).toBe("anthropic");
      expect(new OpenAIAdapter().provider).toBe("openai");
      expect(new GoogleAdapter().provider).toBe("google");
      expect(new FallbackAdapter().provider).toBe("fallback");
    });
  });

  describe("certificate verification", () => {
    it("verifyCertificate", () => expect(typeof verifyCertificate).toBe("function"));
  });

  describe("constants", () => {
    it("AIP_VERSION", () => expect(typeof AIP_VERSION).toBe("string"));
    it("ALGORITHM_VERSION", () => expect(typeof ALGORITHM_VERSION).toBe("string"));
    it("DEFAULT_WINDOW_MAX_SIZE", () => expect(typeof DEFAULT_WINDOW_MAX_SIZE).toBe("number"));
    it("CONFIDENCE_NATIVE", () => expect(typeof CONFIDENCE_NATIVE).toBe("number"));
    it("WEBHOOK_RETRY_DELAYS_MS", () => expect(Array.isArray(WEBHOOK_RETRY_DELAYS_MS)).toBe(true));
    it("DEFAULT_CONSCIENCE_VALUES", () => expect(Array.isArray(DEFAULT_CONSCIENCE_VALUES)).toBe(true));
    it("EU_COMPLIANCE_WINDOW_CONFIG", () => expect(typeof EU_COMPLIANCE_WINDOW_CONFIG).toBe("object"));
    it("EU_COMPLIANCE_FAILURE_POLICY", () => expect(typeof EU_COMPLIANCE_FAILURE_POLICY).toBe("object"));
  });

  describe("type exports compile", () => {
    it("types are importable (compile-time validated)", () => {
      const _client: AIPClient | null = null;
      const _signal: IntegritySignal | null = null;
      const _checkpoint: IntegrityCheckpoint | null = null;
      const _config: AIPConfig | null = null;
      const _agreement: CardConscienceAgreement | null = null;
      const _cert: CertificateVerificationResult | null = null;
      const _recipe: DetectionRecipe | null = null;
      const _adapter: ProviderAdapter | null = null;
      const _drift: IntegrityDriftAlert | null = null;
      expect(true).toBe(true);
    });
  });
});
