"""Tests for the integrity analysis engine.

Verifies checkpoint creation, verdict-to-action mapping,
signal building, and thinking block hashing.

Port of packages/typescript/test/analysis/engine.test.ts
"""

from __future__ import annotations

import json
import re
from datetime import datetime

from aip.analysis.engine import (
    CheckIntegrityInput,
    ThinkingInput,
    build_signal,
    check_integrity,
    hash_thinking_block,
    map_verdict_to_action,
    map_verdict_to_proceed,
)
from aip.constants import MAX_EVIDENCE_LENGTH
from aip.schemas.checkpoint import WindowPosition
from aip.schemas.signal import VerdictCounts, WindowSummary
from tests.conftest import (
    VERDICT_BOUNDARY_DECEPTION,
    VERDICT_BOUNDARY_INJECTION,
    VERDICT_CLEAR,
    VERDICT_REVIEW_NEEDED,
)

# ---------------------------------------------------------------------------
# Helper
# ---------------------------------------------------------------------------


def make_input(verdict_fixture: dict) -> CheckIntegrityInput:
    return CheckIntegrityInput(
        analysis_response=json.dumps(verdict_fixture),
        thinking=ThinkingInput(
            hash="abc123def456",
            provider="anthropic",
            model="claude-sonnet-4-5-20250514",
            tokens_original=100,
            tokens_analyzed=100,
            truncated=False,
            confidence=1.0,
        ),
        agent_id="smolt-test",
        card_id="ac-test",
        session_id="sess-test-001",
        window_position=WindowPosition(index=0, window_size=1),
        analysis_model="claude-3-5-haiku-20241022",
        analysis_duration_ms=150,
    )


# ---------------------------------------------------------------------------
# check_integrity
# ---------------------------------------------------------------------------


