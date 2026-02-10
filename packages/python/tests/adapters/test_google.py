"""Tests for GoogleAdapter.

Ported from test/adapters/google.test.ts.
"""

from __future__ import annotations

import json

import pytest

from aip.adapters.google import GoogleAdapter
from tests.fixtures import (
    GOOGLE_JSON_NO_THINKING,
    GOOGLE_JSON_WITH_THINKING,
)


@pytest.fixture
def adapter() -> GoogleAdapter:
    return GoogleAdapter()


# ---------------------------------------------------------------------------
# extract_thinking (JSON)
# ---------------------------------------------------------------------------

class TestExtractThinking:
    """GoogleAdapter.extract_thinking tests."""

    def test_extracts_thinking_from_thought_true_parts(self, adapter: GoogleAdapter) -> None:
        result = adapter.extract_thinking(GOOGLE_JSON_WITH_THINKING)

        assert result is not None
        assert result.content == "Let me consider this carefully."

    def test_returns_none_without_thinking_parts(self, adapter: GoogleAdapter) -> None:
        result = adapter.extract_thinking(GOOGLE_JSON_NO_THINKING)

        assert result is None

    def test_returns_none_for_invalid_json(self, adapter: GoogleAdapter) -> None:
        result = adapter.extract_thinking("not valid json {{{")

        assert result is None

    def test_has_correct_provider_method_confidence(self, adapter: GoogleAdapter) -> None:
        result = adapter.extract_thinking(GOOGLE_JSON_WITH_THINKING)

        assert result is not None
        assert result.provider == "google"
        assert result.extraction_method == "native_thinking"
        assert result.confidence == 0.9

    def test_concatenates_multiple_thought_parts(self, adapter: GoogleAdapter) -> None:
        multi_thinking_response = json.dumps({
            "candidates": [{
                "content": {
                    "parts": [
                        {"text": "First thinking step.", "thought": True},
                        {"text": "Here is a normal response."},
                        {"text": "Second thinking step.", "thought": True},
                    ],
                    "role": "model",
                },
                "finishReason": "STOP",
            }],
            "modelVersion": "gemini-2.0-flash-thinking-exp",
        })

        result = adapter.extract_thinking(multi_thinking_response)

        assert result is not None
        assert result.content == "First thinking step.\n\n---\n\nSecond thinking step."
        assert result.model == "gemini-2.0-flash-thinking-exp"


# ---------------------------------------------------------------------------
# extract_thinking_from_stream (SSE)
# ---------------------------------------------------------------------------

class TestExtractThinkingFromStream:
    """GoogleAdapter.extract_thinking_from_stream tests."""

    def test_extracts_thinking_from_sse_stream(self, adapter: GoogleAdapter) -> None:
        sse_body = "\n".join([
            'data: {"candidates":[{"content":{"parts":[{"text":"Let me think about this.","thought":true}],"role":"model"}}],"modelVersion":"gemini-2.0-flash-thinking-exp"}',
            'data: {"candidates":[{"content":{"parts":[{"text":"Here is my answer."}],"role":"model"}}],"modelVersion":"gemini-2.0-flash-thinking-exp"}',
        ])

        result = adapter.extract_thinking_from_stream(sse_body)

        assert result is not None
        assert result.content == "Let me think about this."
        assert result.provider == "google"
        assert result.model == "gemini-2.0-flash-thinking-exp"
        assert result.extraction_method == "native_thinking"
        assert result.confidence == 0.9

    def test_returns_none_when_no_thinking_in_stream(self, adapter: GoogleAdapter) -> None:
        sse_body = "\n".join([
            'data: {"candidates":[{"content":{"parts":[{"text":"Just a normal response."}],"role":"model"}}],"modelVersion":"gemini-2.0-flash"}',
        ])

        result = adapter.extract_thinking_from_stream(sse_body)

        assert result is None
