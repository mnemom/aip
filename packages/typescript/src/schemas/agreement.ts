/**
 * Card-Conscience Agreement types for the Agent Integrity Protocol.
 *
 * The Card-Conscience Agreement validates that conscience values are
 * compatible with the Alignment Card. This validation is performed
 * once at initialization, not at runtime.
 */

import type { ConscienceValue } from "./conscience";

/**
 * A blocking conflict between a conscience value and the Alignment Card.
 *
 * Conflicts occur when a BOUNDARY conscience value prohibits an action
 * that is listed in the card's bounded_actions. Conflicts MUST fail
 * initialization.
 */
export interface CardConscienceConflict {
  /** The conflicting conscience value */
  conscience_value: ConscienceValue;

  /** The card field it conflicts with */
  card_field: string;

  /** Description of the conflict */
  description: string;
}

/**
 * A non-blocking augmentation where a conscience value enhances
 * the Alignment Card's coverage.
 *
 * Augmentations occur when a FEAR conscience value maps to an
 * escalation trigger, increasing detection sensitivity.
 */
export interface CardConscienceAugmentation {
  /** The augmenting conscience value */
  conscience_value: ConscienceValue;

  /** What it augments (e.g., "escalation_triggers") */
  augments: string;

  /** Description of the augmentation */
  description: string;
}

/**
 * Result of validating conscience values against an Alignment Card.
 *
 * Computed at initialization time. If any conflicts exist, the agreement
 * is invalid and initialization MUST fail.
 */
export interface CardConscienceAgreement {
  /** Whether the agreement is valid (no conflicts) */
  valid: boolean;

  /** Card ID that was validated */
  card_id: string;

  /** Number of conscience values evaluated */
  conscience_value_count: number;

  /** Blocking conflicts found (BOUNDARY vs bounded_actions) */
  conflicts: CardConscienceConflict[];

  /** Non-blocking augmentations (FEAR values that enhance coverage) */
  augmentations: CardConscienceAugmentation[];

  /** When validation was performed (ISO 8601) */
  validated_at: string;
}
