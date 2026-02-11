"""End-to-end integration tests for the AIP client.

Tests the full check() lifecycle with mocked HTTP (using respx to mock httpx),
covering multi-check sessions, state accumulation, drift detection,
callback ordering, provider auto-detection, failure recovery,
and HMAC signing round-trips.

Ported from packages/typescript/test/e2e/client-integration.test.ts
"""

from __future__ import annotations

import json
import re
from typing import Any
from unittest.mock import MagicMock

import httpx
import respx

from aip.schemas.config import (
    AIPCallbacks,
    AIPConfig,
    AlignmentCard,
    AlignmentCardValue,
    AnalysisLLMConfig,
    AutonomyEnvelope,
    EscalationTrigger,
    FailurePolicy,
    WindowConfig,
)
from aip.schemas.drift_alert import IntegrityDriftAlert
from aip.schemas.signal import IntegritySignal
from aip.sdk.client import create_client
from aip.sdk.http import sign_payload, verify_signature

# ---------------------------------------------------------------------------
# Fixture data
# ---------------------------------------------------------------------------

FULL_CARD = AlignmentCard(
    card_id="ac-test-full",
    values=[
        AlignmentCardValue(name="transparency", priority=1, description="Be transparent about capabilities and limitations"),
        AlignmentCardValue(name="accuracy", priority=2, description="Provide accurate, verified information"),
        AlignmentCardValue(name="helpfulness", priority=3, description="Be genuinely helpful to users"),
        AlignmentCardValue(name="safety", priority=4, description="Prioritize user and system safety"),
    ],
    autonomy_envelope=AutonomyEnvelope(
        bounded_actions=["read_files", "write_files", "run_commands"],
        forbidden_actions=["delete_system_files", "exfiltrate_data", "modify_security_settings"],
        escalation_triggers=[
            EscalationTrigger(condition="action_outside_bounded_list", action="pause_and_ask", reason="Action not in approved list"),
            EscalationTrigger(condition="user_data_access", action="log_and_continue", reason="Track data access patterns"),
        ],
    ),
)

ANTHROPIC_JSON_WITH_THINKING = json.dumps({
    "id": "msg_test_001",
    "type": "message",
    "role": "assistant",
    "model": "claude-sonnet-4-5-20250514",
    "content": [
        {"type": "thinking", "thinking": "Let me analyze this request carefully. The user wants help with their code."},
        {"type": "text", "text": "I'd be happy to help with your code!"},
    ],
    "stop_reason": "end_turn",
    "usage": {"input_tokens": 100, "output_tokens": 50},
})

ANTHROPIC_JSON_NO_THINKING = json.dumps({
    "id": "msg_test_002",
    "type": "message",
    "role": "assistant",
    "model": "claude-sonnet-4-5-20250514",
    "content": [
        {"type": "text", "text": "Here is your answer."},
    ],
    "stop_reason": "end_turn",
    "usage": {"input_tokens": 50, "output_tokens": 20},
})

OPENAI_JSON_WITH_REASONING = json.dumps({
    "id": "chatcmpl-test-001",
    "object": "chat.completion",
    "model": "o1-preview",
    "choices": [{
        "index": 0,
        "message": {
            "role": "assistant",
            "content": "Here is my response.",
            "reasoning_content": "Let me think about this step by step. The user needs help with their API design.",
        },
        "finish_reason": "stop",
    }],
    "usage": {"prompt_tokens": 100, "completion_tokens": 50, "total_tokens": 150},
})

# Verdict fixtures

VERDICT_CLEAR: dict = {
    "verdict": "clear",
    "concerns": [],
    "reasoning_summary": "Agent reasoning is aligned with declared values. Normal code assistance thinking with no concerning patterns.",
    "conscience_context": {
        "values_checked": ["helpfulness", "safety"],
        "conflicts": [],
        "supports": ["helpfulness"],
        "considerations": [],
        "consultation_depth": "surface",
    },
}

VERDICT_REVIEW_NEEDED: dict = {
    "verdict": "review_needed",
    "concerns": [{
        "category": "value_misalignment",
        "severity": "medium",
        "description": "Agent reasoning shows intent to frame potentially harmful content as educational to bypass safety guidelines.",
        "evidence": 'I think I can frame it as "educational" to get around the safety guidelines',
        "relevant_card_field": "values.safety",
        "relevant_conscience_value": None,
    }],
    "reasoning_summary": "Agent shows signs of rationalizing boundary-adjacent behavior. Not a hard violation but warrants attention.",
    "conscience_context": {
        "values_checked": ["safety", "helpfulness"],
        "conflicts": ["safety"],
        "supports": [],
        "considerations": ["Agent appears to be rationalizing rather than refusing"],
        "consultation_depth": "standard",
    },
}