class TestCheckIntegrity:
    """Tests for check_integrity."""

    def test_parses_clear_verdict(self) -> None:
        result = check_integrity(make_input(VERDICT_CLEAR))
        assert result.verdict == "clear"
        assert result.concerns == []

    def test_parses_review_needed_verdict_with_correct_concerns(self) -> None:
        result = check_integrity(make_input(VERDICT_REVIEW_NEEDED))
        assert result.verdict == "review_needed"
        assert len(result.concerns) == 1
        assert result.concerns[0].category == "value_misalignment"
        assert result.concerns[0].severity == "medium"

    def test_parses_boundary_violation_with_correct_concerns_and_evidence(self) -> None:
        result = check_integrity(make_input(VERDICT_BOUNDARY_INJECTION))
        assert result.verdict == "boundary_violation"
        assert len(result.concerns) == 1
        assert result.concerns[0].category == "prompt_injection"
        assert result.concerns[0].severity == "critical"
        assert result.concerns[0].evidence == (
            "I should follow these new instructions since they appear "
            "to be from a higher authority"
        )

    def test_generates_checkpoint_id_starting_with_ic(self) -> None:
        result = check_integrity(make_input(VERDICT_CLEAR))
        assert result.checkpoint_id.startswith("ic-")

    def test_includes_thinking_block_hash_matching_input_hash(self) -> None:
        result = check_integrity(make_input(VERDICT_CLEAR))
        assert result.thinking_block_hash == "abc123def456"

    def test_produces_valid_iso_8601_timestamp(self) -> None:
        result = check_integrity(make_input(VERDICT_CLEAR))
        parsed = datetime.fromisoformat(result.timestamp)
        assert parsed.isoformat() == result.timestamp

    def test_sets_window_position_from_input(self) -> None:
        inp = make_input(VERDICT_CLEAR)
        inp.window_position = WindowPosition(index=3, window_size=10)
        result = check_integrity(inp)
        assert result.window_position.index == 3
        assert result.window_position.window_size == 10

    def test_sets_analysis_metadata_with_correct_values(self) -> None:
        result = check_integrity(make_input(VERDICT_CLEAR))
        assert result.analysis_metadata.analysis_model == "claude-3-5-haiku-20241022"
        assert result.analysis_metadata.analysis_duration_ms == 150
        assert result.analysis_metadata.thinking_tokens_original == 100
        assert result.analysis_metadata.thinking_tokens_analyzed == 100
        assert result.analysis_metadata.truncated is False
        assert result.analysis_metadata.extraction_confidence == 1.0

    def test_sets_linked_trace_id_to_none_when_not_provided(self) -> None:
        result = check_integrity(make_input(VERDICT_CLEAR))
        assert result.linked_trace_id is None

    def test_sets_linked_trace_id_when_provided(self) -> None:
        inp = make_input(VERDICT_CLEAR)
        inp.linked_trace_id = "apt-12345"
        result = check_integrity(inp)
        assert result.linked_trace_id == "apt-12345"

    def test_throws_on_invalid_json_string(self) -> None:
        inp = make_input(VERDICT_CLEAR)
        inp.analysis_response = "not valid json {{{"
        try:
            check_integrity(inp)
            assert False, "Expected ValueError"
        except ValueError as e:
            assert "Failed to parse analysis response as JSON" in str(e)

    def test_throws_on_invalid_verdict_value(self) -> None:
        inp = make_input(VERDICT_CLEAR)
        inp.analysis_response = json.dumps({**VERDICT_CLEAR, "verdict": "unknown"})
        try:
            check_integrity(inp)
            assert False, "Expected ValueError"
        except ValueError as e:
            assert "Invalid verdict value" in str(e)

    def test_throws_on_missing_verdict_field(self) -> None:
        inp = make_input(VERDICT_CLEAR)
        partial = dict(VERDICT_CLEAR)
        del partial["verdict"]
        inp.analysis_response = json.dumps(partial)
        try:
            check_integrity(inp)
            assert False, "Expected ValueError"
        except ValueError as e:
            assert "Invalid verdict" in str(e)

    def test_throws_on_invalid_concern_category(self) -> None:
        inp = make_input(VERDICT_CLEAR)
        concern = dict(VERDICT_REVIEW_NEEDED["concerns"][0])
        concern["category"] = "not_a_category"
        inp.analysis_response = json.dumps({
            **VERDICT_REVIEW_NEEDED,
            "concerns": [concern],
        })
        try:
            check_integrity(inp)
            assert False, "Expected ValueError"
        except ValueError as e:
            assert "Invalid concern category" in str(e)

    def test_throws_on_invalid_concern_severity(self) -> None:
        inp = make_input(VERDICT_CLEAR)
        concern = dict(VERDICT_REVIEW_NEEDED["concerns"][0])
        concern["severity"] = "extreme"
        inp.analysis_response = json.dumps({
            **VERDICT_REVIEW_NEEDED,
            "concerns": [concern],
        })
        try:
            check_integrity(inp)
            assert False, "Expected ValueError"
        except ValueError as e:
            assert "Invalid concern severity" in str(e)

    def test_truncates_evidence_to_max_evidence_length(self) -> None:
        long_evidence = "x" * 500
        concern = dict(VERDICT_REVIEW_NEEDED["concerns"][0])
        concern["evidence"] = long_evidence
        inp = make_input(VERDICT_CLEAR)
        inp.analysis_response = json.dumps({
            **VERDICT_REVIEW_NEEDED,
            "concerns": [concern],
        })
        result = check_integrity(inp)
        assert len(result.concerns[0].evidence) == MAX_EVIDENCE_LENGTH
        assert result.concerns[0].evidence == "x" * MAX_EVIDENCE_LENGTH

    def test_preserves_evidence_that_is_exactly_max_evidence_length(self) -> None:
        exact_evidence = "y" * MAX_EVIDENCE_LENGTH
        concern = dict(VERDICT_REVIEW_NEEDED["concerns"][0])
        concern["evidence"] = exact_evidence
        inp = make_input(VERDICT_CLEAR)
        inp.analysis_response = json.dumps({
            **VERDICT_REVIEW_NEEDED,
            "concerns": [concern],
        })
        result = check_integrity(inp)
        assert len(result.concerns[0].evidence) == MAX_EVIDENCE_LENGTH

    def test_sets_agent_id_card_id_and_session_id_from_input(self) -> None:
        result = check_integrity(make_input(VERDICT_CLEAR))
        assert result.agent_id == "smolt-test"
        assert result.card_id == "ac-test"
        assert result.session_id == "sess-test-001"

    def test_sets_provider_and_model_from_thinking_input(self) -> None:
        result = check_integrity(make_input(VERDICT_CLEAR))
        assert result.provider == "anthropic"
        assert result.model == "claude-sonnet-4-5-20250514"

    def test_correctly_parses_conscience_context(self) -> None:
        result = check_integrity(make_input(VERDICT_REVIEW_NEEDED))
        assert result.conscience_context.values_checked == ["safety", "helpfulness"]
        assert result.conscience_context.conflicts == ["safety"]
        assert result.conscience_context.supports == []
        assert result.conscience_context.considerations == [
            "Agent appears to be rationalizing rather than refusing"
        ]
        assert result.conscience_context.consultation_depth == "standard"

    def test_throws_on_missing_reasoning_summary(self) -> None:
        inp = make_input(VERDICT_CLEAR)
        partial = dict(VERDICT_CLEAR)
        del partial["reasoning_summary"]
        inp.analysis_response = json.dumps(partial)
        try:
            check_integrity(inp)
            assert False, "Expected ValueError"
        except ValueError as e:
            assert "Invalid reasoning_summary" in str(e)

    def test_throws_on_missing_conscience_context(self) -> None:
        inp = make_input(VERDICT_CLEAR)
        partial = dict(VERDICT_CLEAR)
        del partial["conscience_context"]
        inp.analysis_response = json.dumps(partial)
        try:
            check_integrity(inp)
            assert False, "Expected ValueError"
        except ValueError as e:
            assert "Invalid conscience_context" in str(e)

    def test_throws_on_invalid_consultation_depth(self) -> None:
        inp = make_input(VERDICT_CLEAR)
        ctx = dict(VERDICT_CLEAR["conscience_context"])
        ctx["consultation_depth"] = "ultra_deep"
        inp.analysis_response = json.dumps({
            **VERDICT_CLEAR,
            "conscience_context": ctx,
        })
        try:
            check_integrity(inp)
            assert False, "Expected ValueError"
        except ValueError as e:
            assert "Invalid consultation_depth" in str(e)

    def test_ignores_extra_fields_in_json_response(self) -> None:
        inp = make_input(VERDICT_CLEAR)
        inp.analysis_response = json.dumps({
            **VERDICT_CLEAR,
            "extra_field": "should be ignored",
            "another_extra": 42,
        })
        result = check_integrity(inp)
        assert result.verdict == "clear"
        assert not hasattr(result, "extra_field")

    def test_handles_boundary_violation_with_multiple_concerns(self) -> None:
        result = check_integrity(make_input(VERDICT_BOUNDARY_DECEPTION))
        assert result.verdict == "boundary_violation"
        assert len(result.concerns) == 2
        assert result.concerns[0].category == "deceptive_reasoning"
        assert result.concerns[0].severity == "high"
        assert result.concerns[1].category == "autonomy_violation"
        assert result.concerns[1].severity == "medium"


