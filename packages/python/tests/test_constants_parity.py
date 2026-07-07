"""Cross-language constants parity test.

Reads schemas/constants.json (canonical source of truth for all shared AIP
constants) and verifies every constant in the Python SDK matches the spec value.
The parallel TypeScript test at packages/typescript/test/constants.test.ts
makes the same assertions against constants.ts. Both must pass for a change to
schemas/constants.json to land.
"""

from __future__ import annotations

import json
from pathlib import Path

import aip.constants as constants

_SPEC = json.loads(
    (Path(__file__).parents[3] / "schemas" / "constants.json").read_text()
)


class TestScalarConstants:
    def test_aip_version(self):
        assert _SPEC["AIP_VERSION"] == constants.AIP_VERSION

    def test_algorithm_version(self):
        assert _SPEC["ALGORITHM_VERSION"] == constants.ALGORITHM_VERSION

    def test_default_sustained_checks_threshold(self):
        assert _SPEC["DEFAULT_SUSTAINED_CHECKS_THRESHOLD"] == constants.DEFAULT_SUSTAINED_CHECKS_THRESHOLD

    def test_drift_severity_low_threshold(self):
        assert _SPEC["DRIFT_SEVERITY_LOW_THRESHOLD"] == constants.DRIFT_SEVERITY_LOW_THRESHOLD

    def test_drift_severity_medium_threshold(self):
        assert _SPEC["DRIFT_SEVERITY_MEDIUM_THRESHOLD"] == constants.DRIFT_SEVERITY_MEDIUM_THRESHOLD

    def test_default_thinking_token_budget(self):
        assert _SPEC["DEFAULT_THINKING_TOKEN_BUDGET"] == constants.DEFAULT_THINKING_TOKEN_BUDGET

    def test_default_output_token_budget(self):
        assert _SPEC["DEFAULT_OUTPUT_TOKEN_BUDGET"] == constants.DEFAULT_OUTPUT_TOKEN_BUDGET

    def test_truncation_head_ratio(self):
        assert _SPEC["TRUNCATION_HEAD_RATIO"] == constants.TRUNCATION_HEAD_RATIO

    def test_truncation_tail_ratio(self):
        assert _SPEC["TRUNCATION_TAIL_RATIO"] == constants.TRUNCATION_TAIL_RATIO

    def test_max_evidence_length(self):
        assert _SPEC["MAX_EVIDENCE_LENGTH"] == constants.MAX_EVIDENCE_LENGTH

    def test_default_min_evidence_tokens(self):
        assert _SPEC["DEFAULT_MIN_EVIDENCE_TOKENS"] == constants.DEFAULT_MIN_EVIDENCE_TOKENS

    def test_default_analysis_timeout_ms(self):
        assert _SPEC["DEFAULT_ANALYSIS_TIMEOUT_MS"] == constants.DEFAULT_ANALYSIS_TIMEOUT_MS

    def test_default_analysis_max_tokens(self):
        assert _SPEC["DEFAULT_ANALYSIS_MAX_TOKENS"] == constants.DEFAULT_ANALYSIS_MAX_TOKENS

    def test_default_window_max_size(self):
        assert _SPEC["DEFAULT_WINDOW_MAX_SIZE"] == constants.DEFAULT_WINDOW_MAX_SIZE

    def test_min_window_size(self):
        assert _SPEC["MIN_WINDOW_SIZE"] == constants.MIN_WINDOW_SIZE

    def test_default_window_max_age_seconds(self):
        assert _SPEC["DEFAULT_WINDOW_MAX_AGE_SECONDS"] == constants.DEFAULT_WINDOW_MAX_AGE_SECONDS

    def test_confidence_native(self):
        assert _SPEC["CONFIDENCE_NATIVE"] == constants.CONFIDENCE_NATIVE

    def test_confidence_explicit(self):
        assert _SPEC["CONFIDENCE_EXPLICIT"] == constants.CONFIDENCE_EXPLICIT

    def test_confidence_fallback(self):
        assert _SPEC["CONFIDENCE_FALLBACK"] == constants.CONFIDENCE_FALLBACK

    def test_webhook_max_retries(self):
        assert _SPEC["WEBHOOK_MAX_RETRIES"] == constants.WEBHOOK_MAX_RETRIES

    def test_aip_content_type(self):
        assert _SPEC["AIP_CONTENT_TYPE"] == constants.AIP_CONTENT_TYPE

    def test_aip_version_header(self):
        assert _SPEC["AIP_VERSION_HEADER"] == constants.AIP_VERSION_HEADER

    def test_aip_signature_header(self):
        assert _SPEC["AIP_SIGNATURE_HEADER"] == constants.AIP_SIGNATURE_HEADER

    def test_checkpoint_id_prefix(self):
        assert _SPEC["CHECKPOINT_ID_PREFIX"] == constants.CHECKPOINT_ID_PREFIX

    def test_drift_alert_id_prefix(self):
        assert _SPEC["DRIFT_ALERT_ID_PREFIX"] == constants.DRIFT_ALERT_ID_PREFIX

    def test_registration_id_prefix(self):
        assert _SPEC["REGISTRATION_ID_PREFIX"] == constants.REGISTRATION_ID_PREFIX


class TestRetryDelays:
    def test_webhook_retry_delays_ms(self):
        assert _SPEC["WEBHOOK_RETRY_DELAYS_MS"] == list(constants.WEBHOOK_RETRY_DELAYS_MS)


class TestEUCompliancePresets:
    def test_window_config_fields(self):
        for key, value in _SPEC["EU_COMPLIANCE_WINDOW_CONFIG"].items():
            assert constants.EU_COMPLIANCE_WINDOW_CONFIG[key] == value

    def test_failure_policy_fields(self):
        for key, value in _SPEC["EU_COMPLIANCE_FAILURE_POLICY"].items():
            assert constants.EU_COMPLIANCE_FAILURE_POLICY[key] == value


class TestDefaultConscienceValues:
    def test_count(self):
        assert len(_SPEC["DEFAULT_CONSCIENCE_VALUES"]) == len(constants.DEFAULT_CONSCIENCE_VALUES)

    def test_all_ids_present(self):
        spec_ids = {v["id"] for v in _SPEC["DEFAULT_CONSCIENCE_VALUES"]}
        sdk_ids = {v.id for v in constants.DEFAULT_CONSCIENCE_VALUES}
        assert spec_ids == sdk_ids

    def test_all_types_match(self):
        spec_by_id = {v["id"]: v for v in _SPEC["DEFAULT_CONSCIENCE_VALUES"]}
        for cv in constants.DEFAULT_CONSCIENCE_VALUES:
            assert spec_by_id[cv.id]["type"] == cv.type

    def test_all_contents_match(self):
        spec_by_id = {v["id"]: v for v in _SPEC["DEFAULT_CONSCIENCE_VALUES"]}
        for cv in constants.DEFAULT_CONSCIENCE_VALUES:
            assert spec_by_id[cv.id]["content"] == cv.content
