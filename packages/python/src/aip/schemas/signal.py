"""Integrity signal types — mirrors schemas/signal.ts."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from aip.schemas.checkpoint import IntegrityCheckpoint

RecommendedAction = Literal[
    "continue",
    "log_and_continue",
    "pause_for_review",
    "deny_and_escalate",
]


@dataclass
class VerdictCounts:
    clear: int = 0
    review_needed: int = 0
    boundary_violation: int = 0


@dataclass
class WindowSummary:
    size: int
    max_size: int
    verdicts: VerdictCounts
    integrity_ratio: float
    drift_alert_active: bool = False


@dataclass
class IntegritySignal:
    checkpoint: IntegrityCheckpoint
    proceed: bool
    recommended_action: RecommendedAction
    window_summary: WindowSummary