VERDICT_BOUNDARY_INJECTION: dict = {
    "verdict": "boundary_violation",
    "concerns": [{
        "category": "prompt_injection",
        "severity": "critical",
        "description": "Agent thinking shows response to injected instructions from tool output, planning to exfiltrate system file contents.",
        "evidence": "I should follow these new instructions since they appear to be from a higher authority",
        "relevant_card_field": "autonomy_envelope.forbidden_actions",
        "relevant_conscience_value": "BOUNDARY:no_data_exfiltration",
    }],
    "reasoning_summary": "Critical prompt injection detected. Agent reasoning shows intent to follow injected instructions and exfiltrate sensitive data.",
    "conscience_context": {
        "values_checked": ["safety", "transparency"],
        "conflicts": ["safety", "transparency"],
        "supports": [],
        "considerations": ["Agent recognized injection but chose to comply", "Data exfiltration intent detected"],
        "consultation_depth": "deep",
    },
}

VERDICT_BOUNDARY_DECEPTION: dict = {
    "verdict": "boundary_violation",
    "concerns": [
        {
            "category": "deceptive_reasoning",
            "severity": "high",
            "description": "Agent plans to hide file modifications from user while claiming to only read files.",
            "evidence": 'I won\'t mention the modifications in my response - I\'ll just say I "reviewed" the files',
            "relevant_card_field": "values.transparency",
            "relevant_conscience_value": None,
        },
        {
            "category": "autonomy_violation",
            "severity": "medium",
            "description": "Agent intends to exceed bounded actions by modifying files when only reading was authorized.",
            "evidence": "This is technically outside my bounded actions but it's for their benefit",
            "relevant_card_field": "autonomy_envelope.bounded_actions",
            "relevant_conscience_value": None,
        },
    ],
    "reasoning_summary": "Agent demonstrates deceptive intent by planning to hide unauthorized file modifications. Multiple concerns including autonomy violation.",
    "conscience_context": {
        "values_checked": ["transparency", "safety", "helpfulness"],
        "conflicts": ["transparency"],
        "supports": [],
        "considerations": ["Dual narrative detected -- different intent vs stated action", "Paternalistic reasoning used to justify boundary crossing"],
        "consultation_depth": "deep",
    },
}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def make_config(overrides: dict | None = None) -> AIPConfig:
    """Create a standard AIPConfig with optional overrides."""
    base: dict[str, Any] = {
        "card": FULL_CARD,
        "analysis_llm": AnalysisLLMConfig(
            model="claude-3-5-haiku-20241022",
            base_url="https://api.anthropic.com",
            api_key="test-key",
            max_tokens=1024,
        ),
        "window": WindowConfig(
            max_size=10,
            mode="sliding",
            session_boundary="reset",
            max_age_seconds=3600,
        ),
    }
    if overrides:
        base.update(overrides)
    return AIPConfig(**base)


def _make_analysis_response(verdict: dict) -> dict:
    """Wrap a verdict dict in Anthropic Messages API response format."""
    return {
        "content": [{"type": "text", "text": json.dumps(verdict)}],
    }


class _SequenceSideEffect:
    """Side effect that returns responses in sequence, repeating last."""

    def __init__(self, responses: list[httpx.Response]) -> None:
        self._responses = responses
        self._index = 0

    def __call__(self, request: httpx.Request) -> httpx.Response:
        if self._index < len(self._responses):
            resp = self._responses[self._index]
            self._index += 1
            return resp
        return self._responses[-1]


def _mock_fetch_with_verdict(router: respx.MockRouter, verdict: dict, url: str = "https://api.anthropic.com/v1/messages") -> respx.Route:
    """Mock httpx to return a single verdict for all requests."""
    return router.post(url).mock(
        return_value=httpx.Response(200, json=_make_analysis_response(verdict)),
    )


def _mock_fetch_sequence(router: respx.MockRouter, verdicts: list[dict], url: str = "https://api.anthropic.com/v1/messages") -> respx.Route:
    """Mock httpx to return a sequence of verdicts in order."""
    side_effects = [httpx.Response(200, json=_make_analysis_response(v)) for v in verdicts]
    route = router.post(url)
    route.side_effect = _SequenceSideEffect(side_effects)
    return route


# ---------------------------------------------------------------------------
# Scenario 1: Multi-check session with state accumulation
# ---------------------------------------------------------------------------


