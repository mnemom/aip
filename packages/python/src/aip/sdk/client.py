"""High-level AIP client that orchestrates the full integrity check lifecycle.

Validates card-conscience agreement at creation time, then provides
a simple ``check(response_body)`` method that extracts thinking blocks,
calls the analysis LLM, creates checkpoints, detects drift, and
delivers signals.

Port of packages/typescript/src/sdk/client.ts
"""

from __future__ import annotations

import inspect
import time
from datetime import datetime, timezone
from typing import Any

import httpx

from aip.adapters.registry import AdapterRegistry, create_adapter_registry
from aip.analysis.agreement import validate_agreement
from aip.analysis.drift import DriftState, create_drift_state, detect_integrity_drift
from aip.analysis.engine import (
    CheckIntegrityInput,
    ThinkingInput,
    build_signal,
    check_integrity,
    hash_thinking_block,
)
from aip.analysis.prompt import PromptInput, build_conscience_prompt
from aip.constants import DEFAULT_ANALYSIS_TIMEOUT_MS
from aip.schemas.checkpoint import (
    AnalysisMetadata,
    IntegrityCheckpoint,
    IntegrityVerdict,
    WindowPosition,
)
from aip.schemas.config import AIPConfig
from aip.schemas.conscience import ConscienceContext
from aip.schemas.signal import IntegritySignal
from aip.window.manager import WindowManager
from aip.window.state import WindowState

# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _generate_session_id(card_id: str) -> str:
    """Generate a session ID from card ID and current hour bucket."""
    hash_part = card_id[:8]
    hour_bucket = int(time.time() // 3600)
    return f"sess-{hash_part}-{hour_bucket}"


async def _invoke_callback(callback: Any, *args: Any) -> None:
    """Invoke a callback, handling both sync and async functions."""
    if inspect.iscoroutinefunction(callback):
        await callback(*args)
    else:
        callback(*args)


async def _call_analysis_llm(
    llm_config: Any,
    system: str,
    user: str,
    timeout_ms: int,
) -> str:
    """Call the analysis LLM with the conscience prompt.

    This is the only network call in the SDK.
    Uses the Anthropic Messages API format.

    Raises:
        httpx.HTTPStatusError: If the analysis LLM returns a non-2xx status.
        httpx.TimeoutException: If the request exceeds the timeout.
        ValueError: If the response contains no text content.
    """
    timeout_seconds = timeout_ms / 1000.0

    async with httpx.AsyncClient(timeout=timeout_seconds) as client:
        response = await client.post(
            f"{llm_config.base_url}/v1/messages",
            headers={
                "Content-Type": "application/json",
                "x-api-key": llm_config.api_key,
                "anthropic-version": "2023-06-01",
            },
            json={
                "model": llm_config.model,
                "max_tokens": llm_config.max_tokens,
                "system": system,
                "messages": [{"role": "user", "content": user}],
            },
        )

        if response.status_code >= 400:
            raise httpx.HTTPStatusError(
                f"Analysis LLM returned {response.status_code}: {response.text}",
                request=response.request,
                response=response,
            )

        body = response.json()
        content = body.get("content")

        if not content or len(content) == 0:
            raise ValueError("Analysis LLM returned empty content")

        # Extract text from first text block
        text_block = next(
            (b for b in content if isinstance(b, dict) and b.get("type") == "text"),
            None,
        )
        if text_block is None or not isinstance(text_block.get("text"), str):
            raise ValueError("Analysis LLM returned no text content")

        return str(text_block["text"])


def _build_synthetic_signal(
    config: AIPConfig,
    window: WindowManager,
    verdict: IntegrityVerdict,
) -> IntegritySignal:
    """Build a synthetic signal for cases where no analysis was performed."""
    summary = window.get_summary()

    reasoning = (
        "No thinking block found or analysis unavailable (fail-open)"
        if verdict == "clear"
        else "Analysis failed and failure policy is fail-closed"
    )

    checkpoint = IntegrityCheckpoint(
        checkpoint_id=f"ic-synthetic-{int(time.time() * 1000)}",
        agent_id=config.agent_id or config.card.card_id,
        card_id=config.card.card_id,
        session_id=window.get_session_id(),
        timestamp=datetime.now(timezone.utc).isoformat(),
        thinking_block_hash="none",
        provider="none",
        model="none",
        verdict=verdict,
        concerns=[],
        reasoning_summary=reasoning,
        conscience_context=ConscienceContext(
            values_checked=[],
            conflicts=[],
            supports=[],
            considerations=[],
            consultation_depth="surface",
        ),
        window_position=WindowPosition(
            index=summary.size,
            window_size=summary.size,
        ),
        analysis_metadata=AnalysisMetadata(
            analysis_model="none",
            analysis_duration_ms=0,
            thinking_tokens_original=0,
            thinking_tokens_analyzed=0,
            truncated=False,
            extraction_confidence=0,
        ),
        linked_trace_id=None,
    )

    return IntegritySignal(
        checkpoint=checkpoint,
        proceed=verdict == "clear",
        recommended_action=(
            "continue" if verdict == "clear" else "deny_and_escalate"
        ),
        window_summary=summary,
    )


# ---------------------------------------------------------------------------
# AIPClient
# ---------------------------------------------------------------------------


class AIPClient:
    """Public AIP client for performing integrity checks on provider responses.

    Use :func:`create_client` to instantiate rather than constructing directly.
    """

    def __init__(
        self,
        config: AIPConfig,
        window: WindowManager,
        registry: AdapterRegistry,
        drift_state: DriftState,
        failure_mode: str,
        analysis_timeout: int,
        conscience_values: list[Any],
    ) -> None:
        self._config = config
        self._window = window
        self._registry = registry
        self._drift_state = drift_state
        self._failure_mode = failure_mode
        self._analysis_timeout = analysis_timeout
        self._conscience_values = conscience_values
        self._destroyed = False

    async def check(
        self,
        response_body: str,
        provider: str | None = None,
        task_context: str | None = None,
    ) -> IntegritySignal:
        """Perform an integrity check on a provider response body.

        Full pipeline:
          1. Extract thinking block via adapter
          2. Build conscience prompt
          3. Call analysis LLM
          4. Parse response and create checkpoint
          5. Update window and detect drift
          6. Build signal and invoke callbacks
          7. Return IntegritySignal

        Raises:
            RuntimeError: If the client has been destroyed.
        """
        if self._destroyed:
            raise RuntimeError("AIP client has been destroyed")

        # 1. Extract thinking block
        adapter = (
            self._registry.get(provider)
            if provider
            else self._registry.detect_from_url(self._config.analysis_llm.base_url)
        )
        thinking = adapter.extract_thinking(response_body)

        if thinking is None:
            # No thinking block found -- return synthetic clear signal.
            # This is normal for providers/responses without thinking.
            return _build_synthetic_signal(self._config, self._window, "clear")

        # 2. Build conscience prompt
        prompt = build_conscience_prompt(
            PromptInput(
                card=self._config.card,
                conscience_values=self._conscience_values,
                window_context=self._window.get_state().checkpoints,
                thinking_block=thinking.content,
                task_context=task_context,
            )
        )

        # 3. Call analysis LLM
        start_time = time.monotonic()
        try:
            analysis_response_text = await _call_analysis_llm(
                self._config.analysis_llm,
                prompt.system,
                prompt.user,
                self._analysis_timeout,
            )
        except Exception as error:
            # Analysis failed -- apply failure policy
            if self._config.callbacks and self._config.callbacks.on_error:
                await _invoke_callback(
                    self._config.callbacks.on_error,
                    error if isinstance(error, Exception) else Exception(str(error)),
                )

            if self._failure_mode == "fail_closed":
                return _build_synthetic_signal(
                    self._config, self._window, "boundary_violation"
                )
            # fail_open: return synthetic clear
            return _build_synthetic_signal(self._config, self._window, "clear")

        analysis_duration_ms = (time.monotonic() - start_time) * 1000

        # 4. Parse analysis and create checkpoint
        thinking_hash = hash_thinking_block(thinking.content)
        window_state = self._window.get_state()

        checkpoint = check_integrity(
            CheckIntegrityInput(
                analysis_response=analysis_response_text,
                thinking=ThinkingInput(
                    hash=thinking_hash,
                    provider=thinking.provider,
                    model=thinking.model,
                    tokens_original=prompt.original_tokens,
                    tokens_analyzed=prompt.analyzed_tokens,
                    truncated=prompt.truncated,
                    confidence=thinking.confidence,
                ),
                agent_id=self._config.agent_id or self._config.card.card_id,
                card_id=self._config.card.card_id,
                session_id=self._window.get_session_id(),
                window_position=WindowPosition(
                    index=window_state.size,
                    window_size=window_state.size + 1,
                ),
                analysis_model=self._config.analysis_llm.model,
                analysis_duration_ms=analysis_duration_ms,
            )
        )

        # 5. Update window
        self._window.push(checkpoint)

        # 6. Detect drift
        new_drift_state, drift_alert = detect_integrity_drift(
            self._drift_state,
            checkpoint,
            self._window.get_state().checkpoints,
        )
        self._drift_state = new_drift_state

        # 7. Build signal
        summary = self._window.get_summary()
        if drift_alert is not None:
            summary.drift_alert_active = True
        signal = build_signal(checkpoint, summary)

        # 8. Invoke callbacks
        if self._config.callbacks and self._config.callbacks.on_verdict:
            await _invoke_callback(self._config.callbacks.on_verdict, signal)
        if (
            drift_alert is not None
            and self._config.callbacks
            and self._config.callbacks.on_drift_alert
        ):
            await _invoke_callback(self._config.callbacks.on_drift_alert, drift_alert)

        return signal

    def get_window_state(self) -> WindowState:
        """Get current window state."""
        return self._window.get_state()

    def reset_window(self) -> None:
        """Reset the session window and drift state."""
        self._window.reset()
        self._drift_state = create_drift_state()

    def destroy(self) -> None:
        """Mark the client as destroyed. Subsequent check() calls will raise."""
        self._destroyed = True


# ---------------------------------------------------------------------------
# Factory
# ---------------------------------------------------------------------------


def create_client(config: AIPConfig) -> AIPClient:
    """Create an AIP client instance.

    Validates card-conscience agreement at creation time.

    Raises:
        ValueError: If card-conscience agreement has conflicts.
    """
    # 1. Validate card-conscience agreement
    conscience_values = config.conscience_values or []
    agreement = validate_agreement(config.card, conscience_values)
    if not agreement.valid:
        conflict_descs = "; ".join(c.description for c in agreement.conflicts)
        raise ValueError(
            f"Card-conscience agreement validation failed: {conflict_descs}"
        )

    # 2. Initialize components
    session_id = _generate_session_id(config.card.card_id)
    window = WindowManager(config.window, session_id)
    registry = create_adapter_registry()
    drift_state = create_drift_state()

    # 3. Resolve failure policy
    failure_mode = (
        config.failure_policy.mode if config.failure_policy else "fail_open"
    )
    analysis_timeout = (
        config.failure_policy.analysis_timeout_ms
        if config.failure_policy
        else DEFAULT_ANALYSIS_TIMEOUT_MS
    )

    return AIPClient(
        config=config,
        window=window,
        registry=registry,
        drift_state=drift_state,
        failure_mode=failure_mode,
        analysis_timeout=analysis_timeout,
        conscience_values=conscience_values,
    )
