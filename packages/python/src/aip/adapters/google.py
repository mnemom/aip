"""Google / Gemini provider adapter — mirrors packages/typescript/src/adapters/google.ts.

Extracts thinking content from Google Gemini API responses.
Gemini surfaces thinking as content parts with ``thought: true``.
Confidence is 0.9 (CONFIDENCE_EXPLICIT) because the thinking flag
is an explicit but secondary signal compared to Anthropic's native
first-class thinking blocks.
"""

from __future__ import annotations

import json
from typing import Any, Optional

from aip.adapters.types import ExtractedThinking
from aip.constants import CONFIDENCE_EXPLICIT


def _is_record(value: Any) -> bool:
    """Type guard for plain dict objects (equivalent to TS isRecord)."""
    return isinstance(value, dict)


class GoogleAdapter:
    """Google / Gemini provider adapter."""

    @property
    def provider(self) -> str:
        return "google"

    def extract_thinking(self, response_body: str) -> Optional[ExtractedThinking]:
        """Extract thinking content from a non-streaming Google Gemini response body.

        Navigates to ``candidates[0].content.parts`` and filters for parts
        where ``thought is True``, collecting their ``text`` fields.
        """
        try:
            parsed = json.loads(response_body)
        except (json.JSONDecodeError, TypeError):
            return None

        if not _is_record(parsed):
            return None

        model = (
            parsed.get("modelVersion")
            if isinstance(parsed.get("modelVersion"), str)
            else "unknown"
        )
        candidates = parsed.get("candidates")

        if not isinstance(candidates, list):
            return None

        if len(candidates) == 0:
            return None

        first_candidate = candidates[0]
        if not _is_record(first_candidate):
            return None

        content = first_candidate.get("content")
        if not _is_record(content):
            return None

        parts = content.get("parts")
        if not isinstance(parts, list):
            return None

        thinking_texts: list[str] = []

        for part in parts:
            if (
                _is_record(part)
                and part.get("thought") is True
                and isinstance(part.get("text"), str)
            ):
                thinking_texts.append(part["text"])

        if len(thinking_texts) == 0:
            return None

        return ExtractedThinking(
            content="\n\n---\n\n".join(thinking_texts),
            provider=self.provider,
            model=model,
            extraction_method="native_thinking",
            confidence=CONFIDENCE_EXPLICIT,
            truncated=False,
        )

    def extract_thinking_from_stream(self, sse_body: str) -> Optional[ExtractedThinking]:
        """Extract thinking content from a Google Gemini SSE streaming response.

        Processes Server-Sent Events, parsing each ``data: `` line as JSON
        and looking for ``candidates[0].content.parts`` where ``thought is True``.
        """
        lines = sse_body.split("\n")

        model = "unknown"
        thinking_texts: list[str] = []

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

            # Track model from modelVersion field
            if isinstance(data.get("modelVersion"), str):
                model = data["modelVersion"]

            candidates = data.get("candidates")
            if not isinstance(candidates, list):
                continue

            if len(candidates) == 0:
                continue

            first_candidate = candidates[0]
            if not _is_record(first_candidate):
                continue

            content = first_candidate.get("content")
            if not _is_record(content):
                continue

            parts = content.get("parts")
            if not isinstance(parts, list):
                continue

            for part in parts:
                if (
                    _is_record(part)
                    and part.get("thought") is True
                    and isinstance(part.get("text"), str)
                ):
                    thinking_texts.append(part["text"])

        if len(thinking_texts) == 0:
            return None

        return ExtractedThinking(
            content="\n\n---\n\n".join(thinking_texts),
            provider=self.provider,
            model=model,
            extraction_method="native_thinking",
            confidence=CONFIDENCE_EXPLICIT,
            truncated=False,
        )