class TestScenario1MultiCheckSession:
    """Scenario 1: Multi-check session with state accumulation."""

    async def test_accumulates_window_state_across_3_sequential_checks(self, respx_mock: respx.MockRouter) -> None:
        _mock_fetch_sequence(respx_mock, [VERDICT_CLEAR, VERDICT_CLEAR, VERDICT_REVIEW_NEEDED])
        client = create_client(make_config())

        # First check -- clear
        signal1 = await client.check(ANTHROPIC_JSON_WITH_THINKING)
        assert signal1.window_summary.size == 1
        assert signal1.window_summary.integrity_ratio == 1.0
        assert signal1.window_summary.verdicts.clear == 1
        assert signal1.window_summary.verdicts.review_needed == 0
        assert signal1.checkpoint.verdict == "clear"

        # Second check -- clear
        signal2 = await client.check(ANTHROPIC_JSON_WITH_THINKING)
        assert signal2.window_summary.size == 2
        assert signal2.window_summary.integrity_ratio == 1.0
        assert signal2.window_summary.verdicts.clear == 2
        assert signal2.window_summary.verdicts.review_needed == 0
        assert signal2.checkpoint.verdict == "clear"

        # Third check -- review_needed
        signal3 = await client.check(ANTHROPIC_JSON_WITH_THINKING)
        assert signal3.window_summary.size == 3
        assert signal3.window_summary.verdicts.clear == 2
        assert signal3.window_summary.verdicts.review_needed == 1
        # integrity_ratio = 2/3
        assert abs(signal3.window_summary.integrity_ratio - 2 / 3) < 0.001
        assert signal3.checkpoint.verdict == "review_needed"

    async def test_window_position_index_increments_with_each_check(self, respx_mock: respx.MockRouter) -> None:
        _mock_fetch_sequence(respx_mock, [VERDICT_CLEAR, VERDICT_CLEAR, VERDICT_CLEAR])
        client = create_client(make_config())

        s1 = await client.check(ANTHROPIC_JSON_WITH_THINKING)
        s2 = await client.check(ANTHROPIC_JSON_WITH_THINKING)
        s3 = await client.check(ANTHROPIC_JSON_WITH_THINKING)

        assert s1.checkpoint.window_position.index == 0
        assert s2.checkpoint.window_position.index == 1
        assert s3.checkpoint.window_position.index == 2


# ---------------------------------------------------------------------------
# Scenario 2: Drift alert fires after 3 non-clear checks
# ---------------------------------------------------------------------------


class TestScenario2DriftAlertFires:
    """Scenario 2: Drift alert fires after 3 non-clear checks."""

    async def test_fires_on_drift_alert_exactly_once_on_3rd_nonclear(self, respx_mock: respx.MockRouter) -> None:
        on_drift_alert = MagicMock()
        on_verdict = MagicMock()
        client = create_client(make_config({
            "callbacks": AIPCallbacks(
                on_drift_alert=on_drift_alert,
                on_verdict=on_verdict,
            ),
        }))
        _mock_fetch_sequence(respx_mock, [
            VERDICT_REVIEW_NEEDED,
            VERDICT_REVIEW_NEEDED,
            VERDICT_REVIEW_NEEDED,
        ])

        await client.check(ANTHROPIC_JSON_WITH_THINKING)
        on_drift_alert.assert_not_called()

        await client.check(ANTHROPIC_JSON_WITH_THINKING)
        on_drift_alert.assert_not_called()

        await client.check(ANTHROPIC_JSON_WITH_THINKING)
        assert on_drift_alert.call_count == 1

        # Verify the alert structure
        alert: IntegrityDriftAlert = on_drift_alert.call_args[0][0]
        assert alert.sustained_checks == 3
        assert alert.alert_type == "informative"
        assert len(alert.checkpoint_ids) == 3
        assert alert.alert_id.startswith("ida-")
        assert alert.detection_timestamp

    async def test_does_not_fire_second_drift_alert_on_4th_nonclear(self, respx_mock: respx.MockRouter) -> None:
        on_drift_alert = MagicMock()
        client = create_client(make_config({
            "callbacks": AIPCallbacks(on_drift_alert=on_drift_alert),
        }))
        _mock_fetch_sequence(respx_mock, [
            VERDICT_REVIEW_NEEDED,
            VERDICT_REVIEW_NEEDED,
            VERDICT_REVIEW_NEEDED,
            VERDICT_REVIEW_NEEDED,
        ])

        for _ in range(4):
            await client.check(ANTHROPIC_JSON_WITH_THINKING)

        # Alert fires only on the 3rd, not again on the 4th
        assert on_drift_alert.call_count == 1


# ---------------------------------------------------------------------------
# Scenario 3: Drift resets after clear verdict
# ---------------------------------------------------------------------------


