/**
 * Conscience value and consultation types for the Agent Integrity Protocol.
 *
 * Defines the structure of conscience values (the daimonion's awareness
 * declarations) and the context produced when they are consulted during
 * integrity analysis.
 */

/**
 * Type of conscience value declaration.
 *
 * - "BOUNDARY": Hard limit that blocks action
 * - "FEAR": Concern that warns
 * - "COMMITMENT": Positive aspiration
 * - "BELIEF": Held truth
 * - "HOPE": Desired outcome
 *
 * Only BOUNDARY and FEAR types are injected into the conscience prompt.
 */
export type ConscienceValueType =
  | "BOUNDARY"
  | "FEAR"
  | "COMMITMENT"
  | "BELIEF"
  | "HOPE";

/**
 * A typed value declaration from the daimonion system.
 *
 * Conscience values augment the Alignment Card's evaluative power,
 * increasing detection sensitivity for specific concerns.
 */
export interface ConscienceValue {
  /** Value type */
  type: ConscienceValueType;

  /** Value content (human-readable description) */
  content: string;

  /** Optional identifier */
  id?: string | null;
}

/**
 * Depth of conscience consultation during integrity analysis.
 *
 * - "surface": Only BOUNDARY values checked (fast path for clearly benign thinking)
 * - "standard": BOUNDARY and FEAR values checked (default)
 * - "deep": All value types checked including contextual evaluation (used when initial analysis is ambiguous)
 */
export type ConsultationDepth = "surface" | "standard" | "deep";

/**
 * Context produced by the conscience consultation during integrity analysis.
 *
 * Records which conscience values were checked, which conflicted or
 * supported the thinking block, and any additional considerations.
 */
export interface ConscienceContext {
  /** Conscience values that were checked during analysis */
  values_checked: string[];

  /** Conscience values that conflicted with the thinking block */
  conflicts: string[];

  /** Conscience values that the thinking block was consistent with */
  supports: string[];

  /** Considerations the analysis LLM noted (free-form observations) */
  considerations: string[];

  /** Depth of conscience consultation */
  consultation_depth: ConsultationDepth;
}
