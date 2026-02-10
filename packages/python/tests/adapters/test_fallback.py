"""Tests for FallbackAdapter.

Ported from test/adapters/fallback.test.ts.
"""

from __future__ import annotations

import json

import pytest

from aip.adapters.fallback import FallbackAdapter
from aip.constants import CONFIDENCE_FALLBACK


@pytest.fixture
def adapter() -> FallbackAdapter:
    return FallbackAdapter()


# ---------------------------------------------------------------------------
# Provider name
# ---------------------------------------------------------------------------

class TestProviderName:
    """FallbackAdapter provider name."""

    def test_has_correct_provider_name(self, adapter: FallbackAdapter) -> None:
        assert adapter.provider == "fallback"


# ---------------------------------------------------------------------------
# extract_thinking
# ---------------------------------------------------------------------------

class TestExtractThinking:
    """FallbackAdapter.extract_thinking tests."""

    def test_extracts_reasoning_patterns_from_plain_text(self, adapter: FallbackAdapter) -> None:
        text = "I need to analyze this problem carefully. Let me break it down. The answer is 42."
        result = adapter.extract_thinking(text)

        assert result is not None
        assert "I need to analyze this problem carefully." in result.content
        assert "Let me break it down." in result.content
        assert result.extraction_method == "response_analysis"
        assert result.confidence == CONFIDENCE_FALLBACK
        assert result.confidence == 0.3
        assert result.provider == "fallback"

    def test_returns_none_when_no_reasoning_patterns(self, adapter: FallbackAdapter) -> None:
        text = "Hello, how can I help?"
        result = adapter.extract_thinking(json.dumps(text))

        assert result is None

    def test_handles_anthropic_like_json(self, adapter: FallbackAdapter) -> None:
        body = json.dumps({
            "content": [
                {
                    "type": "text",
                    "text": "I think this is a good approach. However, we should also consider alternatives.",
                },
            ],
            "model": "some-model",
        })

        result = adapter.extract_thinking(body)

        assert result is not None
        assert "I think" in result.content
        assert "However" in result.content
        assert result.extraction_method == "response_analysis"
        assert result.confidence == CONFIDENCE_FALLBACK

    def test_handles_openai_like_json(self, adapter: FallbackAdapter) -> None:
        body = json.dumps({
            "choices": [
                {
                    "message": {
                        "content": "I should consider multiple options. First, I'll look at the data. Alternatively, we could try a different method.",
                    },
                },
            ],
            "model": "gpt-4",
        })

        result = adapter.extract_thinking(body)

        assert result is not None
        assert "I should" in result.content
        assert result.extraction_method == "response_analysis"
        assert result.confidence == CONFIDENCE_FALLBACK

    def test_returns_none_for_empty_content(self, adapter: FallbackAdapter) -> None:
        empty_bodies = [
            "",
            json.dumps({"content": []}),
            json.dumps({"choices": [{"message": {"content": ""}}]}),
        ]

        for body in empty_bodies:
            result = adapter.extract_thinking(body)
            assert result is None

    def test_has_correct_method_confidence_and_model(self, adapter: FallbackAdapter) -> None:
        text = "Let me think about this. I need to consider the edge cases."
        result = adapter.extract_thinking(text)

        assert result is not None
        assert result.extraction_method == "response_analysis"
        assert result.confidence == 0.3
        assert result.truncated is False
        assert result.model == "unknown"


# ---------------------------------------------------------------------------
# extract_thinking_from_stream (SSE)
# ---------------------------------------------------------------------------

class TestExtractThinkingFromStream:
    """FallbackAdapter.extract_thinking_from_stream tests."""

    def test_extracts_reasoning_from_accumulated_stream_text(self, adapter: FallbackAdapter) -> None:
        sse = "\n".join([
            'data: {"choices":[{"delta":{"content":"I need to "}}]}',
            'data: {"choices":[{"delta":{"content":"analyze this carefully. "}}]}',
            'data: {"choices":[{"delta":{"content":"The result is 42."}}]}',
            'data: [DONE]',
        ])

        result = adapter.extract_thinking_from_stream(sse)

        assert result is not None
        assert "I need to analyze this carefully." in result.content
        assert result.extraction_method == "response_analysis"
        assert result.confidence == CONFIDENCE_FALLBACK

    def test_returns_none_when_stream_has_no_reasoning(self, adapter: FallbackAdapter) -> None:
        sse = "\n".join([
            'data: {"choices":[{"delta":{"content":"Hello! "}}]}',
            'data: {"choices":[{"delta":{"content":"How can I help you today?"}}]}',
            'data: [DONE]',
        ])

        result = adapter.extract_thinking_from_stream(sse)

        assert result is None
