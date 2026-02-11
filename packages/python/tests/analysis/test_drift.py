"""Tests for integrity drift detection.

Port of packages/typescript/test/analysis/drift.test.ts
"""

from __future__ import annotations

from datetime import datetime

from aip.analysis.drift import create_drift_state, detect_integrity_drift
from aip.schemas.concern import ConcernCategory, IntegrityConcern
from tests.conftest import make_checkpoint

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def make_nonclear_checkpoint(
    category: ConcernCategory,
    checkpoint_id: str | None = None,
):
    """Build a checkpoint with a single concern of the given category."""
    overrides = {
        "verdict": "review_needed",
        "concerns": [
            IntegrityConcern(
                category=category,
                severity="medium",
                description=f"Test {category} concern",
                evidence="some evidence",
                relevant_card_field=None,
                relevant_conscience_value=None,
            ),
        ],
    }
    if checkpoint_id is not None:
        overrides["checkpoint_id"] = checkpoint_id
    return make_checkpoint(overrides)


# ---------------------------------------------------------------------------
# Streak tracking
# ---------------------------------------------------------------------------


class TestStreakTracking:
    """detect_integrity_drift -- streak tracking."""

    def test_resets_sustained_count_to_zero_on_clear_verdict(self) -> None:
        state = create_drift_state()

        # Build up a non-clear streak
        nc1 = make_nonclear_checkpoint("prompt_injection")
        nc2 = make_nonclear_checkpoint("prompt_injection")
        state, _ = detect_integrity_drift(state, nc1, [nc1])
        state, _ = detect_integrity_drift(state, nc2, [nc1, nc2])
        assert state.sustained_nonclear == 2

        # Clear verdict resets
        clear = make_checkpoint({"verdict": "clear"})
        state, _ = detect_integrity_drift(state, clear, [nc1, nc2, clear])
        assert state.sustained_nonclear == 0
        assert state.alert_fired is False
        assert len(state.streak_checkpoint_ids) == 0
        assert len(state.streak_categories) == 0

    def test_increments_sustained_count_on_non_clear_verdict(self) -> None:
        state = create_drift_state()

        nc1 = make_nonclear_checkpoint("value_misalignment")
        state, _ = detect_integrity_drift(state, nc1, [nc1])
        assert state.sustained_nonclear == 1

        nc2 = make_nonclear_checkpoint("value_misalignment")
        state, _ = detect_integrity_drift(state, nc2, [nc1, nc2])
        assert state.sustained_nonclear == 2

    def test_resets_streak_after_clear_verdict_mid_streak(self) -> None:
        state = create_drift_state()

        # Two non-clear
        nc1 = make_nonclear_checkpoint("prompt_injection")
        nc2 = make_nonclear_checkpoint("prompt_injection")
        state, _ = detect_integrity_drift(state, nc1, [nc1])
        state, _ = detect_integrity_drift(state, nc2, [nc1, nc2])
        assert state.sustained_nonclear == 2

        # Clear resets
        clear = make_checkpoint({"verdict": "clear"})
        state, _ = detect_integrity_drift(state, clear, [])
        assert state.sustained_nonclear == 0

        # New non-clear starts fresh
        nc3 = make_nonclear_checkpoint("autonomy_violation")
        state, _ = detect_integrity_drift(state, nc3, [nc3])
        assert state.sustained_nonclear == 1


# ---------------------------------------------------------------------------
# Alert generation
# ---------------------------------------------------------------------------


class TestAlertGeneration:
    """detect_integrity_drift -- alert generation."""

    def test_does_not_fire_alert_below_threshold(self) -> None:
        state = create_drift_state()

        nc1 = make_nonclear_checkpoint("prompt_injection")
        nc2 = make_nonclear_checkpoint("prompt_injection")

        state, alert = detect_integrity_drift(state, nc1, [nc1])
        assert alert is None

        state, alert = detect_integrity_drift(state, nc2, [nc1, nc2])
        assert alert is None
        assert state.sustained_nonclear == 2

    def test_fires_alert_exactly_at_threshold_3_consecutive_non_clear(self) -> None:
        state = create_drift_state()

        nc1 = make_nonclear_checkpoint("prompt_injection")
        nc2 = make_nonclear_checkpoint("prompt_injection")
        nc3 = make_nonclear_checkpoint("prompt_injection")

        state, _ = detect_integrity_drift(state, nc1, [nc1])
        state, _ = detect_integrity_drift(state, nc2, [nc1, nc2])

        state, alert = detect_integrity_drift(state, nc3, [nc1, nc2, nc3])
        assert alert is not None
        assert state.alert_fired is True

    def test_fires_alert_only_once_per_streak(self) -> None:
        state = create_drift_state()

        ncs = [make_nonclear_checkpoint("prompt_injection") for _ in range(4)]

        state, _ = detect_integrity_drift(state, ncs[0], [ncs[0]])
        state, _ = detect_integrity_drift(state, ncs[1], [ncs[0], ncs[1]])
        state, alert = detect_integrity_drift(state, ncs[2], [ncs[0], ncs[1], ncs[2]])
        assert alert is not None

        # 4th non-clear should NOT fire another alert
        state, alert = detect_integrity_drift(
            state, ncs[3], [ncs[0], ncs[1], ncs[2], ncs[3]]
        )
        assert alert is None
        assert state.sustained_nonclear == 4

    def test_fires_new_alert_after_reset_and_build_up(self) -> None:
        state = create_drift_state()

        # First streak of 3 -> alert
        batch1 = [make_nonclear_checkpoint("prompt_injection") for _ in range(3)]
        state, _ = detect_integrity_drift(state, batch1[0], [batch1[0]])
        state, _ = detect_integrity_drift(state, batch1[1], [batch1[0], batch1[1]])
        state, alert = detect_integrity_drift(
            state, batch1[2], [batch1[0], batch1[1], batch1[2]]
        )
        assert alert is not None

        # Clear resets
        clear = make_checkpoint({"verdict": "clear"})
        state, _ = detect_integrity_drift(state, clear, [])
        assert state.alert_fired is False

        # Second streak of 3 -> new alert
        batch2 = [make_nonclear_checkpoint("value_misalignment") for _ in range(3)]
        state, _ = detect_integrity_drift(state, batch2[0], [batch2[0]])
        state, _ = detect_integrity_drift(state, batch2[1], [batch2[0], batch2[1]])
        state, alert = detect_integrity_drift(
            state, batch2[2], [batch2[0], batch2[1], batch2[2]]
        )
        assert alert is not None