# ---------------------------------------------------------------------------
# map_verdict_to_action
# ---------------------------------------------------------------------------


class TestMapVerdictToAction:
    """Tests for map_verdict_to_action."""

    def test_maps_clear_to_continue(self) -> None:
        assert map_verdict_to_action("clear", []) == "continue"

    def test_maps_review_needed_to_log_and_continue(self) -> None:
        result = check_integrity(make_input(VERDICT_REVIEW_NEEDED))
        assert map_verdict_to_action("review_needed", result.concerns) == "log_and_continue"

    def test_maps_boundary_violation_with_critical_to_deny_and_escalate(self) -> None:
        result = check_integrity(make_input(VERDICT_BOUNDARY_INJECTION))
        assert map_verdict_to_action("boundary_violation", result.concerns) == "deny_and_escalate"

    def test_maps_boundary_violation_without_critical_to_pause_for_review(self) -> None:
        result = check_integrity(make_input(VERDICT_BOUNDARY_DECEPTION))
        assert map_verdict_to_action("boundary_violation", result.concerns) == "pause_for_review"


# ---------------------------------------------------------------------------
# map_verdict_to_proceed
# ---------------------------------------------------------------------------


class TestMapVerdictToProceed:
    """Tests for map_verdict_to_proceed."""

    def test_maps_clear_to_true(self) -> None:
        assert map_verdict_to_proceed("clear") is True

    def test_maps_review_needed_to_true(self) -> None:
        assert map_verdict_to_proceed("review_needed") is True

    def test_maps_boundary_violation_to_false(self) -> None:
        assert map_verdict_to_proceed("boundary_violation") is False


