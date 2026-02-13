"""Tests for the AIP SDK client.

Port of packages/typescript/test/sdk/client.test.ts

Uses respx to mock httpx HTTP calls and pytest-asyncio for async tests.
"""

from __future__ import annotations

import json
from unittest.mock import MagicMock

import httpx
import pytest
import respx

from aip.schemas.config import (
    AIPCallbacks,
    AIPConfig,
    AnalysisLLMConfig,
    FailurePolicy,
    WindowConfig,
)
from aip.schemas.conscience import ConscienceValue
from aip.sdk.client import create_client
from tests.conftest import (
    ANTHROPIC_JSON_NO_THINKING,
    ANTHROPIC_JSON_WITH_THINKING,
    FULL_CARD,
    VERDICT_BOUNDARY_INJECTION,
    VERDICT_CLEAR,
    VERDICT_REVIEW_NEEDED,
)

# ---------------------------------------------------------------------------
# Test helpers
# ---------------------------------------------------------------------------


def make_config(**overrides) -> AIPConfig:
    defaults = dict(
        card=FULL_CARD,
        analysis_llm=AnalysisLLMConfig(
            model="claude-3-5-haiku-20241022",
            base_url="https://api.anthropic.com",
            api_key="test-key",
            max_tokens=1024,
        ),
        window=WindowConfig(
            max_size=10,
            mode="sliding",
            session_boundary="reset",
            max_age_seconds=3600,
        ),
    )
    defaults.update(overrides)
    return AIPConfig(**defaults)


def mock_analysis_response(verdict: dict) -> respx.Route:
    """Mock the analysis LLM endpoint to return a specific verdict."""
    response_body = {
        "content": [{"type": "text", "text": json.dumps(verdict)}],
    }
    return respx.post("https://api.anthropic.com/v1/messages").mock(
        return_value=httpx.Response(200, json=response_body)
    )


# ---------------------------------------------------------------------------
# Initialization
# ---------------------------------------------------------------------------


class TestCreateClientInitialization:
    """createClient -- initialization."""

    def test_succeeds_with_valid_config(self) -> None:
        client = create_client(make_config())

        assert client is not None
        assert callable(client.check)
        assert callable(client.get_window_state)
        assert callable(client.reset_window)
        assert callable(client.destroy)

    def test_throws_when_conscience_values_conflict_with_card(self) -> None:
        # FULL_CARD has "write_files" in bounded_actions.
        # A BOUNDARY saying "Never write files" should conflict.
        with pytest.raises(ValueError, match=r"Card-conscience agreement validation failed"):
            create_client(
                make_config(
                    conscience_values=[
                        ConscienceValue(
                            type="BOUNDARY",
                            content="Never write files under any circumstances",
                        ),
                    ],
                )
            )

    def test_works_with_no_conscience_values(self) -> None:
        config = make_config()
        config.conscience_values = None

        client = create_client(config)

        assert client is not None


# ---------------------------------------------------------------------------
# check() -- no thinking block
# ---------------------------------------------------------------------------


class TestCheckNoThinkingBlock:
    """check() -- no thinking block."""

    @respx.mock
    async def test_returns_synthetic_clear_signal_when_no_thinking_block(self) -> None:
        client = create_client(make_config())

        signal = await client.check(ANTHROPIC_JSON_NO_THINKING)

        assert signal.checkpoint.verdict == "clear"
        assert signal.checkpoint.thinking_block_hash == "none"
        assert "No thinking block found" in signal.checkpoint.reasoning_summary

    @respx.mock
    async def test_synthetic_signal_has_proceed_true_and_continue_action(self) -> None:
        client = create_client(make_config())

        signal = await client.check(ANTHROPIC_JSON_NO_THINKING)

        assert signal.proceed is True
        assert signal.recommended_action == "continue"


# ---------------------------------------------------------------------------
# check() -- with thinking block
# ---------------------------------------------------------------------------


