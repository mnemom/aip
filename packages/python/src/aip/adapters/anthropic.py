"""Anthropic provider adapter — mirrors packages/typescript/src/adapters/anthropic.ts.

Extracts thinking blocks from Anthropic API responses. This is the
highest-confidence adapter (1.0) because Anthropic natively exposes
thinking blocks as first-class content elements.
"""

from __future__ import annotations

import json
from typing import Any

from aip.adapters.types import ExtractedThinking
from aip.constants import CONFIDENCE_NATIVE


def _is_record(value: Any) -> bool:
    """Type guard for plain dict objects (equivalent to TS isRecord)."""
    return isinstance(value, dict)


class AnthropicAdapter:
    """Anthropic provider adapter."""

    @property
    def provider(self) -> str:
        return "anthropic"

    def extract_thinking(self, response_body: str) -> ExtractedThinking | None:
        """Extract thinking content from a non-streaming Anthropic response body.

        Looks for content blocks where ``type == "thinking"`` and concatenates
        their ``thinking`` field values with a separator.
        """
        try:
            parsed = json.loads(response_body)
        except (json.JSONDecodeError, TypeError):
            return None

        if not _is_record(parsed):
            return None

        model = parsed.get("model") if isinstance(parsed.get("model"), str) else "unknown"
        content_array = parsed.get("content")

        if not isinstance(content_array, list):
            return None

        thinking_texts: list[str] = []

        for block in content_array:
            if (
                _is_record(block)
                and block.get("type") == "thinking"
                and isinstance(block.get("thinking"), str)
            ):
                thinking_texts.append(block["thinking"])

        if len(thinking_texts) == 0:
            return None

        return ExtractedThinking(
            content="\n\n---\n\n".join(thinking_texts),
            provider=self.provider,
            model=model,
            extraction_method="native_thinking",
            confidence=CONFIDENCE_NATIVE,
            truncated=False,
        )

    def extract_thinking_from_stream(self, sse_body: str) -> ExtractedThinking | None:
        """Extract thinking content from an Anthropic SSE streaming response.

        Processes Server-Sent Events to accumulate thinking deltas from
        ``content_block_start`` and ``content_block_delta`` events.
        """
        lines = sse_body.split("\n")

        model = "unknown"
        thinking_block_indices: set[int] = set()
        thinking_contents: dict[int, str] = {}

        for line in lines:
            if not line.startswith("data: "):
                continue

            data_str = line[6:]

            try:
                data = json.loads(data_str)
            except (json.JSONDecodeError, TypeError):
                continue

            if not _is_record(data):
                continue

            event_type = data.get("type")

            if event_type == "message_start":
                message = data.get("message")
                if _is_record(message) and isinstance(message.get("model"), str):
                    model = message["model"]

            elif event_type == "content_block_start":
                index = data.get("index")
                content_block = data.get("content_block")
                if (
                    isinstance(index, int)
                    and _is_record(content_block)
                    and content_block.get("type") == "thinking"
                ):
                    thinking_block_indices.add(index)
                    thinking_contents[index] = ""

            elif event_type == "content_block_delta":
                index = data.get("index")
                delta = data.get("delta")
                if (
                    isinstance(index, int)
                    and index in thinking_block_indices
                    and _is_record(delta)
                    and delta.get("type") == "thinking_delta"
                    and isinstance(delta.get("thinking"), str)
                ):
                    thinking_contents[index] = thinking_contents.get(index, "") + delta["thinking"]

        if len(thinking_block_indices) == 0:
            return None

        # Collect thinking contents in block index order
        sorted_indices = sorted(thinking_block_indices)
        thinking_texts: list[str] = []
        for idx in sorted_indices:
            text = thinking_contents.get(idx, "")
            if len(text) > 0:
                thinking_texts.append(text)

        if len(thinking_texts) == 0:
            return None

        return ExtractedThinking(
            content="\n\n---\n\n".join(thinking_texts),
            provider=self.provider,
            model=model,
            extraction_method="native_thinking",
            confidence=CONFIDENCE_NATIVE,
            truncated=False,
        )
