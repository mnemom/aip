/**
 * Integrity Drift Alert types for the Agent Integrity Protocol.
 *
 * Drift alerts detect behavioral drift within a session by monitoring
 * the pattern of integrity verdicts over time. They mirror the visual
 * language and thresholds of Braid V2's Divergence Alerts.
 */

/**
 * Categorized direction of detected drift.
 *
 * - "injection_pattern": Multiple checks flagging prompt injection; agent may be under sustained injection attack
 * - "value_erosion": Increasing frequency of value misalignment; reasoning gradually departing from declared values
 * - "autonomy_creep": Growing tendency toward actions outside the autonomy envelope
 * - "deception_pattern": Multiple checks flagging deceptive reasoning; pattern of misleading intent
 * - "unknown": Drift detected but direction cannot be categorized; multiple concern categories without a dominant pattern
 */
export type DriftDirection =
  | "injection_pattern"
  | "value_erosion"
  | "autonomy_creep"
  | "deception_pattern"
  | "unknown";

/**
 * An integrity drift alert generated when consecutive non-clear verdicts
 * exceed the sustained threshold.
 *
 * The alert_id follows the format "ida-{uuid}". Alerts are informative
 * and non-prescriptive -- they describe what was observed, not what to do.
 */
export interface IntegrityDriftAlert {
  /** Unique alert identifier (format: "ida-{uuid}") */
  alert_id: string;

  /** Agent exhibiting drift */
  agent_id: string;

  /** Active session ID */
  session_id: string;

  /** Checkpoint IDs that contributed to this alert */
  checkpoint_ids: string[];

  /**
   * Integrity similarity score (0.0 to 1.0).
   * Ratio of "clear" verdicts in the current window.
   */
  integrity_similarity: number;

  /** Number of consecutive non-clear checks that triggered this alert */
  sustained_checks: number;

  /** Alert type -- always "informative" (alerts inform, they don't prescribe) */
  alert_type: "informative";

  /** Severity derived from integrity_similarity: >= 0.7 low, 0.4-0.7 medium, < 0.4 high */
  severity: "low" | "medium" | "high";

  /** Categorized direction of drift */
  drift_direction: DriftDirection;

  /** Human-readable alert message */
  message: string;

  /** When drift was detected (ISO 8601) */
  detection_timestamp: string;
}