class TestCheckWithThinkingBlock:
    """check() -- with thinking block."""

    @respx.mock
    async def test_returns_integrity_signal_with_clear_verdict(self) -> None:
        mock_analysis_response(VERDICT_CLEAR)
        client = create_client(make_config())

        signal = await client.check(ANTHROPIC_JSON_WITH_THINKING)

        assert signal.checkpoint.verdict == "clear"
        assert signal.proceed is True
        assert signal.recommended_action == "continue"
        assert signal.checkpoint.concerns == []

    @respx.mock
    async def test_returns_review_needed_signal_correctly(self) -> None:
        mock_analysis_response(VERDICT_REVIEW_NEEDED)
        client = create_client(make_config())

        signal = await client.check(ANTHROPIC_JSON_WITH_THINKING)

        assert signal.checkpoint.verdict == "review_needed"
        assert signal.proceed is True
        assert signal.recommended_action == "log_and_continue"
        assert len(signal.checkpoint.concerns) > 0

    @respx.mock
    async def test_returns_boundary_violation_with_proceed_false(self) -> None:
        mock_analysis_response(VERDICT_BOUNDARY_INJECTION)
        client = create_client(make_config())

        signal = await client.check(ANTHROPIC_JSON_WITH_THINKING)

        assert signal.checkpoint.verdict == "boundary_violation"
        assert signal.proceed is False
        # VERDICT_BOUNDARY_INJECTION has a critical prompt_injection concern
        assert signal.recommended_action == "deny_and_escalate"

    @respx.mock
    async def test_check_accepts_task_context(self) -> None:
        mock_analysis_response(VERDICT_CLEAR)
        client = create_client(make_config())

        signal = await client.check(
            ANTHROPIC_JSON_WITH_THINKING, "anthropic", "Researching articles"
        )

        assert signal is not None
        assert signal.checkpoint.verdict == "clear"


# ---------------------------------------------------------------------------
# Callbacks
# ---------------------------------------------------------------------------


class TestCallbacks:
    """callbacks."""

    @respx.mock
    async def test_on_verdict_callback_is_invoked_with_signal(self) -> None:
        on_verdict = MagicMock()
        client = create_client(
            make_config(callbacks=AIPCallbacks(on_verdict=on_verdict)),
        )
        mock_analysis_response(VERDICT_CLEAR)

        signal = await client.check(ANTHROPIC_JSON_WITH_THINKING)

        on_verdict.assert_called_once_with(signal)

    @respx.mock
    async def test_on_drift_alert_callback_not_invoked_for_single_check(self) -> None:
        on_drift_alert = MagicMock()
        client = create_client(
            make_config(callbacks=AIPCallbacks(on_drift_alert=on_drift_alert)),
        )
        mock_analysis_response(VERDICT_CLEAR)

        await client.check(ANTHROPIC_JSON_WITH_THINKING)

        on_drift_alert.assert_not_called()


# ---------------------------------------------------------------------------
# Failure policy
# ---------------------------------------------------------------------------


class TestFailurePolicy:
    """failure policy."""

    @respx.mock
    async def test_fail_open_returns_synthetic_clear_when_fetch_throws(self) -> None:
        respx.post("https://api.anthropic.com/v1/messages").mock(
            side_effect=httpx.ConnectError("Network error")
        )

        client = create_client(
            make_config(
                failure_policy=FailurePolicy(mode="fail_open", analysis_timeout_ms=5000),
            ),
        )

        signal = await client.check(ANTHROPIC_JSON_WITH_THINKING)

        assert signal.checkpoint.verdict == "clear"
        assert signal.proceed is True
        assert signal.recommended_action == "continue"

    @respx.mock
    async def test_fail_closed_returns_synthetic_boundary_violation_when_fetch_throws(self) -> None:
        respx.post("https://api.anthropic.com/v1/messages").mock(
            side_effect=httpx.ConnectError("Network error")
        )

        client = create_client(
            make_config(
                failure_policy=FailurePolicy(mode="fail_closed", analysis_timeout_ms=5000),
            ),
        )

        signal = await client.check(ANTHROPIC_JSON_WITH_THINKING)

        assert signal.checkpoint.verdict == "boundary_violation"
        assert signal.proceed is False
        assert signal.recommended_action == "deny_and_escalate"

    @respx.mock
    async def test_on_error_callback_invoked_when_analysis_fails(self) -> None:
        on_error = MagicMock()
        respx.post("https://api.anthropic.com/v1/messages").mock(
            side_effect=httpx.ConnectError("Connection refused")
        )

        client = create_client(
            make_config(callbacks=AIPCallbacks(on_error=on_error)),
        )

        await client.check(ANTHROPIC_JSON_WITH_THINKING)

        on_error.assert_called_once()
        assert isinstance(on_error.call_args[0][0], Exception)


