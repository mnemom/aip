"""Analysis engine for integrity checking.

Re-exports all public functions and types from the analysis submodules.
"""

from aip.analysis.agreement import validate_agreement
from aip.analysis.card_summary import summarize_card
from aip.analysis.drift import (
    DriftState,
    create_drift_state,
    detect_integrity_drift,
)
from aip.analysis.engine import (
    CheckIntegrityInput,
    ThinkingInput,
    build_signal,
    check_integrity,
    hash_thinking_block,
    map_verdict_to_action,
    map_verdict_to_proceed,
)
from aip.analysis.prompt import (
    BuiltPrompt,
    PromptInput,
    build_conscience_prompt,
)

__all__ = [
    # engine
    "check_integrity",
    "build_signal",
    "map_verdict_to_action",
    "map_verdict_to_proceed",
    "hash_thinking_block",
    "CheckIntegrityInput",
    "ThinkingInput",
    # prompt
    "build_conscience_prompt",
    "PromptInput",
    "BuiltPrompt",
    # drift
    "detect_integrity_drift",
    "create_drift_state",
    "DriftState",
    # agreement
    "validate_agreement",
    # card_summary
    "summarize_card",
]
