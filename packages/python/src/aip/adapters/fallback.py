"""Fallback provider adapter — mirrors packages/typescript/src/adapters/fallback.ts.

Applies heuristic pattern matching to infer reasoning segments from
the model's text output. Confidence is low (CONFIDENCE_FALLBACK = 0.3)
because the extraction is purely inferential.
"""

from __future__ import annotations

import json
import re
from typing import Any, Optional

from aip.adapters.types import ExtractedThinking
from aip.constants import CONFIDENCE_FALLBACK

# Reasoning indicator patterns used to infer thinking from plain text.
# These prefixes commonly appear at the start of sentences when a model
# is narrating its reasoning process, even without native thinking support.
REASONING_INDICATORS: list[str] = [
    "I need to",
    "Let me",
    "I should",
    "My approach",
    "First, I'll",
    "I'm going to",
    "Step 1",
    "Consider",
    "On one hand",
    "However",
    "But",
    "Alternatively",
    "I think",
    "I'll",
]


def _build_reasoning_pattern() -> re.Pattern[str]:
    """Build a regex that matches any sentence starting with a reasoning indicator.

    The pattern captures full sentences (terminated by ``.``, ``!``, ``?``,
    or end-of-string).
    """
    escaped = [re.escape(indicator) for indicator in REASONING_INDICATORS]
    pattern = rf"(?:^|(?<=[.!?]\s))(?:{('|'.join(escaped))})[^.!?]*[.!?]?"
    return re.compile(pattern, re.MULTILINE | re.IGNORECASE)


REASONING_PATTERN = _build_reasoning_pattern()


def _is_record(value: Any) -> bool:
    """Type guard for plain dict objects (equivalent to TS isRecord)."""
    return isinstance(value, dict)


def _extract_text_content(response_body: str) -> Optional[str]:
    """Extract the main text content from a response body string.

    Tries multiple provider formats in order:
    1. Anthropic-like: ``content[0].text``
    2. OpenAI-like: ``choices[0].message.content``
    3. Google-like: ``candidates[0].content.parts[0].text``
    4. Plain string: if parsing fails, use the raw string
    """
    try:
        parsed = json.loads(response_body)
    except (json.JSONDecodeError, TypeError):
        # Not valid JSON -- treat as plain text if non-empty
        return response_body if response_body.strip() else None

    # If parsing results in a plain string, use it directly
    if isinstance(parsed, str):
        return parsed if len(parsed) > 0 else None

    if not _is_record(parsed):
        return None

    # Anthropic-like: content[0].text
    content_array = parsed.get("content")
    if isinstance(content_array, list):
        for block in content_array:
            if (
                _is_record(block)
                and isinstance(block.get("text"), str)
                and len(block["text"]) > 0
            ):
                return str(block["text"])

    # OpenAI-like: choices[0].message.content
    choices = parsed.get("choices")
    if isinstance(choices, list) and len(choices) > 0:
        first_choice = choices[0]
        if _is_record(first_choice):
            message = first_choice.get("message")
            if (
                _is_record(message)
                and isinstance(message.get("content"), str)
                and len(message["content"]) > 0
            ):
                return str(message["content"])

    # Google-like: candidates[0].content.parts[0].text
    candidates = parsed.get("candidates")
    if isinstance(candidates, list) and len(candidates) > 0:
        first_candidate = candidates[0]
        if _is_record(first_candidate):
            content = first_candidate.get("content")
            if _is_record(content):
                parts = content.get("parts")
                if isinstance(parts, list) and len(parts) > 0:
                    first_part = parts[0]
                    if (
                        _is_record(first_part)
                        and isinstance(first_part.get("text"), str)
                        and len(first_part["text"]) > 0
                    ):
                        return str(first_part["text"])

    return None


def _match_reasoning_patterns(
    text: str,
    provider: str,
) -> Optional[ExtractedThinking]:
    """Apply reasoning pattern matching to the given text.

    Returns ``ExtractedThinking`` if reasoning patterns are found,
    or ``None`` if no patterns match.
    """
    matches = [m.strip() for m in REASONING_PATTERN.findall(text)]

    if len(matches) == 0:
        return None

    return ExtractedThinking(
        content=" ".join(matches),
        provider=provider,
        model="unknown",
        extraction_method="response_analysis",
        confidence=CONFIDENCE_FALLBACK,
        truncated=False,
    )


class FallbackAdapter:
    """Fallback provider adapter for models without native thinking support."""

    @property
    def provider(self) -> str:
        return "fallback"

    def extract_thinking(self, response_body: str) -> Optional[ExtractedThinking]:
        """Extract thinking content from a non-streaming response body.

        Attempts to parse the response as JSON and locate the main text
        content using provider-agnostic heuristics (Anthropic-like,
        OpenAI-like, Google-like, or plain string). Then applies pattern
        matching to identify reasoning sentences.
        """
        text = _extract_text_content(response_body)
        if text is None or len(text) == 0:
            return None

        return _match_reasoning_patterns(text, self.provider)

    def extract_thinking_from_stream(self, sse_body: str) -> Optional[ExtractedThinking]:
        """Extract thinking content from an SSE streaming response.

        Accumulates all text deltas from ``data:`` lines, then applies
        the same pattern matching as ``extract_thinking``.
        """
        lines = sse_body.split("\n")
        accumulated = ""

        for line in lines:
            if not line.startswith("data: "):
                continue

            data_str = line[6:]

            if data_str == "[DONE]":
                continue

            try:
                data = json.loads(data_str)
            except (json.JSONDecodeError, TypeError):
                # Non-JSON data line; skip
                continue

            if not _is_record(data):
                continue

            # Anthropic-style: content_block_delta with text_delta
            delta = data.get("delta")
            if _is_record(delta):
                if isinstance(delta.get("text"), str):
                    accumulated += delta["text"]
                    continue
                if isinstance(delta.get("thinking"), str):
                    accumulated += delta["thinking"]
                    continue

            # OpenAI-style: choices[0].delta.content
            choices = data.get("choices")
            if isinstance(choices, list) and len(choices) > 0:
                first_choice = choices[0]
                if _is_record(first_choice):
                    choice_delta = first_choice.get("delta")
                    if (
                        _is_record(choice_delta)
                        and isinstance(choice_delta.get("content"), str)
                    ):
                        accumulated += choice_delta["content"]
                        continue

            # Google-style: candidates[0].content.parts[0].text
            candidates = data.get("candidates")
            if isinstance(candidates, list) and len(candidates) > 0:
                first_candidate = candidates[0]
                if _is_record(first_candidate):
                    content = first_candidate.get("content")
                    if _is_record(content):
                        parts = content.get("parts")
                        if isinstance(parts, list) and len(parts) > 0:
                            first_part = parts[0]
                            if (
                                _is_record(first_part)
                                and isinstance(first_part.get("text"), str)
                            ):
                                accumulated += first_part["text"]

        if len(accumulated) == 0:
            return None

        return _match_reasoning_patterns(accumulated, "fallback")
