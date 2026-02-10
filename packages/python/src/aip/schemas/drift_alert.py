"""Integrity drift alert types — mirrors schemas/drift-alert.ts."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal

DriftDirection = Literal[
    "injection_pattern",
    "value_erosion",
    "autonomy_creep",
    "deception_pattern",
    "unknown",
]


@dataclass
class IntegrityDriftAlert:
    alert_id: str
    agent_id: str
    session_id: str
    checkpoint_ids: list[str]
    integrity_similarity: float
    sustained_checks: int
    alert_type: Literal["informative"]
    severity: Literal["low", "medium", "high"]
    drift_direction: DriftDirection
    message: str
    detection_timestamp: str
