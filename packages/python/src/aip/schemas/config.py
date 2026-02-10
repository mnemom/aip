"""Configuration types — mirrors schemas/config.ts."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Callable, Literal

from aip.schemas.conscience import ConscienceValue
from aip.schemas.drift_alert import IntegrityDriftAlert
from aip.schemas.signal import IntegritySignal

WindowMode = Literal["sliding", "fixed"]
SessionBoundary = Literal["reset", "carry"]
FailureMode = Literal["fail_open", "fail_closed"]


@dataclass
class EscalationTrigger:
    condition: str
    action: str
    reason: str | None = None


@dataclass
class AlignmentCardValue:
    name: str
    priority: int
    description: str | None = None


@dataclass
class AutonomyEnvelope:
    bounded_actions: list[str] = field(default_factory=list)
    forbidden_actions: list[str] = field(default_factory=list)
    escalation_triggers: list[EscalationTrigger] = field(default_factory=list)


@dataclass
class AlignmentCard:
    card_id: str
    values: list[AlignmentCardValue]
    autonomy_envelope: AutonomyEnvelope


@dataclass
class WindowConfig:
    max_size: int = 10
    mode: WindowMode = "sliding"
    session_boundary: SessionBoundary = "reset"
    max_age_seconds: int = 3600


@dataclass
class FailurePolicy:
    mode: FailureMode = "fail_open"
    analysis_timeout_ms: int = 10000


@dataclass
class AnalysisLLMConfig:
    model: str
    base_url: str
    api_key: str
    max_tokens: int = 1024


@dataclass
class AIPCallbacks:
    on_verdict: Callable[[IntegritySignal], Any] | None = None
    on_drift_alert: Callable[[IntegrityDriftAlert], Any] | None = None
    on_error: Callable[[Exception], Any] | None = None


@dataclass
class AIPConfig:
    card: AlignmentCard
    analysis_llm: AnalysisLLMConfig
    window: WindowConfig
    agent_id: str | None = None
    conscience_values: list[ConscienceValue] | None = None
    callbacks: AIPCallbacks | None = None
    failure_policy: FailurePolicy | None = None
