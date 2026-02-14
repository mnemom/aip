"""Tests for EU AI Act Article 50 compliance presets in AIP."""

from __future__ import annotations

from aip.constants import (
    EU_COMPLIANCE_FAILURE_POLICY,
    EU_COMPLIANCE_WINDOW_CONFIG,
)
from aip.schemas import FailurePolicy, WindowConfig


class TestEUComplianceWindowConfig:
    """Tests for EU_COMPLIANCE_WINDOW_CONFIG preset."""

    def test_max_size_at_least_default(self):
        assert EU_COMPLIANCE_WINDOW_CONFIG["max_size"] >= 3

    def test_mode_is_sliding(self):
        assert EU_COMPLIANCE_WINDOW_CONFIG["mode"] == "sliding"

    def test_session_boundary_is_reset(self):
        assert EU_COMPLIANCE_WINDOW_CONFIG["session_boundary"] == "reset"

    def test_max_age_at_least_3600(self):
        """EU compliance requires at least the default 1-hour window."""
        assert EU_COMPLIANCE_WINDOW_CONFIG["max_age_seconds"] >= 3600

    def test_produces_valid_window_config(self):
        """Preset values produce a valid WindowConfig dataclass."""
        config = WindowConfig(**EU_COMPLIANCE_WINDOW_CONFIG)
        assert config.max_size == 10
        assert config.mode == "sliding"
        assert config.session_boundary == "reset"
        assert config.max_age_seconds == 7200


class TestEUComplianceFailurePolicy:
    """Tests for EU_COMPLIANCE_FAILURE_POLICY preset."""

    def test_mode_is_fail_closed(self):
        assert EU_COMPLIANCE_FAILURE_POLICY["mode"] == "fail_closed"

    def test_timeout_at_least_default(self):
        """EU compliance timeout should be at least the default 10s."""
        assert EU_COMPLIANCE_FAILURE_POLICY["analysis_timeout_ms"] >= 10000

    def test_produces_valid_failure_policy(self):
        """Preset values produce a valid FailurePolicy dataclass."""
        policy = FailurePolicy(**EU_COMPLIANCE_FAILURE_POLICY)
        assert policy.mode == "fail_closed"
        assert policy.analysis_timeout_ms == 15000


class TestPresetsProduceValidConfig:
    """Integration test: presets produce valid schema objects together."""

    def test_window_and_failure_together(self):
        config = WindowConfig(**EU_COMPLIANCE_WINDOW_CONFIG)
        policy = FailurePolicy(**EU_COMPLIANCE_FAILURE_POLICY)

        # Both should be usable together in an AIPConfig
        assert config.max_size == 10
        assert policy.mode == "fail_closed"

        # Extended values vs defaults
        assert config.max_age_seconds > 3600  # Extended beyond default
        assert policy.analysis_timeout_ms > 10000  # Extended beyond default
