/**
 * Analysis module barrel exports for the Agent Integrity Protocol.
 *
 * Re-exports all public functions and types from the analysis submodules.
 */

// Engine: core integrity check and signal building
export {
  checkIntegrity,
  buildSignal,
  mapVerdictToAction,
  mapVerdictToProceed,
  hashThinkingBlock,
} from "./engine.js";
export type { CheckIntegrityInput } from "./engine.js";

// Conscience prompt builder
export { buildConsciencePrompt } from "./prompt.js";
export type { PromptInput, BuiltPrompt } from "./prompt.js";

// Card summary extraction
export { summarizeCard } from "./card-summary.js";

// Card-Conscience Agreement validation
export { validateAgreement } from "./agreement.js";

// Drift detection
export { detectIntegrityDrift, createDriftState } from "./drift.js";
export type { DriftState } from "./drift.js";
