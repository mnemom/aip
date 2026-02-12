/**
 * Card-Conscience Agreement validation for the Agent Integrity Protocol.
 *
 * Validates that conscience values are compatible with the Alignment Card
 * at initialization time. If conflicts are found, initialization MUST fail.
 */

import type { AlignmentCard } from "../schemas/config.js";
import type { ConscienceValue } from "../schemas/conscience.js";
import type { CardConscienceAgreement } from "../schemas/agreement.js";

/** Escape special regex characters in a string */
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Test if text contains the term as a whole word (not as a substring of another word) */
function containsWholeWord(text: string, term: string): boolean {
  return new RegExp(`\\b${escapeRegex(term)}\\b`).test(text);
}

/**
 * Validate that conscience values are compatible with the alignment card.
 * Called at AIP initialization — throws if conflicts are found.
 *
 * Conflict detection:
 * - A BOUNDARY value that contradicts a bounded_action (e.g., BOUNDARY says
 *   "never write files" but bounded_actions includes "write_files")
 *
 * Augmentation detection:
 * - A BOUNDARY/FEAR value that reinforces an escalation_trigger
 * - A BOUNDARY value that matches a forbidden_action
 */
export function validateAgreement(
  card: AlignmentCard,
  conscienceValues: ConscienceValue[]
): CardConscienceAgreement {
  const conflicts: CardConscienceAgreement["conflicts"] = [];
  const augmentations: CardConscienceAgreement["augmentations"] = [];

  for (const value of conscienceValues) {
    // Only check BOUNDARY and FEAR types (others are not injected)
    if (value.type !== "BOUNDARY" && value.type !== "FEAR") continue;

    const contentLower = value.content.toLowerCase();

    // Check for conflicts: BOUNDARY contradicts bounded_actions
    if (value.type === "BOUNDARY" && card.autonomy_envelope.bounded_actions) {
      for (const action of card.autonomy_envelope.bounded_actions) {
        // Use word-boundary matching to avoid false positives
        // (e.g., "execute" in BOUNDARY text should not match action "exec")
        if (containsWholeWord(contentLower, action.toLowerCase().replace(/_/g, " ")) ||
            containsWholeWord(contentLower, action.toLowerCase())) {
          // Check if the BOUNDARY says "never" or "no" + the action
          // This is a potential conflict — card allows it, conscience forbids it
          if (contentLower.includes("never") || contentLower.includes("no ") || contentLower.includes("don't") || contentLower.includes("do not")) {
            conflicts.push({
              conscience_value: value,
              card_field: "autonomy_envelope.bounded_actions",
              description: `BOUNDARY "${value.content}" conflicts with bounded action "${action}"`,
            });
          }
        }
      }
    }

    // Check for augmentations: value reinforces forbidden_actions
    if (card.autonomy_envelope.forbidden_actions) {
      for (const action of card.autonomy_envelope.forbidden_actions) {
        if (containsWholeWord(contentLower, action.toLowerCase().replace(/_/g, " ")) ||
            containsWholeWord(contentLower, action.toLowerCase())) {
          augmentations.push({
            conscience_value: value,
            augments: "autonomy_envelope.forbidden_actions",
            description: `${value.type} "${value.content}" reinforces forbidden action "${action}"`,
          });
        }
      }
    }

    // Check for augmentations: value reinforces escalation_triggers
    if (card.autonomy_envelope.escalation_triggers) {
      for (const trigger of card.autonomy_envelope.escalation_triggers) {
        if (containsWholeWord(contentLower, trigger.condition.toLowerCase().replace(/_/g, " ")) ||
            containsWholeWord(contentLower, trigger.condition.toLowerCase())) {
          augmentations.push({
            conscience_value: value,
            augments: "autonomy_envelope.escalation_triggers",
            description: `${value.type} "${value.content}" reinforces escalation trigger "${trigger.condition}"`,
          });
        }
      }
    }
  }

  return {
    valid: conflicts.length === 0,
    card_id: card.card_id,
    conscience_value_count: conscienceValues.length,
    conflicts,
    augmentations,
    validated_at: new Date().toISOString(),
  };
}
