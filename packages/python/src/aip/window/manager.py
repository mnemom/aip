"""Window manager — mirrors packages/typescript/src/window/manager.ts."""

from __future__ import annotations

import copy
import time
from datetime import datetime

from aip.constants import MIN_WINDOW_SIZE
from aip.schemas.checkpoint import IntegrityCheckpoint
from aip.schemas.config import WindowConfig
from aip.schemas.signal import VerdictCounts, WindowSummary
from aip.window.state import WindowState, create_window_state


class WindowManager:
    """Manages the sliding/fixed integrity checkpoint window.

    Handles checkpoint storage, eviction (age + size), session boundaries,
    and produces window summaries for signal construction.
    """

    def __init__(self, config: WindowConfig, session_id: str) -> None:
        if config.max_size < MIN_WINDOW_SIZE:
            raise ValueError(
                f"Window max_size must be >= {MIN_WINDOW_SIZE}, "
                f"got {config.max_size}"
            )
        self._config = config
        self._state = create_window_state(session_id)

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def push(self, checkpoint: IntegrityCheckpoint) -> None:
        """Add a checkpoint to the window. Handles eviction per mode."""

        # 1. Check session boundary
        if checkpoint.session_id != self._state.session_id:
            if self._config.session_boundary == "reset":
                self.reset()
            self._state.session_id = checkpoint.session_id

        # 2. Evict stale checkpoints (older than max_age_seconds)
        self._evict_stale()

        # 3. If at max_size, handle eviction per mode
        if len(self._state.checkpoints) >= self._config.max_size:
            if self._config.mode == "sliding":
                self._state.checkpoints.pop(0)
            else:
                # fixed mode: reset entirely, then insert
                self._state.checkpoints = []

        # 4. Push checkpoint, increment total_checks
        self._state.checkpoints.append(checkpoint)
        self._state.stats.total_checks += 1

        # 5. Recompute window stats
        self._recompute_stats()

    def get_context(self) -> str:
        """Format window for conscience prompt (numbered verdict list)."""
        if len(self._state.checkpoints) == 0:
            return "SESSION CONTEXT: First check in session (no prior context)"

        lines = [
            f"{i + 1}. [{cp.verdict}] {cp.reasoning_summary}"
            for i, cp in enumerate(self._state.checkpoints)
        ]
        return (
            f"SESSION CONTEXT (window: {self._state.size}/{self._config.max_size}):\n"
            + "\n".join(lines)
        )

    def reset(self) -> None:
        """Clear all checkpoints and reset statistics."""
        self._state.checkpoints = []
        self._state.size = 0
        self._state.stats.total_checks = 0
        self._state.stats.clear_count = 0
        self._state.stats.review_count = 0
        self._state.stats.violation_count = 0
        self._state.stats.avg_analysis_ms = 0

    def get_summary(self) -> WindowSummary:
        """Get WindowSummary for IntegritySignal."""
        verdicts = VerdictCounts(clear=0, review_needed=0, boundary_violation=0)
        for cp in self._state.checkpoints:
            if cp.verdict == "clear":
                verdicts.clear += 1
            elif cp.verdict == "review_needed":
                verdicts.review_needed += 1
            elif cp.verdict == "boundary_violation":
                verdicts.boundary_violation += 1

        integrity_ratio = (
            verdicts.clear / self._state.size if self._state.size > 0 else 1.0
        )

        return WindowSummary(
            size=self._state.size,
            max_size=self._config.max_size,
            verdicts=verdicts,
            integrity_ratio=integrity_ratio,
            drift_alert_active=False,  # Set externally by drift detection
        )

    def get_state(self) -> WindowState:
        """Get full window state (for SDK get_window_state())."""
        return WindowState(
            checkpoints=list(self._state.checkpoints),
            size=self._state.size,
            session_id=self._state.session_id,
            stats=copy.copy(self._state.stats),
        )

    def get_session_id(self) -> str:
        """Get current session ID."""
        return self._state.session_id

    # ------------------------------------------------------------------
    # Private helpers
    # ------------------------------------------------------------------

    def _evict_stale(self) -> None:
        """Evict checkpoints older than max_age_seconds."""
        now = time.time()
        max_age = self._config.max_age_seconds
        self._state.checkpoints = [
            cp
            for cp in self._state.checkpoints
            if now - _parse_timestamp(cp.timestamp) <= max_age
        ]

    def _recompute_stats(self) -> None:
        """Recompute window-level stats from current checkpoints."""
        cps = self._state.checkpoints
        self._state.size = len(cps)
        self._state.stats.clear_count = 0
        self._state.stats.review_count = 0
        self._state.stats.violation_count = 0

        total_ms = 0.0
        for cp in cps:
            if cp.verdict == "clear":
                self._state.stats.clear_count += 1
            elif cp.verdict == "review_needed":
                self._state.stats.review_count += 1
            elif cp.verdict == "boundary_violation":
                self._state.stats.violation_count += 1
            total_ms += cp.analysis_metadata.analysis_duration_ms

        self._state.stats.avg_analysis_ms = (
            total_ms / len(cps) if len(cps) > 0 else 0
        )


def _parse_timestamp(timestamp: str) -> float:
    """Parse an ISO 8601 timestamp to a Unix timestamp (seconds)."""
    # Handle both 'Z' suffix and '+00:00' offset formats
    ts = timestamp.replace("Z", "+00:00")
    return datetime.fromisoformat(ts).timestamp()
