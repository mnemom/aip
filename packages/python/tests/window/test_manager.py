"""Tests for the window manager.

Port of packages/typescript/test/window/manager.test.ts
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from aip.schemas.config import WindowConfig
from aip.window.manager import WindowManager
from tests.conftest import make_checkpoint

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def default_config(**overrides) -> WindowConfig:
    defaults = {
        "max_size": 5,
        "mode": "sliding",
        "session_boundary": "reset",
        "max_age_seconds": 3600,
    }
    defaults.update(overrides)
    return WindowConfig(**defaults)


# ---------------------------------------------------------------------------
# Constructor
# ---------------------------------------------------------------------------


class TestWindowManagerConstructor:
    """WindowManager -- constructor."""

    def test_throws_if_max_size_lt_min_window_size_3(self) -> None:
        try:
            WindowManager(default_config(max_size=2), "session-1")
            assert False, "Expected ValueError"
        except ValueError as e:
            assert "Window max_size must be >= 3, got 2" in str(e)

    def test_accepts_max_size_equal_to_min_window_size(self) -> None:
        # Should not raise
        WindowManager(default_config(max_size=3), "session-1")


# ---------------------------------------------------------------------------
# push (basic)
# ---------------------------------------------------------------------------


class TestPushBasic:
    """WindowManager -- push (basic)."""

    def test_pushing_a_checkpoint_increases_size(self) -> None:
        wm = WindowManager(default_config(), "session-1")
        wm.push(make_checkpoint({"session_id": "session-1"}))
        state = wm.get_state()
        assert state.size == 1
        assert len(state.checkpoints) == 1
        assert state.stats.total_checks == 1


# ---------------------------------------------------------------------------
# push (sliding eviction)
# ---------------------------------------------------------------------------


class TestPushSlidingEviction:
    """WindowManager -- push (sliding eviction)."""

    def test_evicts_oldest_checkpoint_when_window_exceeds_max_size_sliding(self) -> None:
        wm = WindowManager(
            default_config(max_size=3, mode="sliding"),
            "session-1",
        )

        cp1 = make_checkpoint({"reasoning_summary": "First", "session_id": "session-1"})
        cp2 = make_checkpoint({"reasoning_summary": "Second", "session_id": "session-1"})
        cp3 = make_checkpoint({"reasoning_summary": "Third", "session_id": "session-1"})
        cp4 = make_checkpoint({"reasoning_summary": "Fourth", "session_id": "session-1"})

        wm.push(cp1)
        wm.push(cp2)
        wm.push(cp3)
        wm.push(cp4)

        state = wm.get_state()
        assert state.size == 3
        assert state.checkpoints[0].reasoning_summary == "Second"
        assert state.checkpoints[1].reasoning_summary == "Third"
        assert state.checkpoints[2].reasoning_summary == "Fourth"
        assert state.stats.total_checks == 4


# ---------------------------------------------------------------------------
# push (fixed mode)
# ---------------------------------------------------------------------------


class TestPushFixedMode:
    """WindowManager -- push (fixed mode)."""

    def test_resets_window_when_max_size_reached_in_fixed_mode(self) -> None:
        wm = WindowManager(
            default_config(max_size=3, mode="fixed"),
            "session-1",
        )

        cp1 = make_checkpoint({"reasoning_summary": "First", "session_id": "session-1"})
        cp2 = make_checkpoint({"reasoning_summary": "Second", "session_id": "session-1"})
        cp3 = make_checkpoint({"reasoning_summary": "Third", "session_id": "session-1"})
        cp4 = make_checkpoint({"reasoning_summary": "Fourth", "session_id": "session-1"})

        wm.push(cp1)
        wm.push(cp2)
        wm.push(cp3)
        # Window is full (3). Next push triggers reset then insert.
        wm.push(cp4)

        state = wm.get_state()
        assert state.size == 1
        assert state.checkpoints[0].reasoning_summary == "Fourth"
        assert state.stats.total_checks == 4


# ---------------------------------------------------------------------------
# push (max_age eviction)
# ---------------------------------------------------------------------------


class TestPushMaxAgeEviction:
    """WindowManager -- push (max_age eviction)."""

    def test_evicts_checkpoints_older_than_max_age_seconds(self) -> None:
        wm = WindowManager(
            default_config(max_size=5, max_age_seconds=60),
            "session-1",
        )

        # Create a checkpoint with a timestamp 120 seconds in the past
        old_timestamp = (datetime.now(timezone.utc) - timedelta(seconds=120)).isoformat()
        old_cp = make_checkpoint({
            "timestamp": old_timestamp,
            "reasoning_summary": "Old",
            "session_id": "session-1",
        })
        fresh_cp = make_checkpoint({
            "reasoning_summary": "Fresh",
            "session_id": "session-1",
        })

        wm.push(old_cp)
        assert wm.get_state().size == 1

        # Pushing a new checkpoint triggers stale eviction first
        wm.push(fresh_cp)

        state = wm.get_state()
        assert state.size == 1
        assert state.checkpoints[0].reasoning_summary == "Fresh"


# ---------------------------------------------------------------------------
# push (session boundary reset)
# ---------------------------------------------------------------------------


class TestPushSessionBoundaryReset:
    """WindowManager -- push (session boundary reset)."""

    def test_resets_window_when_session_id_changes_and_mode_is_reset(self) -> None:
        wm = WindowManager(
            default_config(session_boundary="reset"),
            "session-1",
        )

        wm.push(make_checkpoint({"session_id": "session-1"}))
        wm.push(make_checkpoint({"session_id": "session-1"}))
        assert wm.get_state().size == 2

        # Push with different session_id triggers reset
        wm.push(make_checkpoint({"session_id": "session-2"}))

        state = wm.get_state()
        assert state.size == 1
        assert wm.get_session_id() == "session-2"


# ---------------------------------------------------------------------------
# push (session boundary carry)
# ---------------------------------------------------------------------------


class TestPushSessionBoundaryCarry:
    """WindowManager -- push (session boundary carry)."""

    def test_preserves_window_when_session_id_changes_and_mode_is_carry(self) -> None:
        wm = WindowManager(
            default_config(session_boundary="carry"),
            "session-1",
        )

        wm.push(make_checkpoint({"session_id": "session-1"}))
        wm.push(make_checkpoint({"session_id": "session-1"}))
        assert wm.get_state().size == 2

        # Push with different session_id does NOT reset
        wm.push(make_checkpoint({"session_id": "session-2"}))

        state = wm.get_state()
        assert state.size == 3
        assert wm.get_session_id() == "session-2"


# ---------------------------------------------------------------------------
# getContext
# ---------------------------------------------------------------------------


class TestGetContext:
    """WindowManager -- getContext."""

    def test_returns_first_check_in_session_when_window_is_empty(self) -> None:
        wm = WindowManager(default_config(), "session-1")
        assert wm.get_context() == (
            "SESSION CONTEXT: First check in session (no prior context)"
        )

    def test_returns_numbered_verdict_list_with_checkpoints(self) -> None:
        wm = WindowManager(default_config(), "session-1")
        wm.push(make_checkpoint({
            "verdict": "clear",
            "reasoning_summary": "All good",
            "session_id": "session-1",
        }))
        wm.push(make_checkpoint({
            "verdict": "review_needed",
            "reasoning_summary": "Minor concern",
            "session_id": "session-1",
        }))

        context = wm.get_context()
        assert "SESSION CONTEXT (window: 2/5):" in context
        assert "1. [clear] All good" in context
        assert "2. [review_needed] Minor concern" in context


# ---------------------------------------------------------------------------
# getSummary
# ---------------------------------------------------------------------------


class TestGetSummary:
    """WindowManager -- getSummary."""

    def test_returns_correct_verdict_counts_and_integrity_ratio(self) -> None:
        wm = WindowManager(default_config(), "session-1")
        wm.push(make_checkpoint({"verdict": "clear", "session_id": "session-1"}))
        wm.push(make_checkpoint({"verdict": "clear", "session_id": "session-1"}))
        wm.push(make_checkpoint({"verdict": "review_needed", "session_id": "session-1"}))
        wm.push(make_checkpoint({"verdict": "boundary_violation", "session_id": "session-1"}))

        summary = wm.get_summary()
        assert summary.size == 4
        assert summary.max_size == 5
        assert summary.verdicts.clear == 2
        assert summary.verdicts.review_needed == 1
        assert summary.verdicts.boundary_violation == 1
        assert summary.integrity_ratio == 0.5
        assert summary.drift_alert_active is False

    def test_returns_integrity_ratio_of_1_0_for_empty_window(self) -> None:
        wm = WindowManager(default_config(), "session-1")
        summary = wm.get_summary()
        assert summary.size == 0
        assert summary.integrity_ratio == 1.0
        assert summary.verdicts.clear == 0
        assert summary.verdicts.review_needed == 0
        assert summary.verdicts.boundary_violation == 0


# ---------------------------------------------------------------------------
# reset
# ---------------------------------------------------------------------------


class TestReset:
    """WindowManager -- reset."""

    def test_clears_checkpoints_and_stats(self) -> None:
        wm = WindowManager(default_config(), "session-1")
        wm.push(make_checkpoint({"verdict": "clear", "session_id": "session-1"}))
        wm.push(make_checkpoint({"verdict": "review_needed", "session_id": "session-1"}))
        assert wm.get_state().size == 2

        wm.reset()

        state = wm.get_state()
        assert state.size == 0
        assert len(state.checkpoints) == 0
        assert state.stats.total_checks == 0
        assert state.stats.clear_count == 0
        assert state.stats.review_count == 0
        assert state.stats.violation_count == 0
        assert state.stats.avg_analysis_ms == 0


# ---------------------------------------------------------------------------
# stats
# ---------------------------------------------------------------------------


class TestStats:
    """WindowManager -- stats."""

    def test_computes_avg_analysis_ms_across_window_checkpoints(self) -> None:
        from aip.schemas.checkpoint import AnalysisMetadata

        wm = WindowManager(default_config(), "session-1")

        def _cp(duration: float):
            return make_checkpoint({
                "session_id": "session-1",
                "analysis_metadata": AnalysisMetadata(
                    analysis_model="claude-3-5-haiku-20241022",
                    analysis_duration_ms=duration,
                    thinking_tokens_original=500,
                    thinking_tokens_analyzed=500,
                    truncated=False,
                    extraction_confidence=1.0,
                ),
            })

        wm.push(_cp(100))
        wm.push(_cp(200))
        wm.push(_cp(300))

        state = wm.get_state()
        assert state.stats.avg_analysis_ms == 200
