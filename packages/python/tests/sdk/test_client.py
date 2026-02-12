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