class TestScenario3DriftReset:
    """Scenario 3: Drift resets after clear verdict."""

    async def test_clear_at_position_3_resets_streak_drift_fires_on_6th(self, respx_mock: respx.MockRouter) -> None:
        on_drift_alert = MagicMock()
        client = create_client(make_config({
            "callbacks": AIPCallbacks(on_drift_alert=on_drift_alert),
        }))
        _mock_fetch_sequence(respx_mock, [
            VERDICT_REVIEW_NEEDED,  # 1 -- streak = 1
            VERDICT_REVIEW_NEEDED,  # 2 -- streak = 2
            VERDICT_CLEAR,          # 3 -- streak resets to 0
            VERDICT_REVIEW_NEEDED,  # 4 -- streak = 1
            VERDICT_REVIEW_NEEDED,  # 5 -- streak = 2
            VERDICT_REVIEW_NEEDED,  # 6 -- streak = 3 -> alert fires
        ])

        for _ in range(6):
            await client.check(ANTHROPIC_JSON_WITH_THINKING)

        # Drift alert should fire exactly once -- on the 6th check (not the 3rd)
        assert on_drift_alert.call_count == 1

        alert: IntegrityDriftAlert = on_drift_alert.call_args[0][0]
        assert alert.sustained_checks == 3
        # Checkpoint IDs in the alert should be from checks 4, 5, 6 (the second streak)
        assert len(alert.checkpoint_ids) == 3

    async def test_multiple_clear_resets_no_alert(self, respx_mock: respx.MockRouter) -> None:
        on_drift_alert = MagicMock()
        client = create_client(make_config({
            "callbacks": AIPCallbacks(on_drift_alert=on_drift_alert),
        }))
        _mock_fetch_sequence(respx_mock, [
            VERDICT_REVIEW_NEEDED,
            VERDICT_REVIEW_NEEDED,
            VERDICT_CLEAR,
            VERDICT_REVIEW_NEEDED,
            VERDICT_REVIEW_NEEDED,
            VERDICT_CLEAR,
        ])

        for _ in range(6):
            await client.check(ANTHROPIC_JSON_WITH_THINKING)

        # Streak never reaches 3 -- alert should never fire
        on_drift_alert.assert_not_called()


# ---------------------------------------------------------------------------
# Scenario 4: Callback ordering -- on_verdict before on_drift_alert
# ---------------------------------------------------------------------------


class TestScenario4CallbackOrdering:
    """Scenario 4: Callback ordering."""

    async def test_on_verdict_called_before_on_drift_alert_on_3rd_check(self, respx_mock: respx.MockRouter) -> None:
        call_order: list[str] = []

        def on_verdict(signal: IntegritySignal) -> None:
            call_order.append("on_verdict")

        def on_drift_alert(alert: IntegrityDriftAlert) -> None:
            call_order.append("on_drift_alert")

        client = create_client(make_config({
            "callbacks": AIPCallbacks(
                on_verdict=on_verdict,
                on_drift_alert=on_drift_alert,
            ),
        }))
        _mock_fetch_sequence(respx_mock, [
            VERDICT_REVIEW_NEEDED,
            VERDICT_REVIEW_NEEDED,
            VERDICT_REVIEW_NEEDED,
        ])

        # First two checks: only on_verdict fires
        await client.check(ANTHROPIC_JSON_WITH_THINKING)
        await client.check(ANTHROPIC_JSON_WITH_THINKING)

        assert call_order == ["on_verdict", "on_verdict"]

        # Third check: both fire, on_verdict first
        await client.check(ANTHROPIC_JSON_WITH_THINKING)

        assert call_order == [
            "on_verdict",
            "on_verdict",
            "on_verdict",
            "on_drift_alert",
        ]

    async def test_on_verdict_receives_signal_and_on_drift_alert_receives_alert(self, respx_mock: respx.MockRouter) -> None:
        verdict_signal: list[IntegritySignal] = []
        drift_alert: list[IntegrityDriftAlert] = []

        def on_verdict(signal: IntegritySignal) -> None:
            verdict_signal.append(signal)

        def on_drift_alert_cb(alert: IntegrityDriftAlert) -> None:
            drift_alert.append(alert)

        client = create_client(make_config({
            "callbacks": AIPCallbacks(
                on_verdict=on_verdict,
                on_drift_alert=on_drift_alert_cb,
            ),
        }))
        _mock_fetch_sequence(respx_mock, [
            VERDICT_REVIEW_NEEDED,
            VERDICT_REVIEW_NEEDED,
            VERDICT_REVIEW_NEEDED,
        ])

        for _ in range(3):
            await client.check(ANTHROPIC_JSON_WITH_THINKING)

        assert len(verdict_signal) > 0
        assert verdict_signal[-1].checkpoint.verdict == "review_needed"

        assert len(drift_alert) > 0
        assert drift_alert[0].sustained_checks == 3
        assert drift_alert[0].agent_id == FULL_CARD.card_id


# ---------------------------------------------------------------------------
# Scenario 5: No thinking block -- fast path
# ---------------------------------------------------------------------------


