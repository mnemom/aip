"""Tests for OpenAIAdapter.

Ported from test/adapters/openai.test.ts.
"""

from __future__ import annotations

import json

import pytest

from aip.adapters.openai import OpenAIAdapter
from tests.fixtures import (
    OPENAI_JSON_NO_REASONING,
    OPENAI_JSON_WITH_REASONING,
)


@pytest.fixture
def adapter() -> OpenAIAdapter:
    return OpenAIAdapter()


# ---------------------------------------------------------------------------
# extract_thinking (JSON)
# ---------------------------------------------------------------------------

class TestExtractThinking:
    """OpenAIAdapter.extract_thinking tests."""

    def test_extracts_reasoning_content_from_o1_response(self, adapter: OpenAIAdapter) -> None:
        result = adapter.extract_thinking(OPENAI_JSON_WITH_REASONING)

        assert result is not None
        assert result.content == "Let me think about this step by step. The user needs help with their API design."
        assert result.model == "o1-preview"
        assert result.truncated is False

    def test_returns_none_without_reasoning_content(self, adapter: OpenAIAdapter) -> None:
        result = adapter.extract_thinking(OPENAI_JSON_NO_REASONING)

        assert result is None

    def test_returns_none_for_invalid_json(self, adapter: OpenAIAdapter) -> None:
        result = adapter.extract_thinking("not valid json {{{")

        assert result is None

    def test_has_correct_provider_method_confidence(self, adapter: OpenAIAdapter) -> None:
        result = adapter.extract_thinking(OPENAI_JSON_WITH_REASONING)

        assert result is not None
        assert result.provider == "openai"
        assert result.extraction_method == "reasoning_content"
        assert result.confidence == 0.9

    def test_returns_none_for_empty_reasoning_content(self, adapter: OpenAIAdapter) -> None:
        body = json.dumps({
            "id": "chatcmpl-test-empty",
            "object": "chat.completion",
            "model": "o1-preview",
            "choices": [{
                "index": 0,
                "message": {
                    "role": "assistant",
                    "content": "Response.",
                    "reasoning_content": "",
                },
                "finish_reason": "stop",
            }],
            "usage": {"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15},
        })

        result = adapter.extract_thinking(body)

        assert result is None


# ---------------------------------------------------------------------------
# extract_thinking_from_stream (SSE)
# ---------------------------------------------------------------------------

class TestExtractThinkingFromStream:
    """OpenAIAdapter.extract_thinking_from_stream tests."""

    def test_accumulates_reasoning_deltas_from_sse(self, adapter: OpenAIAdapter) -> None:
        sse_body = "\n".join([
            'data: {"id":"chatcmpl-stream-001","object":"chat.completion.chunk","model":"o1-preview","choices":[{"index":0,"delta":{"role":"assistant","reasoning_content":"Let me "},"finish_reason":null}]}',
            'data: {"id":"chatcmpl-stream-001","object":"chat.completion.chunk","model":"o1-preview","choices":[{"index":0,"delta":{"reasoning_content":"think about "},"finish_reason":null}]}',
            'data: {"id":"chatcmpl-stream-001","object":"chat.completion.chunk","model":"o1-preview","choices":[{"index":0,"delta":{"reasoning_content":"this carefully."},"finish_reason":null}]}',
            'data: {"id":"chatcmpl-stream-001","object":"chat.completion.chunk","model":"o1-preview","choices":[{"index":0,"delta":{"content":"Here is my answer."},"finish_reason":null}]}',
            'data: {"id":"chatcmpl-stream-001","object":"chat.completion.chunk","model":"o1-preview","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}',
            'data: [DONE]',
        ])

        result = adapter.extract_thinking_from_stream(sse_body)

        assert result is not None
        assert result.content == "Let me think about this carefully."
        assert result.provider == "openai"
        assert result.model == "o1-preview"
        assert result.extraction_method == "reasoning_content"
        assert result.confidence == 0.9
        assert result.truncated is False

    def test_returns_none_when_no_reasoning_in_stream(self, adapter: OpenAIAdapter) -> None:
        sse_body = "\n".join([
            'data: {"id":"chatcmpl-stream-002","object":"chat.completion.chunk","model":"gpt-4","choices":[{"index":0,"delta":{"role":"assistant","content":"Hello "},"finish_reason":null}]}',
            'data: {"id":"chatcmpl-stream-002","object":"chat.completion.chunk","model":"gpt-4","choices":[{"index":0,"delta":{"content":"world."},"finish_reason":null}]}',
            'data: {"id":"chatcmpl-stream-002","object":"chat.completion.chunk","model":"gpt-4","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}',
            'data: [DONE]',
        ])

        result = adapter.extract_thinking_from_stream(sse_body)

        assert result is None
