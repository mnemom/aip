"""Tests for AnthropicAdapter.

Ported from test/adapters/anthropic.test.ts.
"""

from __future__ import annotations

import json

import pytest

from aip.adapters.anthropic import AnthropicAdapter
from tests.fixtures import (
    ANTHROPIC_JSON_MULTI_THINKING,
    ANTHROPIC_JSON_NO_THINKING,
    ANTHROPIC_JSON_WITH_THINKING,
    ANTHROPIC_SSE_WITH_THINKING,
)


@pytest.fixture
def adapter() -> AnthropicAdapter:
    return AnthropicAdapter()


# ---------------------------------------------------------------------------
# extract_thinking (JSON)
# ---------------------------------------------------------------------------

class TestExtractThinkingJSON:
    """AnthropicAdapter.extract_thinking (JSON) tests."""

    def test_extracts_thinking_from_response_with_thinking_block(self, adapter: AnthropicAdapter) -> None:
        result = adapter.extract_thinking(ANTHROPIC_JSON_WITH_THINKING)

        assert result is not None
        assert result.content == "Let me analyze this request carefully. The user wants help with their code. I should consider what kind of assistance would be most useful here. First, I need to understand the problem they are facing with their implementation. Then I can provide clear, well-structured guidance that addresses their specific needs. I will review the code for potential issues and suggest improvements where appropriate. Let me make sure my response is accurate and helpful."

    def test_returns_none_without_thinking_blocks(self, adapter: AnthropicAdapter) -> None:
        result = adapter.extract_thinking(ANTHROPIC_JSON_NO_THINKING)

        assert result is None

    def test_returns_none_for_invalid_json(self, adapter: AnthropicAdapter) -> None:
        result = adapter.extract_thinking("not valid json {{{")

        assert result is None

    def test_returns_none_for_empty_string(self, adapter: AnthropicAdapter) -> None:
        result = adapter.extract_thinking("")

        assert result is None

    def test_has_correct_provider(self, adapter: AnthropicAdapter) -> None:
        result = adapter.extract_thinking(ANTHROPIC_JSON_WITH_THINKING)

        assert result is not None
        assert result.provider == "anthropic"

    def test_has_correct_extraction_method(self, adapter: AnthropicAdapter) -> None:
        result = adapter.extract_thinking(ANTHROPIC_JSON_WITH_THINKING)

        assert result is not None
        assert result.extraction_method == "native_thinking"

    def test_has_correct_confidence(self, adapter: AnthropicAdapter) -> None:
        result = adapter.extract_thinking(ANTHROPIC_JSON_WITH_THINKING)

        assert result is not None
        assert result.confidence == 1.0

    def test_extracts_model_from_response(self, adapter: AnthropicAdapter) -> None:
        result = adapter.extract_thinking(ANTHROPIC_JSON_WITH_THINKING)

        assert result is not None
        assert result.model == "claude-sonnet-4-5-20250514"

    def test_concatenates_multiple_thinking_blocks_with_separator(self, adapter: AnthropicAdapter) -> None:
        result = adapter.extract_thinking(ANTHROPIC_JSON_MULTI_THINKING)

        assert result is not None
        assert result.content == "First, let me understand the problem.\n\n---\n\nNow let me evaluate the second approach."

    def test_truncated_is_false(self, adapter: AnthropicAdapter) -> None:
        result = adapter.extract_thinking(ANTHROPIC_JSON_WITH_THINKING)

        assert result is not None
        assert result.truncated is False

    def test_returns_none_for_empty_content_array(self, adapter: AnthropicAdapter) -> None:
        body = json.dumps({
            "id": "msg_test_empty",
            "type": "message",
            "role": "assistant",
            "model": "claude-sonnet-4-5-20250514",
            "content": [],
            "stop_reason": "end_turn",
            "usage": {"input_tokens": 10, "output_tokens": 0},
        })

        result = adapter.extract_thinking(body)

        assert result is None

    def test_returns_none_for_only_text_blocks(self, adapter: AnthropicAdapter) -> None:
        body = json.dumps({
            "id": "msg_test_textonly",
            "type": "message",
            "role": "assistant",
            "model": "claude-sonnet-4-5-20250514",
            "content": [
                {"type": "text", "text": "First paragraph."},
                {"type": "text", "text": "Second paragraph."},
            ],
            "stop_reason": "end_turn",
            "usage": {"input_tokens": 50, "output_tokens": 30},
        })

        result = adapter.extract_thinking(body)

        assert result is None


# ---------------------------------------------------------------------------
# extract_thinking_from_stream (SSE)
# ---------------------------------------------------------------------------

class TestExtractThinkingFromStreamSSE:
    """AnthropicAdapter.extract_thinking_from_stream (SSE) tests."""

    def test_extracts_thinking_from_sse_stream(self, adapter: AnthropicAdapter) -> None:
        result = adapter.extract_thinking_from_stream(ANTHROPIC_SSE_WITH_THINKING)

        assert result is not None
        assert result.content == "Let me analyze this."

    def test_extracts_model_from_message_start(self, adapter: AnthropicAdapter) -> None:
        result = adapter.extract_thinking_from_stream(ANTHROPIC_SSE_WITH_THINKING)

        assert result is not None
        assert result.model == "claude-sonnet-4-5-20250514"

    def test_returns_none_for_sse_without_thinking(self, adapter: AnthropicAdapter) -> None:
        sse_body = "\n".join([
            'data: {"type":"message_start","message":{"id":"msg_test_005","type":"message","role":"assistant","model":"claude-sonnet-4-5-20250514","content":[],"stop_reason":null,"usage":{"input_tokens":50,"output_tokens":0}}}',
            'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}',
            'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello there."}}',
            'data: {"type":"content_block_stop","index":0}',
            'data: {"type":"message_stop"}',
        ])

        result = adapter.extract_thinking_from_stream(sse_body)

        assert result is None

    def test_returns_none_for_empty_sse(self, adapter: AnthropicAdapter) -> None:
        result = adapter.extract_thinking_from_stream("")

        assert result is None

    def test_handles_malformed_data_lines(self, adapter: AnthropicAdapter) -> None:
        sse_body = "\n".join([
            "data: not-valid-json",
            "data: {broken",
            'data: {"type":"message_start","message":{"id":"msg_test_006","type":"message","role":"assistant","model":"claude-sonnet-4-5-20250514","content":[],"stop_reason":null,"usage":{"input_tokens":10,"output_tokens":0}}}',
            "event: some_event",
            ": comment line",
            "",
            'data: {"type":"message_stop"}',
        ])

        # Should not throw; no thinking blocks means None
        result = adapter.extract_thinking_from_stream(sse_body)
        assert result is None

    def test_sse_has_correct_provider_method_confidence(self, adapter: AnthropicAdapter) -> None:
        result = adapter.extract_thinking_from_stream(ANTHROPIC_SSE_WITH_THINKING)

        assert result is not None
        assert result.provider == "anthropic"
        assert result.extraction_method == "native_thinking"
        assert result.confidence == 1.0
