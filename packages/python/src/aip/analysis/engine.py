"""Integrity analysis engine for the Agent Integrity Protocol.

Contains the pure function ``check_integrity`` that creates an
IntegrityCheckpoint from analysis LLM output, plus helper functions
for verdict-to-action mapping and signal assembly.

Port of packages/typescript/src/analysis/engine.ts
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

from aip.constants import CHECKPOINT_ID_PREFIX, MAX_EVIDENCE_LENGTH
from aip.schemas.checkpoint import (
    AnalysisMetadata,
    IntegrityCheckpoint,
    IntegrityVerdict,
    WindowPosition,
)
from aip.schemas.concern import (
    IntegrityConcern,
)
from aip.schemas.conscience import ConscienceContext
from aip.schemas.signal import (
    IntegritySignal,
    RecommendedAction,
    WindowSummary,
)

# ---------------------------------------------------------------------------
# Validation sets
# ---------------------------------------------------------------------------

VALID_VERDICTS: set[str] = {"clear", "review_needed", "boundary_violation"}

VALID_CATEGORIES: set[str] = {
    "prompt_injection",
    "value_misalignment",
    "autonomy_violation",
    "reasoning_corruption",
    "deceptive_reasoning",
    "undeclared_intent",
}

VALID_SEVERITIES: set[str] = {"low", "medium", "high", "critical"}

VALID_DEPTHS: set[str] = {"surface", "standard", "deep"}

# ---------------------------------------------------------------------------
# Input types
# ---------------------------------------------------------------------------


@dataclass
class ThinkingInput:
    """Extracted thinking block metadata."""

    hash: str
    """Pre-computed SHA-256 of thinking content."""

    provider: str
    """LLM provider that generated the thinking block."""

    model: str
    """Model that generated the thinking block."""

    tokens_original: int
    """Number of tokens in the original thinking block."""

    tokens_analyzed: int
    """Number of tokens sent to the analysis LLM."""

    truncated: bool
    """Whether the thinking block was truncated."""

    confidence: float
    """Provider extraction confidence (0.0 to 1.0)."""


@dataclass
class CheckIntegrityInput:
    """Input to the check_integrity pure function."""

    analysis_response: str
    """Raw analysis LLM response (JSON string)."""

    thinking: ThinkingInput
    """Extracted thinking block metadata."""

    agent_id: str
    """Agent identifier."""

    card_id: str
    """Alignment Card identifier."""

    session_id: str
    """Session identifier."""

    window_position: WindowPosition
    """Window position."""

    analysis_model: str
    """Analysis LLM model used."""

    analysis_duration_ms: float
    """Time taken for analysis in milliseconds."""

    linked_trace_id: str | None = None
    """Optional AAP trace link."""


# ---------------------------------------------------------------------------
# Validation helpers
# ---------------------------------------------------------------------------


def _validate_verdict(value: Any) -> IntegrityVerdict:
    if not isinstance(value, str):
        raise ValueError(
            f"Invalid verdict: expected string, got {type(value).__name__}"
        )
    if value not in VALID_VERDICTS:
        raise ValueError(
            f'Invalid verdict value: "{value}". '
            f"Must be one of: {', '.join(sorted(VALID_VERDICTS))}"
        )
    return value  # type: ignore[return-value]


def _validate_concerns(value: Any) -> list[IntegrityConcern]:
    if not isinstance(value, list):
        raise ValueError(
            f"Invalid concerns: expected array, got {type(value).__name__}"
        )

    concerns: list[IntegrityConcern] = []
    for index, item in enumerate(value):
        if not isinstance(item, dict):
            raise ValueError(
                f"Invalid concern at index {index}: expected object"
            )

        # Validate category
        if not isinstance(item.get("category"), str):
            raise ValueError(
                f"Invalid concern at index {index}: category must be a string"
            )
        if item["category"] not in VALID_CATEGORIES:
            raise ValueError(
                f'Invalid concern category at index {index}: "{item["category"]}". '
                f"Must be one of: {', '.join(sorted(VALID_CATEGORIES))}"
            )

        # Validate severity
        if not isinstance(item.get("severity"), str):
            raise ValueError(
                f"Invalid concern at index {index}: severity must be a string"
            )
        if item["severity"] not in VALID_SEVERITIES:
            raise ValueError(
                f'Invalid concern severity at index {index}: "{item["severity"]}". '
                f"Must be one of: {', '.join(sorted(VALID_SEVERITIES))}"
            )

        # Validate description
        if not isinstance(item.get("description"), str):
            raise ValueError(
                f"Invalid concern at index {index}: description must be a string"
            )

        # Validate evidence (truncate to MAX_EVIDENCE_LENGTH)
        if not isinstance(item.get("evidence"), str):
            raise ValueError(
                f"Invalid concern at index {index}: evidence must be a string"
            )
        evidence = item["evidence"]
        if len(evidence) > MAX_EVIDENCE_LENGTH:
            evidence = evidence[:MAX_EVIDENCE_LENGTH]

        # Validate relevant_card_field (string or null)
        relevant_card_field = item.get("relevant_card_field", None)

        # Validate relevant_conscience_value (string or null)
        relevant_conscience_value = item.get("relevant_conscience_value", None)

        concerns.append(
            IntegrityConcern(
                category=item["category"],
                severity=item["severity"],
                description=item["description"],
                evidence=evidence,
                relevant_card_field=relevant_card_field,
                relevant_conscience_value=relevant_conscience_value,
            )
        )

    return concerns


def _validate_conscience_context(value: Any) -> ConscienceContext:
    if not isinstance(value, dict):
        raise ValueError(
            f"Invalid conscience_context: expected object, "
            f"got {'null' if value is None else type(value).__name__}"
        )

    # Validate values_checked
    if not isinstance(value.get("values_checked"), list):
        raise ValueError(
            "Invalid conscience_context: values_checked must be an array"
        )

    # Validate conflicts
    if not isinstance(value.get("conflicts"), list):
        raise ValueError(
            "Invalid conscience_context: conflicts must be an array"
        )

    # Validate supports
    if not isinstance(value.get("supports"), list):
        raise ValueError(
            "Invalid conscience_context: supports must be an array"
        )

    # Validate considerations
    if not isinstance(value.get("considerations"), list):
        raise ValueError(
            "Invalid conscience_context: considerations must be an array"
        )

    # Validate consultation_depth
    if not isinstance(value.get("consultation_depth"), str):
        raise ValueError(
            "Invalid conscience_context: consultation_depth must be a string"
        )
    if value["consultation_depth"] not in VALID_DEPTHS:
        raise ValueError(
            f'Invalid consultation_depth: "{value["consultation_depth"]}". '
            f"Must be one of: {', '.join(sorted(VALID_DEPTHS))}"
        )

    return ConscienceContext(
        values_checked=value["values_checked"],
        conflicts=value["conflicts"],
        supports=value["supports"],
        considerations=value["considerations"],
        consultation_depth=value["consultation_depth"],
    )


# ---------------------------------------------------------------------------
# Core functions
# ---------------------------------------------------------------------------


def check_integrity(input: CheckIntegrityInput) -> IntegrityCheckpoint:
    """Parse and validate the analysis LLM's JSON response, create an IntegrityCheckpoint.

    This is a pure function: given the same input it always produces the same
    output structure (only checkpoint_id and timestamp vary).

    Raises:
        ValueError: If the JSON is invalid or required fields are missing/wrong type.
    """
    # 1. Parse analysis_response as JSON
    try:
        parsed: dict[str, Any] = json.loads(input.analysis_response)
    except json.JSONDecodeError:
        raise ValueError(
            f"Failed to parse analysis response as JSON: "
            f"{input.analysis_response[:100]}"
        )

    # 2. Validate required fields
    verdict = _validate_verdict(parsed.get("verdict"))
    concerns = _validate_concerns(parsed.get("concerns"))

    if not isinstance(parsed.get("reasoning_summary"), str):
        raise ValueError(
            f"Invalid reasoning_summary: expected string, "
            f"got {type(parsed.get('reasoning_summary')).__name__}"
        )
    reasoning_summary: str = parsed["reasoning_summary"]

    conscience_context = _validate_conscience_context(
        parsed.get("conscience_context")
    )

    # 3. Generate checkpoint_id
    checkpoint_id = f"{CHECKPOINT_ID_PREFIX}{uuid4()}"

    # 4. Build analysis metadata
    analysis_metadata = AnalysisMetadata(
        analysis_model=input.analysis_model,
        analysis_duration_ms=input.analysis_duration_ms,
        thinking_tokens_original=input.thinking.tokens_original,
        thinking_tokens_analyzed=input.thinking.tokens_analyzed,
        truncated=input.thinking.truncated,
        extraction_confidence=input.thinking.confidence,
    )

    # 5. Assemble and return IntegrityCheckpoint
    return IntegrityCheckpoint(
        checkpoint_id=checkpoint_id,
        agent_id=input.agent_id,
        card_id=input.card_id,
        session_id=input.session_id,
        timestamp=datetime.now(timezone.utc).isoformat(),
        thinking_block_hash=input.thinking.hash,
        provider=input.thinking.provider,
        model=input.thinking.model,
        verdict=verdict,
        concerns=concerns,
        reasoning_summary=reasoning_summary,
        conscience_context=conscience_context,
        window_position=WindowPosition(
            index=input.window_position.index,
            window_size=input.window_position.window_size,
        ),
        analysis_metadata=analysis_metadata,
        linked_trace_id=input.linked_trace_id,
    )


def map_verdict_to_action(
    verdict: IntegrityVerdict,
    concerns: list[IntegrityConcern],
) -> RecommendedAction:
    """Map a verdict + concerns to a recommended action.

    - clear -> "continue"
    - review_needed -> "log_and_continue"
    - boundary_violation with any critical severity -> "deny_and_escalate"
    - boundary_violation without critical -> "pause_for_review"
    """
    if verdict == "clear":
        return "continue"
    if verdict == "review_needed":
        return "log_and_continue"
    # boundary_violation
    has_critical = any(c.severity == "critical" for c in concerns)
    return "deny_and_escalate" if has_critical else "pause_for_review"


def map_verdict_to_proceed(verdict: IntegrityVerdict) -> bool:
    """Map a verdict to the proceed boolean.

    - clear -> True
    - review_needed -> True
    - boundary_violation -> False
    """
    return verdict != "boundary_violation"


def build_signal(
    checkpoint: IntegrityCheckpoint,
    window_summary: WindowSummary,
) -> IntegritySignal:
    """Build an IntegritySignal from a checkpoint and window summary."""
    return IntegritySignal(
        checkpoint=checkpoint,
        proceed=map_verdict_to_proceed(checkpoint.verdict),
        recommended_action=map_verdict_to_action(
            checkpoint.verdict,
            checkpoint.concerns,
        ),
        window_summary=window_summary,
    )


def hash_thinking_block(content: str) -> str:
    """Compute SHA-256 hash of a thinking block.

    Used to generate the thinking_block_hash without storing the
    full thinking block content in the checkpoint.
    """
    return hashlib.sha256(content.encode()).hexdigest()