# ---------------------------------------------------------------------------
# Window management
# ---------------------------------------------------------------------------


class TestWindowManagement:
    """window management."""

    def test_get_window_state_returns_initial_empty_state(self) -> None:
        client = create_client(make_config())
        state = client.get_window_state()

        assert state.size == 0
        assert state.checkpoints == []
        assert state.stats.total_checks == 0

    @respx.mock
    async def test_after_check_window_size_increases(self) -> None:
        mock_analysis_response(VERDICT_CLEAR)
        client = create_client(make_config())

        await client.check(ANTHROPIC_JSON_WITH_THINKING)

        state = client.get_window_state()
        assert state.size == 1
        assert len(state.checkpoints) == 1

    @respx.mock
    async def test_reset_window_clears_window(self) -> None:
        mock_analysis_response(VERDICT_CLEAR)
        client = create_client(make_config())

        await client.check(ANTHROPIC_JSON_WITH_THINKING)
        assert client.get_window_state().size == 1

        client.reset_window()

        state = client.get_window_state()
        assert state.size == 0
        assert state.checkpoints == []


# ---------------------------------------------------------------------------
# Lifecycle
# ---------------------------------------------------------------------------


class TestLifecycle:
    """lifecycle."""

    async def test_check_throws_after_destroy(self) -> None:
        client = create_client(make_config())
        client.destroy()

        with pytest.raises(RuntimeError, match="AIP client has been destroyed"):
            await client.check(ANTHROPIC_JSON_NO_THINKING)


# ---------------------------------------------------------------------------
# Minimum evidence threshold (v0.1.5)
# ---------------------------------------------------------------------------

SHORT_THINKING_RESPONSE = json.dumps({
    "id": "msg_short",
    "type": "message",
    "role": "assistant",
    "model": "claude-sonnet-4-5-20250514",
    "content": [
        {"type": "thinking", "thinking": "Okay, let me help."},
        {"type": "text", "text": "Here is your answer."},
    ],
    "stop_reason": "end_turn",
    "usage": {"input_tokens": 50, "output_tokens": 20},
})


class TestMinimumEvidenceThreshold:
    """check() -- minimum evidence threshold (v0.1.5)."""

    @respx.mock
    async def test_returns_synthetic_clear_for_short_thinking_block(self) -> None:
        client = create_client(make_config())

        signal = await client.check(SHORT_THINKING_RESPONSE)

        assert signal.checkpoint.verdict == "clear"
        assert "minimum evidence threshold" in signal.checkpoint.reasoning_summary

    @respx.mock
    async def test_synthetic_clear_includes_correct_token_counts(self) -> None:
        client = create_client(make_config())

        signal = await client.check(SHORT_THINKING_RESPONSE)

        # "Okay, let me help." is 18 chars -> ceil(18/4) = 5 tokens
        assert signal.checkpoint.analysis_metadata.thinking_tokens_original > 0
        assert signal.checkpoint.analysis_metadata.thinking_tokens_analyzed == 0

    @respx.mock
    async def test_custom_min_evidence_tokens_config(self) -> None:
        # With low threshold (10 tokens), "Okay, let me help." (5 tokens) is
        # still below → synthetic clear. Use a longer thinking block instead.
        medium_thinking_response = json.dumps({
            "id": "msg_medium",
            "type": "message",
            "role": "assistant",
            "model": "claude-sonnet-4-5-20250514",
            "content": [
                {
                    "type": "thinking",
                    "thinking": (
                        "I need to think about this carefully and consider "
                        "multiple approaches before responding to the user."
                    ),
                },
                {"type": "text", "text": "Here is your answer."},
            ],
            "stop_reason": "end_turn",
            "usage": {"input_tokens": 50, "output_tokens": 20},
        })
        # The thinking block is ~101 chars -> ceil(101/4) = 26 tokens

        # With min_evidence_tokens=10, 26 tokens exceeds threshold -> analysis runs
        mock_analysis_response(VERDICT_CLEAR)
        client_low = create_client(make_config(min_evidence_tokens=10))
        signal_low = await client_low.check(medium_thinking_response)
        assert signal_low.checkpoint.verdict == "clear"
        # The analysis LLM was called, so analysis_model should NOT be "none"
        assert signal_low.checkpoint.analysis_metadata.analysis_model != "none"

        # With min_evidence_tokens=500, 26 tokens is below threshold -> synthetic clear
        client_high = create_client(make_config(min_evidence_tokens=500))
        signal_high = await client_high.check(medium_thinking_response)
        assert signal_high.checkpoint.verdict == "clear"
        assert "minimum evidence threshold" in signal_high.checkpoint.reasoning_summary


