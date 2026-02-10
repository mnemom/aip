"""OpenAI provider adapter — mirrors packages/typescript/src/adapters/openai.ts.

Extracts reasoning content from OpenAI API responses (e.g. o1-preview).
Uses ``reasoning_content`` field on messages and deltas, with confidence
level CONFIDENCE_EXPLICIT (0.9) since reasoning is explicitly surfaced
but not via a native thinking block.
"""

from __future__ import annotations

import json
from typing import Any, Optional

from aip.adapters.types import ExtractedThinking
from aip.constants import CONFIDENCE_EXPLICIT


def _is_record(value: Any) -> bool:
    """Type guard for plain dict objects (equivalent to TS isRecord)."""
    return isinstance(value, dict)


class OpenAIAdapter:
    """OpenAI provider adapter."""

    @property
    def provider(self) -> str:
        return "openai"

    def extract_thinking(self, response_body: str) -> Optional[ExtractedThinking]:
        """Extract thinking content from a non-streaming OpenAI response body.

        Looks for ``choices[0].message.reasoning_content`` and returns it
        as extracted thinking if present and non-empty.
        """
        try:
            parsed = json.loads(response_body)
        except (json.JSONDecodeError, TypeError):
            return None

        if not _is_record(parsed):
            return None

        model = parsed.get("model") if isinstance(parsed.get("model"), str) else "unknown"
        choices = parsed.get("choices")

        if not isinstance(choices, list) or len(choices) == 0:
            return None

        first_choice = choices[0]
        if not _is_record(first_choice):
            return None

        message = first_choice.get("message")
        if not _is_record(message):
            return None

        reasoning_content = message.get("reasoning_content")
        if not isinstance(reasoning_content, str) or len(reasoning_content) == 0:
            return None

        return ExtractedThinking(
            content=reasoning_content,
            provider=self.provider,
            model=model,
            extraction_method="reasoning_content",
            confidence=CONFIDENCE_EXPLICIT,
            truncated=False,
        )

    def extract_thinking_from_stream(self, sse_body: str) -> Optional[ExtractedThinking]:
        """Extract thinking content from an OpenAI SSE streaming response.

        Processes Server-Sent Events to accumulate ``reasoning_content`` deltas
        from ``choices[0].delta.reasoning_content`` fields across chunks.
        """
        lines = sse_body.split("\n")

        model = "unknown"
        reasoning = ""

        for line in lines:
            if not line.startswith("data: "):
                continue

            data_str = line[6:]

            if data_str == "[DONE]":
                continue

            try:
                data = json.loads(data_str)
            except (json.JSONDecodeError, TypeError):
                continue

            if not _is_record(data):
                continue

            # Track model from first chunk that has it
            if model == "unknown" and isinstance(data.get("model"), str):
                model = data["model"]

            choices = data.get("choices")
            if not isinstance(choices, list) or len(choices) == 0:
                continue

            first_choice = choices[0]
            if not _is_record(first_choice):
                continue

            delta = first_choice.get("delta")
            if not _is_record(delta):
                continue

            reasoning_content = delta.get("reasoning_content")
            if isinstance(reasoning_content, str):
                reasoning += reasoning_content

        if len(reasoning) == 0:
            return None

        return ExtractedThinking(
            content=reasoning,
            provider=self.provider,
            model=model,
            extraction_method="reasoning_content",
            confidence=CONFIDENCE_EXPLICIT,
            truncated=False,
        )
