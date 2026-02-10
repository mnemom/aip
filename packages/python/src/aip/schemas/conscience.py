"""Conscience value types — mirrors schemas/conscience.ts."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal

ConscienceValueType = Literal["BOUNDARY", "FEAR", "COMMITMENT", "BELIEF", "HOPE"]

ConsultationDepth = Literal["surface", "standard", "deep"]

VALID_CONSULTATION_DEPTHS: set[str] = {"surface", "standard", "deep"}


@dataclass
class ConscienceValue:
    type: ConscienceValueType
    content: str
    id: str | None = None


@dataclass
class ConscienceContext:
    values_checked: list[str] = field(default_factory=list)
    conflicts: list[str] = field(default_factory=list)
    supports: list[str] = field(default_factory=list)
    considerations: list[str] = field(default_factory=list)
    consultation_depth: ConsultationDepth = "standard"
