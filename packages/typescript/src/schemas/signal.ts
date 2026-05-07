/**
 * Integrity Signal types for the Agent Integrity Protocol.
 *
 * The Integrity Signal is the complete payload delivered to the host system
 * after an integrity check, containing the checkpoint, proceed recommendation,
 * and window summary.
 */

import type { IntegrityCheckpoint } from "./checkpoint";

/**
 * Recommended action for the host system in response to an integrity check.
 *
 * - "continue": No action needed (verdict: clear)
 * - "log_and_continue": Log the signal, continue execution (verdict: review_needed)
 * - "pause_for_review": Pause execution, request human review (verdict: boundary_violation)
 * - "deny_and_escalate": Deny the next action, escalate to principal (verdict: boundary_violation with critical severity)
 */
export type RecommendedAction =
  | "continue"
  | "log_and_continue"
  | "pause_for_review"
  | "deny_and_escalate";

/**
 * Summary of the current session window state.
 *
 * Provides aggregate statistics about recent integrity verdicts,
 * the integrity ratio, and whether a drift alert is active.
 */
export interface WindowSummary {
  /** Current window size */
  size: number;

  /** Maximum window size */
  max_size: number;

  /** Verdicts in current window */
  verdicts: {
    clear: number;
    review_needed: number;
    boundary_violation: number;
  };

  /** Integrity ratio: clear_count / total in window (0.0 to 1.0) */
  integrity_ratio: number;

  /** Whether a drift alert is active */
  drift_alert_active: boolean;
}

/**
 * The complete payload delivered to the host system after an integrity check.
 *
 * Contains the checkpoint, a proceed boolean, the recommended action,
 * and a summary of the current session window.
 */
export interface IntegritySignal {
  /** The integrity checkpoint */
  checkpoint: IntegrityCheckpoint;

  /**
   * Whether the agent may continue executing.
   * - `true` for "clear" (no issues) and "review_needed" (warnings only — proceed with optional logging)
   * - `false` for "boundary_violation" (agent must be stopped)
   *
   * For finer-grained control, use `recommended_action` which distinguishes
   * "clear" from "review_needed" without requiring boolean interpretation.
   */
  proceed: boolean;

  /** Recommended action for the host system */
  recommended_action: RecommendedAction;

  /** Current window summary */
  window_summary: WindowSummary;

  /**
   * Optional pointer to a Mnemom platform governance signal (ADR-048) that
   * contextualizes this integrity result. Set when the host platform
   * correlates an integrity check with a fleet-shaped observation
   * (e.g., a sideband.coherence drop preceded a boundary violation, suggesting
   * the violation reflects team-level drift rather than an agent-isolated lapse).
   *
   * The integrity result stands on its own without this field; it is purely
   * informational, surfaced in audit pipelines and operator dashboards. Format:
   * `gs-{12-hex}` matching governance_signals.id. Application composers may use
   * this to render the contextual signal alongside the integrity outcome.
   *
   * @see ADR-048 §1 for the operator-vs-agent layering principle
   * @see https://docs.mnemom.ai/concepts/governance-signals
   */
  triggering_governance_signal_id?: string;
}
