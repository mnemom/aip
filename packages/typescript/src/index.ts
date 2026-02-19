/**
 * @mnemom/agent-integrity-protocol
 *
 * Real-time thinking block analysis for AI agent alignment.
 * Operates as a daimonion (conscience): silence means aligned, voice means outside boundaries.
 *
 * @packageDocumentation
 */

// ---------------------------------------------------------------------------
// SDK — primary user-facing API
// ---------------------------------------------------------------------------

export { createClient } from "./sdk/index.js";
export type { AIPClient } from "./sdk/index.js";
export { signPayload, verifySignature } from "./sdk/index.js";

// ---------------------------------------------------------------------------
// Analysis — core pure functions
// ---------------------------------------------------------------------------

export {
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
} from "./analysis/index.js";

export type {
  CheckIntegrityInput,
  PromptInput,
  BuiltPrompt,
  DriftState,
} from "./analysis/index.js";

// ---------------------------------------------------------------------------
// Adapters — provider-specific thinking block extraction
// ---------------------------------------------------------------------------

export {
  createAdapterRegistry,
  AnthropicAdapter,
  OpenAIAdapter,
  GoogleAdapter,
  FallbackAdapter,
} from "./adapters/index.js";

export type {
  AdapterRegistry,
  ProviderAdapter,
  ExtractedThinking,
  ExtractionMethod,
} from "./adapters/index.js";

// ---------------------------------------------------------------------------
// Window — session state management
// ---------------------------------------------------------------------------

export { WindowManager, createWindowState } from "./window/index.js";
export type { WindowState } from "./window/index.js";

// ---------------------------------------------------------------------------
// Types — all schema types
// ---------------------------------------------------------------------------

export type {
  // Checkpoint
  IntegrityVerdict,
  AnalysisMetadata,
  WindowPosition,
  IntegrityCheckpoint,
  // Signal
  RecommendedAction,
  WindowSummary,
  IntegritySignal,
  // Concern
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
  // Certificate / attestation
  IntegrityCertificate,
  MerkleProof,
  ChainHash,
  CertificateVerificationResult,
} from "./schemas/index.js";

// ---------------------------------------------------------------------------
// Verification — offline certificate verification
// ---------------------------------------------------------------------------

export { verifyCertificate } from "./verification/index.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export {
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
} from "./constants.js";
