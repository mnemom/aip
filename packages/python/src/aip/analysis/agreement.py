"""Card-Conscience Agreement validation for the Agent Integrity Protocol.

Validates that conscience values are compatible with the Alignment Card
at initialization time. If conflicts are found, initialization MUST fail.

Port of packages/typescript/src/analysis/agreement.ts
"""

from __future__ import annotations

from datetime import datetime, timezone

from aip.schemas.agreement import (
    CardConscienceAgreement,
    CardConscienceAugmentation,
    CardConscienceConflict,
)
from aip.schemas.config import AlignmentCard
from aip.schemas.conscience import ConscienceValue


def validate_agreement(
    card: AlignmentCard,
    conscience_values: list[ConscienceValue],
) -> CardConscienceAgreement:
    """Validate that conscience values are compatible with the alignment card.

    Called at AIP initialization.

    Conflict detection:
    - A BOUNDARY value that contradicts a bounded_action (e.g., BOUNDARY says
      "never write files" but bounded_actions includes "write_files")

    Augmentation detection:
    - A BOUNDARY/FEAR value that reinforces an escalation_trigger
    - A BOUNDARY value that matches a forbidden_action
    """
    conflicts: list[CardConscienceConflict] = []
    augmentations: list[CardConscienceAugmentation] = []

    for value in conscience_values:
        # Only check BOUNDARY and FEAR types (others are not injected)
        if value.type not in ("BOUNDARY", "FEAR"):
            continue

        content_lower = value.content.lower()

        # Check for conflicts: BOUNDARY contradicts bounded_actions
        if value.type == "BOUNDARY" and card.autonomy_envelope.bounded_actions:
            for action in card.autonomy_envelope.bounded_actions:
                if (
                    action.lower().replace("_", " ") in content_lower
                    or action.lower() in content_lower
                ):
                    # Check if the BOUNDARY says "never" or "no" + the action
                    # This is a potential conflict — card allows it, conscience forbids it
                    if (
                        "never" in content_lower
                        or "no " in content_lower
                        or "don't" in content_lower
                        or "do not" in content_lower
                    ):
                        conflicts.append(
                            CardConscienceConflict(
                                conscience_value=value,
                                card_field="autonomy_envelope.bounded_actions",
                                description=(
                                    f'BOUNDARY "{value.content}" conflicts with '
                                    f'bounded action "{action}"'
                                ),
                            )
                        )

        # Check for augmentations: value reinforces forbidden_actions
        if card.autonomy_envelope.forbidden_actions:
            for action in card.autonomy_envelope.forbidden_actions:
                if (
                    action.lower().replace("_", " ") in content_lower
                    or action.lower() in content_lower
                ):
                    augmentations.append(
                        CardConscienceAugmentation(
                            conscience_value=value,
                            augments="autonomy_envelope.forbidden_actions",
                            description=(
                                f'{value.type} "{value.content}" reinforces '
                                f'forbidden action "{action}"'
                            ),
                        )
                    )

        # Check for augmentations: value reinforces escalation_triggers
        if card.autonomy_envelope.escalation_triggers:
            for trigger in card.autonomy_envelope.escalation_triggers:
                if (
                    trigger.condition.lower().replace("_", " ") in content_lower
                    or trigger.condition.lower() in content_lower
                ):
                    augmentations.append(
                        CardConscienceAugmentation(
                            conscience_value=value,
                            augments="autonomy_envelope.escalation_triggers",
                            description=(
                                f'{value.type} "{value.content}" reinforces '
                                f'escalation trigger "{trigger.condition}"'
                            ),
                        )
                    )

    return CardConscienceAgreement(
        valid=len(conflicts) == 0,
        card_id=card.card_id,
        conscience_value_count=len(conscience_values),
        conflicts=conflicts,
        augmentations=augmentations,
        validated_at=datetime.now(timezone.utc).isoformat(),
    )