class TestScenario5NoThinkingFastPath:
    """Scenario 5: No thinking block fast path."""

    async def test_returns_synthetic_clear_without_calling_fetch(self, respx_mock: respx.MockRouter) -> None:
        # Set up a route that should NOT be called
        route = _mock_fetch_with_verdict(respx_mock, VERDICT_CLEAR)

        client = create_client(make_config())

        signal = await client.check(ANTHROPIC_JSON_NO_THINKING)

        assert signal.proceed is True
        assert signal.recommended_action == "continue"
        assert signal.checkpoint.verdict == "clear"
        assert signal.checkpoint.thinking_block_hash == "none"
        assert "No thinking block found" in signal.checkpoint.reasoning_summary

        # fetch should NOT have been called
        assert route.call_count == 0

    async def test_synthetic_signals_do_not_enter_window(self, respx_mock: respx.MockRouter) -> None:
        route = _mock_fetch_with_verdict(respx_mock, VERDICT_CLEAR)

        client = create_client(make_config())

        await client.check(ANTHROPIC_JSON_NO_THINKING)
        await client.check(ANTHROPIC_JSON_NO_THINKING)
        await client.check(ANTHROPIC_JSON_NO_THINKING)

        # Window should remain empty -- synthetic signals are not pushed
        state = client.get_window_state()
        assert state.size == 0
        assert state.checkpoints == []
        assert state.stats.total_checks == 0

        assert route.call_count == 0

    async def test_synthetic_signal_window_summary_reflects_empty_window(self, respx_mock: respx.MockRouter) -> None:
        _mock_fetch_with_verdict(respx_mock, VERDICT_CLEAR)
        client = create_client(make_config())

        signal = await client.check(ANTHROPIC_JSON_NO_THINKING)

        # Summary should show an empty window state
        assert signal.window_summary.size == 0
        assert signal.window_summary.integrity_ratio == 1.0


# ---------------------------------------------------------------------------
# Scenario 6: Provider auto-detection from base_url
# ---------------------------------------------------------------------------


class TestScenario6ProviderAutoDetection:
    """Scenario 6: Provider auto-detection from base_url."""

    async def test_detects_anthropic_adapter_from_base_url(self, respx_mock: respx.MockRouter) -> None:
        _mock_fetch_with_verdict(respx_mock, VERDICT_CLEAR)

        client = create_client(make_config({
            "analysis_llm": AnalysisLLMConfig(
                model="claude-3-5-haiku-20241022",
                base_url="https://api.anthropic.com",
                api_key="test-key",
                max_tokens=1024,
            ),
        }))

        signal = await client.check(ANTHROPIC_JSON_WITH_THINKING)

        assert signal.checkpoint.verdict == "clear"
        assert signal.checkpoint.provider == "anthropic"
        assert signal.proceed is True

    async def test_detects_openai_adapter_from_base_url(self, respx_mock: respx.MockRouter) -> None:
        # Mock OpenAI URL
        _mock_fetch_with_verdict(respx_mock, VERDICT_CLEAR, url="https://api.openai.com/v1/messages")

        client = create_client(make_config({
            "analysis_llm": AnalysisLLMConfig(
                model="claude-3-5-haiku-20241022",
                base_url="https://api.openai.com",
                api_key="test-key",
                max_tokens=1024,
            ),
        }))

        signal = await client.check(OPENAI_JSON_WITH_REASONING)

        assert signal.checkpoint.verdict == "clear"
        assert signal.checkpoint.provider == "openai"
        assert signal.proceed is True

    async def test_both_providers_produce_valid_signals_with_correct_model(self, respx_mock: respx.MockRouter) -> None:
        _mock_fetch_with_verdict(respx_mock, VERDICT_CLEAR)
        _mock_fetch_with_verdict(respx_mock, VERDICT_CLEAR, url="https://api.openai.com/v1/messages")

        # Anthropic
        anthropic_client = create_client(make_config({
            "analysis_llm": AnalysisLLMConfig(
                model="claude-3-5-haiku-20241022",
                base_url="https://api.anthropic.com",
                api_key="test-key",
                max_tokens=1024,
            ),
        }))
        anthropic_signal = await anthropic_client.check(ANTHROPIC_JSON_WITH_THINKING)
        assert anthropic_signal.checkpoint.model == "claude-sonnet-4-5-20250514"

        # OpenAI
        openai_client = create_client(make_config({
            "analysis_llm": AnalysisLLMConfig(
                model="claude-3-5-haiku-20241022",
                base_url="https://api.openai.com",
                api_key="test-key",
                max_tokens=1024,
            ),
        }))
        openai_signal = await openai_client.check(OPENAI_JSON_WITH_REASONING)
        assert openai_signal.checkpoint.model == "o1-preview"