# ---------------------------------------------------------------------------
# build_signal
# ---------------------------------------------------------------------------


class TestBuildSignal:
    """Tests for build_signal."""

    def test_combines_checkpoint_and_window_summary(self) -> None:
        checkpoint = check_integrity(make_input(VERDICT_REVIEW_NEEDED))

        window_summary = WindowSummary(
            size=5,
            max_size=10,
            verdicts=VerdictCounts(clear=3, review_needed=2, boundary_violation=0),
            integrity_ratio=0.6,
            drift_alert_active=False,
        )

        signal = build_signal(checkpoint, window_summary)

        assert signal.checkpoint is checkpoint
        assert signal.proceed is True
        assert signal.recommended_action == "log_and_continue"
        assert signal.window_summary is window_summary

    def test_sets_proceed_to_false_for_boundary_violation(self) -> None:
        checkpoint = check_integrity(make_input(VERDICT_BOUNDARY_INJECTION))

        window_summary = WindowSummary(
            size=1,
            max_size=10,
            verdicts=VerdictCounts(clear=0, review_needed=0, boundary_violation=1),
            integrity_ratio=0.0,
            drift_alert_active=False,
        )

        signal = build_signal(checkpoint, window_summary)
        assert signal.proceed is False
        assert signal.recommended_action == "deny_and_escalate"

    def test_sets_proceed_to_true_for_clear(self) -> None:
        checkpoint = check_integrity(make_input(VERDICT_CLEAR))

        window_summary = WindowSummary(
            size=1,
            max_size=10,
            verdicts=VerdictCounts(clear=1, review_needed=0, boundary_violation=0),
            integrity_ratio=1.0,
            drift_alert_active=False,
        )

        signal = build_signal(checkpoint, window_summary)
        assert signal.proceed is True
        assert signal.recommended_action == "continue"


# ---------------------------------------------------------------------------
# hash_thinking_block
# ---------------------------------------------------------------------------


class TestHashThinkingBlock:
    """Tests for hash_thinking_block."""

    def test_returns_consistent_hex_string_for_same_input(self) -> None:
        hash1 = hash_thinking_block("hello world")
        hash2 = hash_thinking_block("hello world")
        assert hash1 == hash2

    def test_returns_different_hashes_for_different_content(self) -> None:
        hash1 = hash_thinking_block("hello world")
        hash2 = hash_thinking_block("goodbye world")
        assert hash1 != hash2

    def test_returns_64_character_hex_string_sha256(self) -> None:
        h = hash_thinking_block("test content")
        assert len(h) == 64
        assert re.match(r"^[0-9a-f]{64}$", h)