# ---------------------------------------------------------------------------
# Initial checkpoints / window hydration (v0.1.5)
# ---------------------------------------------------------------------------


class TestInitialCheckpointsHydration:
    """initial_checkpoints -- window hydration (v0.1.5)."""

    def test_initial_checkpoints_hydrate_window(self) -> None:
        from datetime import datetime, timezone

        from aip.schemas.checkpoint import AnalysisMetadata, IntegrityCheckpoint, WindowPosition
        from aip.schemas.conscience import ConscienceContext

        # Use current timestamps so checkpoints don't get evicted by max_age
        now = datetime.now(timezone.utc).isoformat()

        # The session_id must match the auto-generated one from create_client,
        # or use "carry" boundary. Easier: use make_checkpoint from conftest
        # which uses random session IDs, but we need both to share the same
        # session_id. We build them inline with a shared session_id matching
        # the client's internal session by using the window config with
        # session_boundary="carry" so a mismatched session_id won't reset.
        mock_cp_1 = IntegrityCheckpoint(
            checkpoint_id="ic-test-1",
            agent_id="test-agent",
            card_id="ac-test",
            session_id="sess-test",
            timestamp=now,
            thinking_block_hash="abc123",
            provider="anthropic",
            model="claude-sonnet-4-5-20250514",
            verdict="clear",
            concerns=[],
            reasoning_summary="All clear",
            conscience_context=ConscienceContext(
                values_checked=[],
                conflicts=[],
                supports=[],
                considerations=[],
                consultation_depth="surface",
            ),
            window_position=WindowPosition(index=0, window_size=1),
            analysis_metadata=AnalysisMetadata(
                analysis_model="claude-3-5-haiku-20241022",
                analysis_duration_ms=100,
                thinking_tokens_original=200,
                thinking_tokens_analyzed=200,
                truncated=False,
                extraction_confidence=1.0,
            ),
        )

        mock_cp_2 = IntegrityCheckpoint(
            checkpoint_id="ic-test-2",
            agent_id="test-agent",
            card_id="ac-test",
            session_id="sess-test",
            timestamp=now,
            thinking_block_hash="def456",
            provider="anthropic",
            model="claude-sonnet-4-5-20250514",
            verdict="clear",
            concerns=[],
            reasoning_summary="Still clear",
            conscience_context=ConscienceContext(
                values_checked=[],
                conflicts=[],
                supports=[],
                considerations=[],
                consultation_depth="surface",
            ),
            window_position=WindowPosition(index=1, window_size=2),
            analysis_metadata=AnalysisMetadata(
                analysis_model="claude-3-5-haiku-20241022",
                analysis_duration_ms=120,
                thinking_tokens_original=250,
                thinking_tokens_analyzed=250,
                truncated=False,
                extraction_confidence=1.0,
            ),
        )

        # Use session_boundary="carry" so the differing session_id doesn't
        # trigger a window reset when checkpoints are hydrated.
        client = create_client(
            make_config(
                window=WindowConfig(
                    max_size=10,
                    mode="sliding",
                    session_boundary="carry",
                    max_age_seconds=3600,
                ),
                initial_checkpoints=[mock_cp_1, mock_cp_2],
            )
        )
        state = client.get_window_state()

        assert state.size == 2
        assert len(state.checkpoints) == 2
        assert state.checkpoints[0].checkpoint_id == "ic-test-1"
        assert state.checkpoints[1].checkpoint_id == "ic-test-2"