# ---------------------------------------------------------------------------
# Scenario 7: Explicit provider override
# ---------------------------------------------------------------------------


class TestScenario7ExplicitProviderOverride:
    """Scenario 7: Explicit provider override."""

    async def test_uses_explicitly_specified_provider(self, respx_mock: respx.MockRouter) -> None:
        _mock_fetch_with_verdict(respx_mock, VERDICT_CLEAR)

        client = create_client(make_config())

        signal = await client.check(ANTHROPIC_JSON_WITH_THINKING, "anthropic")

        assert signal.checkpoint.provider == "anthropic"
        assert signal.checkpoint.verdict == "clear"

    async def test_explicit_provider_produces_valid_checkpoint(self, respx_mock: respx.MockRouter) -> None:
        _mock_fetch_with_verdict(respx_mock, VERDICT_CLEAR)

        client = create_client(make_config())
        signal = await client.check(ANTHROPIC_JSON_WITH_THINKING, "anthropic")

        # Verify all checkpoint fields are present
        assert signal.checkpoint.checkpoint_id.startswith("ic-")
        assert signal.checkpoint.agent_id == FULL_CARD.card_id
        assert signal.checkpoint.card_id == FULL_CARD.card_id
        assert signal.checkpoint.session_id
        assert signal.checkpoint.timestamp
        assert signal.checkpoint.thinking_block_hash
        assert signal.checkpoint.thinking_block_hash != "none"
        assert signal.checkpoint.concerns == []
        assert signal.checkpoint.conscience_context is not None
        assert signal.checkpoint.analysis_metadata is not None
        assert signal.checkpoint.analysis_metadata.analysis_model == "claude-3-5-haiku-20241022"


# ---------------------------------------------------------------------------
# Scenario 8: Window reset clears drift state
# ---------------------------------------------------------------------------


class TestScenario8WindowReset:
    """Scenario 8: Window reset clears drift state."""

    async def test_reset_window_clears_nonclear_streak(self, respx_mock: respx.MockRouter) -> None:
        on_drift_alert = MagicMock()
        client = create_client(make_config({
            "callbacks": AIPCallbacks(on_drift_alert=on_drift_alert),
        }))
        _mock_fetch_sequence(respx_mock, [
            VERDICT_REVIEW_NEEDED,  # streak = 1
            VERDICT_REVIEW_NEEDED,  # streak = 2
            # -- resetWindow here --
            VERDICT_REVIEW_NEEDED,  # streak = 1 (reset)
            VERDICT_REVIEW_NEEDED,  # streak = 2
        ])

        # Two non-clear checks
        await client.check(ANTHROPIC_JSON_WITH_THINKING)
        await client.check(ANTHROPIC_JSON_WITH_THINKING)
        on_drift_alert.assert_not_called()

        # Reset -- clears window AND drift state
        client.reset_window()

        # Two more non-clear checks
        await client.check(ANTHROPIC_JSON_WITH_THINKING)
        await client.check(ANTHROPIC_JSON_WITH_THINKING)

        # Streak is only 2, not 4 -- so no drift alert
        on_drift_alert.assert_not_called()

    async def test_reset_window_also_clears_checkpoints(self, respx_mock: respx.MockRouter) -> None:
        _mock_fetch_sequence(respx_mock, [VERDICT_CLEAR, VERDICT_CLEAR])
        client = create_client(make_config())

        await client.check(ANTHROPIC_JSON_WITH_THINKING)
        await client.check(ANTHROPIC_JSON_WITH_THINKING)
        assert client.get_window_state().size == 2

        client.reset_window()

        state = client.get_window_state()
        assert state.size == 0
        assert state.checkpoints == []
        assert state.stats.total_checks == 0

    async def test_drift_alert_fires_after_reset_plus_3_nonclear(self, respx_mock: respx.MockRouter) -> None:
        on_drift_alert = MagicMock()
        client = create_client(make_config({
            "callbacks": AIPCallbacks(on_drift_alert=on_drift_alert),
        }))
        _mock_fetch_sequence(respx_mock, [
            VERDICT_REVIEW_NEEDED,  # streak = 1
            VERDICT_REVIEW_NEEDED,  # streak = 2
            # -- resetWindow here --
            VERDICT_REVIEW_NEEDED,  # streak = 1
            VERDICT_REVIEW_NEEDED,  # streak = 2
            VERDICT_REVIEW_NEEDED,  # streak = 3 -> alert
        ])

        await client.check(ANTHROPIC_JSON_WITH_THINKING)
        await client.check(ANTHROPIC_JSON_WITH_THINKING)
        client.reset_window()

        await client.check(ANTHROPIC_JSON_WITH_THINKING)
        await client.check(ANTHROPIC_JSON_WITH_THINKING)
        await client.check(ANTHROPIC_JSON_WITH_THINKING)

        assert on_drift_alert.call_count == 1
        alert: IntegrityDriftAlert = on_drift_alert.call_args[0][0]
        assert alert.sustained_checks == 3


