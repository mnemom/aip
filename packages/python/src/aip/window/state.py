"""Window state types — mirrors packages/typescript/src/window/state.ts."""

from __future__ import annotations

from dataclasses import dataclass, field

from aip.schemas.checkpoint import IntegrityCheckpoint


@dataclass
class WindowStats:
    """Current statistics for the session window."""

    total_checks: int = 0
    """Total checks including evicted."""

    clear_count: int = 0
    """Clear verdicts in current window only."""

    review_count: int = 0
    """Review-needed verdicts in current window only."""

    violation_count: int = 0
    """Boundary-violation verdicts in current window only."""

    avg_analysis_ms: float = 0.0
    """Average analysis duration across current window."""


@dataclass
class WindowState:
    """Current state of the session window."""

    checkpoints: list[IntegrityCheckpoint] = field(default_factory=list)
    size: int = 0
    session_id: str = ""
    stats: WindowStats = field(default_factory=WindowStats)


def create_window_state(session_id: str) -> WindowState:
    """Create a fresh window state for the given session."""
    return WindowState(
        checkpoints=[],
        size=0,
        session_id=session_id,
        stats=WindowStats(),
    )
