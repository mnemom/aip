/**
 * Card summary extraction for the conscience prompt.
 *
 * Compresses an AlignmentCard into ~500 tokens for inclusion
 * in the conscience prompt sent to the analysis LLM.
 *
 * Format follows SPEC Section 6.2.
 */

import type { AlignmentCard } from "../schemas/config.js";

/**
 * Summarize an AlignmentCard for inclusion in the conscience prompt.
 *
 * Format per SPEC Section 6.2 (extended):
 * ```
 * ALIGNMENT CARD SUMMARY (card_id: {card_id})
 * Agent: {agent_description}
 * Values (priority order):
 *   - {name}: {description}
 *   - {name}
 * Bounded actions: {comma-separated list}
 * Forbidden actions: {comma-separated list}
 * Escalation triggers:
 *   - {condition} -> {action}: {reason}
 * ```
 *
 * MUST include: values, bounded_actions, forbidden_actions, escalation_triggers
 * SHOULD include: agent_description, value descriptions (when available)
 * MUST omit: principal, audit_commitment, extensions (PII risk)
 */
export function summarizeCard(card: AlignmentCard): string {
  const lines: string[] = [];

  // Header with card_id
  lines.push(`ALIGNMENT CARD SUMMARY (card_id: ${card.card_id})`);

  // Agent description (if available)
  if (card.agent_description) {
    lines.push(`Agent: ${card.agent_description}`);
  }

  // Values sorted by priority (ascending = highest priority first)
  const sortedValues = [...card.values].sort((a, b) => a.priority - b.priority);
  if (sortedValues.some((v) => v.description)) {
    // At least one value has a description — use expanded format
    lines.push("Values (priority order):");
    for (const v of sortedValues) {
      if (v.description) {
        lines.push(`  - ${v.name}: ${v.description}`);
      } else {
        lines.push(`  - ${v.name}`);
      }
    }
  } else {
    // No descriptions — use compact comma-separated format
    const valueNames = sortedValues.map((v) => v.name);
    lines.push(`Values (priority order): ${valueNames.join(", ")}`);
  }

  // Bounded actions
  const bounded = card.autonomy_envelope.bounded_actions;
  if (bounded && bounded.length > 0) {
    lines.push(`Bounded actions: ${bounded.join(", ")}`);
  } else {
    lines.push("Bounded actions: none declared");
  }

  // Forbidden actions
  const forbidden = card.autonomy_envelope.forbidden_actions;
  if (forbidden && forbidden.length > 0) {
    lines.push(`Forbidden actions: ${forbidden.join(", ")}`);
  } else {
    lines.push("Forbidden actions: none declared");
  }

  // Escalation triggers
  const triggers = card.autonomy_envelope.escalation_triggers;
  if (triggers && triggers.length > 0) {
    lines.push("Escalation triggers:");
    for (const trigger of triggers) {
      const reason = trigger.reason ? `: ${trigger.reason}` : "";
      lines.push(`  - ${trigger.condition} \u2192 ${trigger.action}${reason}`);
    }
  } else {
    lines.push("Escalation triggers: none declared");
  }

  return lines.join("\n");
}