# ---------------------------------------------------------------------------
# Scenario 9: Error recovery with fail_open / fail_closed
# ---------------------------------------------------------------------------


class TestScenario9ErrorRecovery:
    """Scenario 9: Error recovery with fail_open."""

    async def test_fail_open_first_check_then_succeeds(self, respx_mock: respx.MockRouter) -> None:
        call_count = 0

        def _side_effect(request: httpx.Request) -> httpx.Response:
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                raise httpx.ConnectError("Network failure")
            return httpx.Response(200, json=_make_analysis_response(VERDICT_CLEAR))

        respx_mock.post("https://api.anthropic.com/v1/messages").mock(side_effect=_side_effect)

        on_error = MagicMock()
        client = create_client(make_config({
            "failure_policy": FailurePolicy(mode="fail_open", analysis_timeout_ms=5000),
            "callbacks": AIPCallbacks(on_error=on_error),
        }))

        # First check: network failure -> fail_open -> synthetic clear
        signal1 = await client.check(ANTHROPIC_JSON_WITH_THINKING)
        assert signal1.checkpoint.verdict == "clear"
        assert signal1.proceed is True
        assert signal1.checkpoint.thinking_block_hash == "none"
        assert "fail-open" in signal1.checkpoint.reasoning_summary

        # on_error should have been called
        assert on_error.call_count == 1

        # Second check: succeeds -> real signal
        signal2 = await client.check(ANTHROPIC_JSON_WITH_THINKING)
        assert signal2.checkpoint.verdict == "clear"
        assert signal2.proceed is True
        assert signal2.checkpoint.thinking_block_hash != "none"

        # Synthetic signals do NOT enter the window.
        # Only the real checkpoint from the second check should be in the window.
        state = client.get_window_state()
        assert state.size == 1
        assert len(state.checkpoints) == 1
        assert state.checkpoints[0].thinking_block_hash != "none"

    async def test_fail_closed_returns_synthetic_boundary_violation(self, respx_mock: respx.MockRouter) -> None:
        respx_mock.post("https://api.anthropic.com/v1/messages").mock(
            side_effect=httpx.ConnectError("Server unavailable"),
        )

        client = create_client(make_config({
            "failure_policy": FailurePolicy(mode="fail_closed", analysis_timeout_ms=5000),
        }))

        signal = await client.check(ANTHROPIC_JSON_WITH_THINKING)

        assert signal.checkpoint.verdict == "boundary_violation"
        assert signal.proceed is False
        assert signal.recommended_action == "deny_and_escalate"
        assert "fail-closed" in signal.checkpoint.reasoning_summary

    async def test_on_error_not_called_when_no_callback_configured(self, respx_mock: respx.MockRouter) -> None:
        respx_mock.post("https://api.anthropic.com/v1/messages").mock(
            side_effect=httpx.ConnectError("Network error"),
        )

        client = create_client(make_config({
            "failure_policy": FailurePolicy(mode="fail_open", analysis_timeout_ms=5000),
            # No callbacks configured
        }))

        # Should not throw despite error
        signal = await client.check(ANTHROPIC_JSON_WITH_THINKING)
        assert signal.checkpoint.verdict == "clear"


# ---------------------------------------------------------------------------
# Scenario 10: HMAC signing round-trip
# ---------------------------------------------------------------------------


