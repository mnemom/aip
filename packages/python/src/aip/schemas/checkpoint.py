"""Integrity checkpoint types — mirrors schemas/checkpoint.ts."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal

from aip.schemas.concern import IntegrityConcern
from aip.schemas.conscience import ConscienceContext

IntegrityVerdict = Literal["clear", "review_needed", "boundary_violation"]

VALID_VERDICTS: set[str] = {"clear", "review_needed", "boundary_violation"}


@dataclass
class AnalysisMetadata:
    analysis_model: str
    analysis_duration_ms: float
    thinking_tokens_original: int
    thinking_tokens_analyzed: int
    truncated: bool
    extraction_confidence: float


@dataclass
class WindowPosition:
    index: int
    window_size: int


@dataclass
class IntegrityCheckpoint:
    checkpoint_id: str
    agent_id: str
    card_id: str
    session_id: str
    timestamp: str
    thinking_block_hash: str
    provider: str
    model: str
    verdict: IntegrityVerdict
    concerns: list[IntegrityConcern]
    reasoning_summary: str
    conscience_context: ConscienceContext
    window_position: WindowPosition
    analysis_metadata: AnalysisMetadata
    linked_trace_id: str | None = None
