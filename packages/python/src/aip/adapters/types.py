"""Adapter types — mirrors packages/typescript/src/adapters/types.ts."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal, Protocol

ExtractionMethod = Literal["native_thinking", "reasoning_content", "response_analysis"]


@dataclass
class ExtractedThinking:
    """Extracted thinking block from a provider response."""

    content: str
    provider: str
    model: str
    extraction_method: ExtractionMethod
    confidence: float  # 0.0-1.0
    truncated: bool


class ProviderAdapter(Protocol):
    """Interface all provider adapters must implement."""

    @property
    def provider(self) -> str: ...

    def extract_thinking(self, response_body: str) -> ExtractedThinking | None: ...

    def extract_thinking_from_stream(self, sse_body: str) -> ExtractedThinking | None: ...
