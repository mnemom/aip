"""Card summary extraction for the conscience prompt.

Compresses an AlignmentCard into ~500 tokens for inclusion
in the conscience prompt sent to the analysis LLM.

Format follows SPEC Section 6.2.

Port of packages/typescript/src/analysis/card-summary.ts
"""

from __future__ import annotations

from aip.schemas.config import AlignmentCard


def summarize_card(card: AlignmentCard) -> str:
    """Summarize an AlignmentCard for inclusion in the conscience prompt.

    Format per SPEC Section 6.2 (extended)::

        ALIGNMENT CARD SUMMARY (card_id: {card_id})
        Agent: {agent_description}
        Values (priority order):
          - {name}: {description}
          - {name}
        Bounded actions: {comma-separated list}
        Forbidden actions: {comma-separated list}
        Escalation triggers:
          - {condition} -> {action}: {reason}

    MUST include: values, bounded_actions, forbidden_actions, escalation_triggers
    SHOULD include: agent_description, value descriptions (when available)
    MUST omit: principal, audit_commitment, extensions (PII risk)
    """
    lines: list[str] = []

    # Header with card_id
    lines.append(f"ALIGNMENT CARD SUMMARY (card_id: {card.card_id})")

    # Agent description (if available)
    if card.agent_description:
        lines.append(f"Agent: {card.agent_description}")

    # Values sorted by priority (ascending = highest priority first)
    sorted_values = sorted(card.values, key=lambda v: v.priority)
    if any(v.description for v in sorted_values):
        # At least one value has a description — use expanded format
        lines.append("Values (priority order):")
        for v in sorted_values:
            if v.description:
                lines.append(f"  - {v.name}: {v.description}")
            else:
                lines.append(f"  - {v.name}")
    else:
        # No descriptions — use compact comma-separated format
        value_names = [v.name for v in sorted_values]
        lines.append(f"Values (priority order): {', '.join(value_names)}")

    # Bounded actions
    bounded = card.autonomy_envelope.bounded_actions
    if bounded and len(bounded) > 0:
        lines.append(f"Bounded actions: {', '.join(bounded)}")
    else:
        lines.append("Bounded actions: none declared")

    # Forbidden actions
    forbidden = card.autonomy_envelope.forbidden_actions
    if forbidden and len(forbidden) > 0:
        lines.append(f"Forbidden actions: {', '.join(forbidden)}")
    else:
        lines.append("Forbidden actions: none declared")

    # Escalation triggers
    triggers = card.autonomy_envelope.escalation_triggers
    if triggers and len(triggers) > 0:
        lines.append("Escalation triggers:")
        for trigger in triggers:
            reason = f": {trigger.reason}" if trigger.reason else ""
            lines.append(
                f"  - {trigger.condition} \u2192 {trigger.action}{reason}"
            )
    else:
        lines.append("Escalation triggers: none declared")

    return "\n".join(lines)
