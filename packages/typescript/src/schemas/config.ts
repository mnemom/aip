/**
 * Configuration types for the Agent Integrity Protocol SDK.
 *
 * Defines all configuration interfaces needed to initialize and
 * operate the AIP engine, including window, failure policy,
 * analysis LLM, callbacks, and the top-level AIPConfig.
 */

import type { ConscienceValue } from "./conscience";
import type { IntegritySignal } from "./signal";
import type { IntegrityDriftAlert } from "./drift-alert";

// ---------------------------------------------------------------------------
// Alignment Card (minimal local definition)
// ---------------------------------------------------------------------------

/**
 * Escalation trigger defined in the Alignment Card's autonomy envelope.
 */
export interface EscalationTrigger {
  /** Condition that triggers escalation */
  condition: string;

  /** Action to take when triggered (e.g., "escalate", "deny", "log") */
  action: string;

  /** Reason for this escalation trigger */
  reason?: string;
}

/**
 * A declared value in the Alignment Card.
 */
export interface AlignmentCardValue {
  /** Value name */
  name: string;

  /** Value priority (lower number = higher priority) */
  priority: number;

  /** Optional description of the value */
  description?: string;
}

/**
 * Autonomy envelope from the Alignment Card.
 *
 * Defines the boundaries within which the agent is permitted to operate.
 */
export interface AutonomyEnvelope {
  /** Actions the agent is permitted to take */
  bounded_actions?: string[];

  /** Actions the agent MUST NOT take */
  forbidden_actions?: string[];

  /** Conditions that require escalation */
  escalation_triggers?: EscalationTrigger[];
}

/**
 * Minimal Alignment Card interface with the fields AIP needs for evaluation.
 *
 * Since @mnemom/agent-alignment-protocol is an optional peer dependency,
 * this defines only the subset of fields required by the AIP engine.
 * Additional fields from the full AAP AlignmentCard are accepted but not required.
 */
export interface AlignmentCard {
  /** Unique card identifier */
  card_id: string;

  /** Declared values with priorities */
  values: AlignmentCardValue[];

  /** Autonomy envelope defining permitted and forbidden actions */
  autonomy_envelope: AutonomyEnvelope;

  /** Allow additional fields from the full AAP AlignmentCard */
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Window Configuration
// ---------------------------------------------------------------------------

/**
 * Window eviction mode.
 *
 * - "sliding": Oldest checkpoint evicted when max_size reached (default)
 * - "fixed": Window fills to max_size, then resets entirely
 */
export type WindowMode = "sliding" | "fixed";

/**
 * Behavior at session boundaries.
 *
 * - "reset": Clear window on new session (default)
 * - "carry": Carry window across sessions
 */
export type SessionBoundary = "reset" | "carry";

/**
 * Configuration for the session window that maintains recent integrity checkpoints.
 */
export interface WindowConfig {
  /**
   * Maximum number of checkpoints in the window.
   * Default: 10. Minimum: 3.
   */
  max_size: number;

  /** Window eviction mode */
  mode: WindowMode;

  /** Behavior at session boundaries */
  session_boundary: SessionBoundary;

  /**
   * Maximum age of checkpoints in seconds.
   * Checkpoints older than this are evicted regardless of window size.
   * Default: 3600 (1 hour).
   */
  max_age_seconds: number;
}

// ---------------------------------------------------------------------------
// Failure Policy
// ---------------------------------------------------------------------------

/**
 * Behavior when integrity analysis fails.
 *
 * - "fail_open": Generate synthetic clear checkpoint; agent proceeds (default)
 * - "fail_closed": Generate synthetic boundary_violation; agent is blocked
 */
export type FailureMode = "fail_open" | "fail_closed";

/**
 * Policy governing behavior when the analysis LLM is unreachable or returns errors.
 */
export interface FailurePolicy {
  /** Behavior when analysis fails */
  mode: FailureMode;

  /** Timeout for analysis LLM calls in milliseconds. Default: 10000. */
  analysis_timeout_ms: number;
}

// ---------------------------------------------------------------------------
// Analysis LLM Configuration
// ---------------------------------------------------------------------------

/**
 * Configuration for the LLM used to perform integrity analysis.
 */
export interface AnalysisLLMConfig {
  /** Model to use for analysis (e.g., "claude-3-5-haiku-20241022") */
  model: string;

  /** API base URL for the analysis LLM */
  base_url: string;

  /** API key for the analysis LLM */
  api_key: string;

  /** Maximum tokens for the analysis response */
  max_tokens: number;
}

// ---------------------------------------------------------------------------
// Callbacks
// ---------------------------------------------------------------------------

/**
 * Optional callback functions for SDK signal delivery.
 *
 * All callbacks are optional. When provided, they are invoked
 * at the appropriate points during integrity analysis.
 */
export interface AIPCallbacks {
  /** Called after every integrity check */
  on_verdict?: (signal: IntegritySignal) => void | Promise<void>;

  /** Called when a drift alert is generated */
  on_drift_alert?: (alert: IntegrityDriftAlert) => void | Promise<void>;

  /** Called when an error occurs during analysis */
  on_error?: (error: Error) => void | Promise<void>;
}

// ---------------------------------------------------------------------------
// Top-level AIP Configuration
// ---------------------------------------------------------------------------

/**
 * Top-level configuration for initializing the AIP engine.
 *
 * Passed to initialize() to set up the integrity analysis pipeline.
 */
export interface AIPConfig {
  /** Alignment Card to evaluate against */
  card: AlignmentCard;

  /** Conscience values (optional; only BOUNDARY/FEAR types are injected into the conscience prompt) */
  conscience_values?: ConscienceValue[];

  /** Analysis LLM configuration */
  analysis_llm: AnalysisLLMConfig;

  /** Window configuration */
  window: WindowConfig;

  /** Callbacks for signal delivery */
  callbacks?: AIPCallbacks;

  /** Failure policy for analysis errors */
  failure_policy?: FailurePolicy;
}
