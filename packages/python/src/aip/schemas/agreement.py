"""Card-conscience agreement types — mirrors schemas/agreement.ts."""

from __future__ import annotations

from dataclasses import dataclass, field

from aip.schemas.conscience import ConscienceValue


@dataclass
class CardConscienceConflict:
    conscience_value: ConscienceValue
    card_field: str
    description: str


@dataclass
class CardConscienceAugmentation:
    conscience_value: ConscienceValue
    augments: str
    description: str


@dataclass
class CardConscienceAgreement:
    valid: bool
    card_id: str
    conscience_value_count: int
    conflicts: list[CardConscienceConflict] = field(default_factory=list)
    augmentations: list[CardConscienceAugmentation] = field(default_factory=list)
    validated_at: str = ""