# ---------------------------------------------------------------------------
# Severity derivation
# ---------------------------------------------------------------------------


class TestSeverityDerivation:
    """detect_integrity_drift -- severity derivation."""

    @staticmethod
    def _trigger_alert_with_window(window_checkpoints):
        state = create_drift_state()
        ncs = [make_nonclear_checkpoint("prompt_injection") for _ in range(3)]
        state, _ = detect_integrity_drift(state, ncs[0], window_checkpoints)
        state, _ = detect_integrity_drift(state, ncs[1], window_checkpoints)
        return detect_integrity_drift(state, ncs[2], window_checkpoints)

    def test_assigns_severity_low_when_integrity_similarity_ge_0_7(self) -> None:
        # 8 clear out of 10 => 0.8
        window = [
            *[make_checkpoint({"verdict": "clear"}) for _ in range(8)],
            *[make_nonclear_checkpoint("prompt_injection") for _ in range(2)],
        ]
        state, alert = self._trigger_alert_with_window(window)
        assert alert is not None
        assert alert.severity == "low"
        assert abs(alert.integrity_similarity - 0.8) < 0.01

    def test_assigns_severity_medium_when_integrity_similarity_between_0_4_and_0_7(self) -> None:
        # 5 clear out of 10 => 0.5
        window = [
            *[make_checkpoint({"verdict": "clear"}) for _ in range(5)],
            *[make_nonclear_checkpoint("prompt_injection") for _ in range(5)],
        ]
        state, alert = self._trigger_alert_with_window(window)
        assert alert is not None
        assert alert.severity == "medium"
        assert abs(alert.integrity_similarity - 0.5) < 0.01

    def test_assigns_severity_high_when_integrity_similarity_lt_0_4(self) -> None:
        # 1 clear out of 10 => 0.1
        window = [
            *[make_checkpoint({"verdict": "clear"}) for _ in range(1)],
            *[make_nonclear_checkpoint("prompt_injection") for _ in range(9)],
        ]
        state, alert = self._trigger_alert_with_window(window)
        assert alert is not None
        assert alert.severity == "high"
        assert abs(alert.integrity_similarity - 0.1) < 0.01


# ---------------------------------------------------------------------------
# Direction inference
# ---------------------------------------------------------------------------