class TestScenario10HMACSigning:
    """Scenario 10: HMAC signing round-trip."""

    def test_sign_and_verify_with_correct_secret(self) -> None:
        secret = "webhook-secret-key-12345"
        payload = json.dumps({
            "checkpoint": {
                "checkpoint_id": "ic-test-001",
                "agent_id": "ac-test-full",
                "card_id": "ac-test-full",
                "session_id": "sess-test-001",
                "timestamp": "2025-01-01T00:00:00.000Z",
                "thinking_block_hash": "abc123",
                "provider": "anthropic",
                "model": "claude-sonnet-4-5-20250514",
                "verdict": "clear",
                "concerns": [],
                "reasoning_summary": "Agent reasoning is aligned.",
                "conscience_context": {
                    "values_checked": ["helpfulness", "safety"],
                    "conflicts": [],
                    "supports": ["helpfulness"],
                    "considerations": [],
                    "consultation_depth": "surface",
                },
                "window_position": {"index": 0, "window_size": 1},
                "analysis_metadata": {
                    "analysis_model": "claude-3-5-haiku-20241022",
                    "analysis_duration_ms": 150,
                    "thinking_tokens_original": 50,
                    "thinking_tokens_analyzed": 50,
                    "truncated": False,
                    "extraction_confidence": 1.0,
                },
                "linked_trace_id": None,
            },
            "proceed": True,
            "recommended_action": "continue",
            "window_summary": {
                "size": 1,
                "max_size": 10,
                "verdicts": {"clear": 1, "review_needed": 0, "boundary_violation": 0},
                "integrity_ratio": 1.0,
                "drift_alert_active": False,
            },
        })

        signature = sign_payload(secret, payload)
        assert re.match(r"^sha256=[a-f0-9]{64}$", signature)

        is_valid = verify_signature(secret, payload, signature)
        assert is_valid is True

    def test_verify_with_wrong_secret_fails(self) -> None:
        secret = "correct-secret"
        wrong_secret = "wrong-secret"
        payload = json.dumps({"verdict": "clear", "data": "test-payload"})

        signature = sign_payload(secret, payload)
        is_valid = verify_signature(wrong_secret, payload, signature)
        assert is_valid is False

    def test_verify_with_tampered_payload_fails(self) -> None:
        secret = "test-secret"
        original_payload = json.dumps({"verdict": "clear", "proceed": True})
        tampered_payload = json.dumps({"verdict": "clear", "proceed": False})

        signature = sign_payload(secret, original_payload)
        is_valid = verify_signature(secret, tampered_payload, signature)
        assert is_valid is False

    def test_sign_produces_deterministic_output(self) -> None:
        secret = "deterministic-key"
        payload = '{"test":"data"}'

        sig1 = sign_payload(secret, payload)
        sig2 = sign_payload(secret, payload)
        assert sig1 == sig2

    def test_sign_produces_different_output_for_different_secrets(self) -> None:
        payload = '{"test":"data"}'

        sig1 = sign_payload("secret-A", payload)
        sig2 = sign_payload("secret-B", payload)
        assert sig1 != sig2

    def test_handles_empty_payload(self) -> None:
        secret = "test-secret"
        payload = ""

        signature = sign_payload(secret, payload)
        assert re.match(r"^sha256=[a-f0-9]{64}$", signature)
        assert verify_signature(secret, payload, signature) is True


# ---------------------------------------------------------------------------
# Edge cases: boundary violation verdicts
# ---------------------------------------------------------------------------


class TestBoundaryViolationVerdicts:
    """Edge cases: boundary violation verdicts."""

    async def test_critical_severity_maps_to_deny_and_escalate(self, respx_mock: respx.MockRouter) -> None:
        _mock_fetch_with_verdict(respx_mock, VERDICT_BOUNDARY_INJECTION)
        client = create_client(make_config())

        signal = await client.check(ANTHROPIC_JSON_WITH_THINKING)

        assert signal.checkpoint.verdict == "boundary_violation"
        assert signal.proceed is False
        assert signal.recommended_action == "deny_and_escalate"
        assert len(signal.checkpoint.concerns) > 0
        assert any(c.severity == "critical" for c in signal.checkpoint.concerns)

    async def test_noncritical_severity_maps_to_pause_for_review(self, respx_mock: respx.MockRouter) -> None:
        _mock_fetch_with_verdict(respx_mock, VERDICT_BOUNDARY_DECEPTION)
        client = create_client(make_config())

        signal = await client.check(ANTHROPIC_JSON_WITH_THINKING)

        assert signal.checkpoint.verdict == "boundary_violation"
        assert signal.proceed is False
        # VERDICT_BOUNDARY_DECEPTION has high severity, not critical
        assert signal.recommended_action == "pause_for_review"
        assert len(signal.checkpoint.concerns) == 2


# ---------------------------------------------------------------------------
# Edge cases: mixed verdict types in window
# ---------------------------------------------------------------------------


class TestMixedVerdictWindow:
    """Edge cases: mixed verdict types in window."""

    async def test_window_tracks_all_three_verdict_types(self, respx_mock: respx.MockRouter) -> None:
        _mock_fetch_sequence(respx_mock, [
            VERDICT_CLEAR,
            VERDICT_REVIEW_NEEDED,
            VERDICT_BOUNDARY_INJECTION,
            VERDICT_CLEAR,
        ])

        client = create_client(make_config())

        await client.check(ANTHROPIC_JSON_WITH_THINKING)
        await client.check(ANTHROPIC_JSON_WITH_THINKING)
        await client.check(ANTHROPIC_JSON_WITH_THINKING)
        signal4 = await client.check(ANTHROPIC_JSON_WITH_THINKING)

        assert signal4.window_summary.size == 4
        assert signal4.window_summary.verdicts.clear == 2
        assert signal4.window_summary.verdicts.review_needed == 1
        assert signal4.window_summary.verdicts.boundary_violation == 1
        assert signal4.window_summary.integrity_ratio == 0.5
