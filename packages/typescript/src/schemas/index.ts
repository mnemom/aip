/**
 * Schema/type re-exports for the Agent Integrity Protocol.
 *
 * All public types are re-exported from this barrel file.
 */

// Concern types
export type { ConcernCategory, IntegritySeverity, IntegrityConcern } from "./concern";

// Conscience types
export type {
  ConscienceValueType,
  ConscienceValue,
  ConsultationDepth,
  ConscienceContext,
} from "./conscience";

// Checkpoint types
export type {
  IntegrityVerdict,
  AnalysisMetadata,
  WindowPosition,
  IntegrityCheckpoint,
} from "./checkpoint";

// Signal types
export type { RecommendedAction, WindowSummary, IntegritySignal } from "./signal";

// Drift alert types
export type { DriftDirection, IntegrityDriftAlert } from "./drift-alert";

// Configuration types
export type {
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
} from "./config";

// Agreement types
export type {
  CardConscienceConflict,
  CardConscienceAugmentation,
  CardConscienceAgreement,
} from "./agreement";

// Certificate / attestation types
export type {
  IntegrityCertificate,
  MerkleProof,
  ChainHash,
  CertificateVerificationResult,
} from "./certificate";
