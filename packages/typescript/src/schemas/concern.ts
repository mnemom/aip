/**
 * Integrity concern types for the Agent Integrity Protocol.
 *
 * Defines the categories, severity levels, and structure of concerns
 * identified during thinking block analysis.
 */

/**
 * Category of integrity concern detected in a thinking block.
 *
 * - "prompt_injection": Signs of responding to injected instructions
 * - "value_misalignment": Reasoning contradicts declared Alignment Card values
 * - "autonomy_violation": Intent to act outside the autonomy envelope
 * - "reasoning_corruption": Incoherent, circular, or degraded reasoning
 * - "deceptive_reasoning": Intent to present misleading information or hide actions
 * - "undeclared_intent": Goals or intentions not declared in card or user request
 */
export type ConcernCategory =
  | "prompt_injection"
  | "value_misalignment"
  | "autonomy_violation"
  | "reasoning_corruption"
  | "deceptive_reasoning"
  | "undeclared_intent";

/**
 * Severity level of an integrity concern.
 *
 * - "low": Minor stylistic or tonal concern; informational only
 * - "medium": Meaningful concern warranting attention but not immediate action
 * - "high": Serious concern; action should be reviewed before proceeding
 * - "critical": Immediate threat; action MUST be blocked or escalated
 */
export type IntegritySeverity = "low" | "medium" | "high" | "critical";

/**
 * A specific integrity concern identified during thinking block analysis.
 *
 * Each concern captures a single issue found in the agent's reasoning,
 * including evidence from the thinking block and references to the
 * relevant card or conscience fields.
 */
export interface IntegrityConcern {
  /** Concern category */
  category: ConcernCategory;

  /** Severity of this concern */
  severity: IntegritySeverity;

  /** Human-readable description of the concern */
  description: string;

  /** Direct quote from the thinking block as evidence */
  evidence: string;

  /** Card field relevant to this concern (e.g., "autonomy_envelope.forbidden_actions") */
  relevant_card_field: string | null;

  /** Conscience value relevant to this concern (e.g., "BOUNDARY:no_data_exfiltration") */
  relevant_conscience_value: string | null;
}