class TestDirectionInference:
    """detect_integrity_drift -- direction inference."""

    @staticmethod
    def _trigger_alert_with_categories(categories: list[ConcernCategory]):
        state = create_drift_state()
        window = []

        for cat in categories:
            cp = make_nonclear_checkpoint(cat)
            window.append(cp)
            state, alert = detect_integrity_drift(state, cp, window)
            if alert is not None:
                return state, alert

        # If categories.length < threshold, pad to reach threshold
        while state.sustained_nonclear < 3:
            last_cat = categories[-1]
            cp = make_nonclear_checkpoint(last_cat)
            window.append(cp)
            state, alert = detect_integrity_drift(state, cp, window)
            if alert is not None:
                return state, alert

        return state, None

    def test_infers_injection_pattern_from_majority_prompt_injection(self) -> None:
        _, alert = self._trigger_alert_with_categories([
            "prompt_injection", "prompt_injection", "prompt_injection"
        ])
        assert alert is not None
        assert alert.drift_direction == "injection_pattern"

    def test_infers_value_erosion_from_majority_value_misalignment(self) -> None:
        _, alert = self._trigger_alert_with_categories([
            "value_misalignment", "value_misalignment", "value_misalignment"
        ])
        assert alert is not None
        assert alert.drift_direction == "value_erosion"

    def test_infers_autonomy_creep_from_majority_autonomy_violation(self) -> None:
        _, alert = self._trigger_alert_with_categories([
            "autonomy_violation", "autonomy_violation", "autonomy_violation"
        ])
        assert alert is not None
        assert alert.drift_direction == "autonomy_creep"

    def test_infers_deception_pattern_from_majority_deceptive_reasoning(self) -> None:
        _, alert = self._trigger_alert_with_categories([
            "deceptive_reasoning", "deceptive_reasoning", "deceptive_reasoning"
        ])
        assert alert is not None
        assert alert.drift_direction == "deception_pattern"

    def test_returns_unknown_when_no_majority_exists(self) -> None:
        # Three different categories -- no strict majority
        _, alert = self._trigger_alert_with_categories([
            "prompt_injection", "value_misalignment", "autonomy_violation"
        ])
        assert alert is not None
        assert alert.drift_direction == "unknown"

    def test_returns_unknown_for_even_split_of_categories(self) -> None:
        # Even split: 2 prompt_injection, 2 value_misalignment (using threshold=4)
        state = create_drift_state()
        window = []

        cats: list[ConcernCategory] = [
            "prompt_injection",
            "prompt_injection",
            "value_misalignment",
            "value_misalignment",
        ]

        alert = None
        for cat in cats:
            cp = make_nonclear_checkpoint(cat)
            window.append(cp)
            state, result_alert = detect_integrity_drift(state, cp, window, 4)
            if result_alert is not None:
                alert = result_alert

        assert alert is not None
        assert alert.drift_direction == "unknown"


# ---------------------------------------------------------------------------
# Alert structure
# ---------------------------------------------------------------------------


class TestAlertStructure:
    """detect_integrity_drift -- alert structure."""

    @staticmethod
    def _trigger_alert():
        state = create_drift_state()
        ncs = [
            make_nonclear_checkpoint("prompt_injection", f"ic-streak-{i}")
            for i in range(3)
        ]
        state, _ = detect_integrity_drift(state, ncs[0], ncs)
        state, _ = detect_integrity_drift(state, ncs[1], ncs)
        return detect_integrity_drift(state, ncs[2], ncs)

    def test_alert_id_starts_with_ida(self) -> None:
        _, alert = self._trigger_alert()
        assert alert is not None
        assert alert.alert_id.startswith("ida-")

    def test_checkpoint_ids_contains_all_streak_checkpoint_ids(self) -> None:
        _, alert = self._trigger_alert()
        assert alert is not None
        assert "ic-streak-0" in alert.checkpoint_ids
        assert "ic-streak-1" in alert.checkpoint_ids
        assert "ic-streak-2" in alert.checkpoint_ids
        assert len(alert.checkpoint_ids) == 3

    def test_sustained_checks_matches_streak_length(self) -> None:
        _, alert = self._trigger_alert()
        assert alert is not None
        assert alert.sustained_checks == 3

    def test_alert_type_is_informative(self) -> None:
        _, alert = self._trigger_alert()
        assert alert is not None
        assert alert.alert_type == "informative"

    def test_message_is_a_descriptive_string(self) -> None:
        _, alert = self._trigger_alert()
        assert alert is not None
        assert isinstance(alert.message, str)
        assert len(alert.message) > 0
        assert "consecutive" in alert.message

    def test_detection_timestamp_is_valid_iso_8601(self) -> None:
        from datetime import timezone

        before = datetime.now(timezone.utc).isoformat()
        _, alert = self._trigger_alert()
        after = datetime.now(timezone.utc).isoformat()

        assert alert is not None
        parsed = datetime.fromisoformat(alert.detection_timestamp)
        assert parsed.isoformat() is not None
        assert alert.detection_timestamp >= before
        assert alert.detection_timestamp <= after


# ---------------------------------------------------------------------------
# Custom threshold
# ---------------------------------------------------------------------------


class TestCustomThreshold:
    """detect_integrity_drift -- custom threshold."""

    def test_fires_alert_after_2_non_clear_checks_with_threshold_2(self) -> None:
        state = create_drift_state()

        nc1 = make_nonclear_checkpoint("prompt_injection")
        nc2 = make_nonclear_checkpoint("prompt_injection")

        state, alert = detect_integrity_drift(state, nc1, [nc1], 2)
        assert alert is None

        state, alert = detect_integrity_drift(state, nc2, [nc1, nc2], 2)
        assert alert is not None
        assert alert.sustained_checks == 2


# ---------------------------------------------------------------------------
# create_drift_state
# ---------------------------------------------------------------------------


class TestCreateDriftState:
    """Tests for create_drift_state."""

    def test_returns_fresh_state_with_all_counters_at_zero(self) -> None:
        state = create_drift_state()
        assert state.sustained_nonclear == 0
        assert state.alert_fired is False
        assert len(state.streak_checkpoint_ids) == 0
        assert len(state.streak_categories) == 0
