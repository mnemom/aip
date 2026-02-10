"""Integrity concern types — mirrors schemas/concern.ts."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

ConcernCategory = Literal[
    "prompt_injection",
    "value_misalignment",
    "autonomy_violation",
    "reasoning_corruption",
    "deceptive_reasoning",
    "undeclared_intent",
]

VALID_CONCERN_CATEGORIES: set[str] = {
    "prompt_injection",
    "value_misalignment",
    "autonomy_violation",
    "reasoning_corruption",
    "deceptive_reasoning",
    "undeclared_intent",
}

IntegritySeverity = Literal["low", "medium", "high", "critical"]

VALID_SEVERITIES: set[str] = {"low", "medium", "high", "critical"}


@dataclass
class IntegrityConcern:
    category: ConcernCategory
    severity: IntegritySeverity
    description: str
    evidence: str
    relevant_card_field: str | None
    relevant_conscience_value: str | None
