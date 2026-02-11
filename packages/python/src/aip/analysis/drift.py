"""Integrity drift detection for the Agent Integrity Protocol.

Monitors the pattern of integrity verdicts over a session and raises
an IntegrityDriftAlert when consecutive non-clear verdicts exceed
the sustained checks threshold (SPEC Section 9.1).

Port of packages/typescript/src/analysis/drift.ts
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from uuid import uuid4

from aip.constants import (
    DEFAULT_SUSTAINED_CHECKS_THRESHOLD,
    DRIFT_ALERT_ID_PREFIX,
    DRIFT_SEVERITY_LOW_THRESHOLD,
    DRIFT_SEVERITY_MEDIUM_THRESHOLD,
)
from aip.schemas.checkpoint import IntegrityCheckpoint
from aip.schemas.drift_alert import DriftDirection, IntegrityDriftAlert

# ---------------------------------------------------------------------------
# Drift state
# ---------------------------------------------------------------------------


@dataclass
class DriftState:
    """Mutable state for tracking drift within a session."""

    sustained_nonclear: int = 0
    """Count of consecutive non-clear verdicts."""

    alert_fired: bool = False
    """Whether an alert has been fired for the current streak."""

    streak_checkpoint_ids: list[str] = field(default_factory=list)
    """Checkpoint IDs in the current non-clear streak."""

    streak_categories: list[str] = field(default_factory=list)
    """Concern categories in the current non-clear streak."""


def create_drift_state() -> DriftState:
    """Create fresh drift state."""
    return DriftState()


# ---------------------------------------------------------------------------
# Direction inference
# ---------------------------------------------------------------------------

_CATEGORY_TO_DIRECTION: dict[str, DriftDirection] = {
    "prompt_injection": "injection_pattern",
    "value_misalignment": "value_erosion",
    "autonomy_violation": "autonomy_creep",
    "deceptive_reasoning": "deception_pattern",
}


def _infer_drift_direction(categories: list[str]) -> DriftDirection:
    """Infer drift direction from the dominant concern category in the streak."""
    if not categories:
        return "unknown"

    counts: dict[str, int] = {}
    for cat in categories:
        counts[cat] = counts.get(cat, 0) + 1

    max_category: str | None = None
    max_count = 0
    for cat, count in counts.items():
        if count > max_count:
            max_count = count
            max_category = cat

    # Must be strict majority (> 50%)
    if max_category is not None and max_count > len(categories) / 2:
        return _CATEGORY_TO_DIRECTION.get(max_category, "unknown")

    return "unknown"


# ---------------------------------------------------------------------------
# Core function
# ---------------------------------------------------------------------------


def detect_integrity_drift(
    state: DriftState,
    checkpoint: IntegrityCheckpoint,
    window_checkpoints: list[IntegrityCheckpoint],
    threshold: int | None = None,
) -> tuple[DriftState, IntegrityDriftAlert | None]:
    """Update drift state with a new checkpoint and optionally produce a drift alert.

    Algorithm (SPEC Section 9.1):
    1. If verdict == "clear": reset sustained_nonclear to 0, alert_fired to False, clear streak
    2. If verdict != "clear": increment sustained_nonclear, record checkpoint ID, collect concern categories
    3. When sustained_nonclear >= threshold (default 3) AND not alert_fired:
       - Generate IntegrityDriftAlert
       - Set alert_fired = True (no more alerts until streak resets)
    4. Compute integrity_similarity from window checkpoints (clear_count / total)
    5. Derive severity from integrity_similarity:
       - >= 0.7: "low"
       - >= 0.4: "medium"
       - < 0.4: "high"
    6. Infer drift_direction from dominant ConcernCategory in streak

    Returns:
        Tuple of (updated DriftState, IntegrityDriftAlert or None).
    """
    effective_threshold = (
        threshold if threshold is not None else DEFAULT_SUSTAINED_CHECKS_THRESHOLD
    )

    # Clone state to avoid mutation
    new_state = DriftState(
        sustained_nonclear=state.sustained_nonclear,
        alert_fired=state.alert_fired,
        streak_checkpoint_ids=list(state.streak_checkpoint_ids),
        streak_categories=list(state.streak_categories),
    )

    if checkpoint.verdict == "clear":
        # Reset streak
        new_state.sustained_nonclear = 0
        new_state.alert_fired = False
        new_state.streak_checkpoint_ids = []
        new_state.streak_categories = []
        return (new_state, None)

    # Non-clear verdict — extend streak
    new_state.sustained_nonclear += 1
    new_state.streak_checkpoint_ids.append(checkpoint.checkpoint_id)
    for concern in checkpoint.concerns:
        new_state.streak_categories.append(concern.category)

    # Check if threshold crossed and no alert fired yet
    if (
        new_state.sustained_nonclear >= effective_threshold
        and not new_state.alert_fired
    ):
        new_state.alert_fired = True

        # Compute integrity_similarity from window
        clear_count = sum(
            1 for cp in window_checkpoints if cp.verdict == "clear"
        )
        total_count = len(window_checkpoints)
        integrity_similarity = (
            clear_count / total_count if total_count > 0 else 0.0
        )

        # Derive severity
        if integrity_similarity >= DRIFT_SEVERITY_LOW_THRESHOLD:
            severity: str = "low"
        elif integrity_similarity >= DRIFT_SEVERITY_MEDIUM_THRESHOLD:
            severity = "medium"
        else:
            severity = "high"

        # Infer direction from dominant category
        direction = _infer_drift_direction(new_state.streak_categories)

        alert = IntegrityDriftAlert(
            alert_id=f"{DRIFT_ALERT_ID_PREFIX}{uuid4()}",
            agent_id=checkpoint.agent_id,
            session_id=checkpoint.session_id,
            checkpoint_ids=list(new_state.streak_checkpoint_ids),
            integrity_similarity=integrity_similarity,
            sustained_checks=new_state.sustained_nonclear,
            alert_type="informative",
            severity=severity,  # type: ignore[arg-type]
            drift_direction=direction,
            message=(
                f"{new_state.sustained_nonclear} consecutive integrity concerns "
                f"detected. Dominant pattern: {direction}. "
                f"Integrity ratio: {integrity_similarity * 100:.0f}%."
            ),
            detection_timestamp=datetime.now(timezone.utc).isoformat(),
        )

        return (new_state, alert)

    return (new_state, None)
