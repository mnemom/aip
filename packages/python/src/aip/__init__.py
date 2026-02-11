"""Agent Integrity Protocol -- real-time thinking block analysis for AI agent alignment."""

# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------
# ---------------------------------------------------------------------------
# Adapters
# ---------------------------------------------------------------------------
from aip.adapters import (
    AdapterRegistry,
    AnthropicAdapter,
    ExtractedThinking,
    ExtractionMethod,
    FallbackAdapter,
    GoogleAdapter,
    OpenAIAdapter,
    ProviderAdapter,
    create_adapter_registry,
)

# ---------------------------------------------------------------------------
# Analysis
# ---------------------------------------------------------------------------
from aip.analysis import (
    BuiltPrompt,
    CheckIntegrityInput,
    DriftState,
    PromptInput,
    ThinkingInput,
    build_conscience_prompt,
    build_signal,
    check_integrity,
    create_drift_state,
    detect_integrity_drift,
    hash_thinking_block,
    map_verdict_to_action,
    map_verdict_to_proceed,
    summarize_card,
    validate_agreement,
)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
from aip.constants import (
    AIP_CONTENT_TYPE,
    AIP_SIGNATURE_HEADER,
    AIP_VERSION,
    AIP_VERSION_HEADER,
    ALGORITHM_VERSION,
    CHECKPOINT_ID_PREFIX,
    CONFIDENCE_EXPLICIT,
    CONFIDENCE_FALLBACK,
    CONFIDENCE_NATIVE,
    DEFAULT_ANALYSIS_MAX_TOKENS,
    DEFAULT_ANALYSIS_TIMEOUT_MS,
    DEFAULT_CONSCIENCE_VALUES,
    DEFAULT_SUSTAINED_CHECKS_THRESHOLD,
    DEFAULT_THINKING_TOKEN_BUDGET,
    DEFAULT_WINDOW_MAX_AGE_SECONDS,
    DEFAULT_WINDOW_MAX_SIZE,
    DRIFT_ALERT_ID_PREFIX,
    DRIFT_SEVERITY_LOW_THRESHOLD,
    DRIFT_SEVERITY_MEDIUM_THRESHOLD,
    MAX_EVIDENCE_LENGTH,
    MIN_WINDOW_SIZE,
    REGISTRATION_ID_PREFIX,
    TRUNCATION_HEAD_RATIO,
    TRUNCATION_TAIL_RATIO,
    WEBHOOK_MAX_RETRIES,
    WEBHOOK_RETRY_DELAYS_MS,
)
from aip.schemas import (
    # config
    AIPCallbacks,
    AIPConfig,
    AlignmentCard,
    AlignmentCardValue,
    AnalysisLLMConfig,
    # checkpoint
    AnalysisMetadata,
    AutonomyEnvelope,
    # agreement
    CardConscienceAgreement,
    CardConscienceAugmentation,
    CardConscienceConflict,
    # concern
    ConcernCategory,
    # conscience
    ConscienceContext,
    ConscienceValue,
    ConscienceValueType,
    ConsultationDepth,
    # drift_alert
    DriftDirection,
    EscalationTrigger,
    FailureMode,
    FailurePolicy,
    IntegrityCheckpoint,
    IntegrityConcern,
    IntegrityDriftAlert,
    IntegritySeverity,
    # signal
    IntegritySignal,
    IntegrityVerdict,
    RecommendedAction,
    SessionBoundary,
    VerdictCounts,
    WindowConfig,
    WindowMode,
    WindowPosition,
    WindowSummary,
)

# ---------------------------------------------------------------------------
# SDK
# ---------------------------------------------------------------------------
from aip.sdk import (
    AIPClient,
    create_client,
    sign_payload,
    verify_signature,
)

# ---------------------------------------------------------------------------
# Window
# ---------------------------------------------------------------------------
from aip.window import (
    WindowManager,
    WindowState,
    WindowStats,
    create_window_state,
)

__all__ = [
    # Schemas: agreement
    "CardConscienceAgreement",
    "CardConscienceAugmentation",
    "CardConscienceConflict",
    # Schemas: checkpoint
    "AnalysisMetadata",
    "IntegrityCheckpoint",
    "IntegrityVerdict",
    "WindowPosition",
    # Schemas: concern
    "ConcernCategory",
    "IntegrityConcern",
    "IntegritySeverity",
    # Schemas: config
    "AIPCallbacks",
    "AIPConfig",
    "AlignmentCard",
    "AlignmentCardValue",
    "AnalysisLLMConfig",
    "AutonomyEnvelope",
    "EscalationTrigger",
    "FailureMode",
    "FailurePolicy",
    "SessionBoundary",
    "WindowConfig",
    "WindowMode",
    # Schemas: conscience
    "ConscienceContext",
    "ConscienceValue",
    "ConscienceValueType",
    "ConsultationDepth",
    # Schemas: drift_alert
    "DriftDirection",
    "IntegrityDriftAlert",
    # Schemas: signal
    "IntegritySignal",
    "RecommendedAction",
    "VerdictCounts",
    "WindowSummary",
    # Adapters
    "AdapterRegistry",
    "AnthropicAdapter",
    "ExtractedThinking",
    "ExtractionMethod",
    "FallbackAdapter",
    "GoogleAdapter",
    "OpenAIAdapter",
    "ProviderAdapter",
    "create_adapter_registry",
    # Analysis
    "BuiltPrompt",
    "CheckIntegrityInput",
    "DriftState",
    "PromptInput",
    "ThinkingInput",
    "build_conscience_prompt",
    "build_signal",
    "check_integrity",
    "create_drift_state",
    "detect_integrity_drift",
    "hash_thinking_block",
    "map_verdict_to_action",
    "map_verdict_to_proceed",
    "summarize_card",
    "validate_agreement",
    # Window
    "WindowManager",
    "WindowState",
    "WindowStats",
    "create_window_state",
    # SDK
    "AIPClient",
    "create_client",
    "sign_payload",
    "verify_signature",
    # Constants
    "AIP_CONTENT_TYPE",
    "AIP_SIGNATURE_HEADER",
    "AIP_VERSION",
    "AIP_VERSION_HEADER",
    "ALGORITHM_VERSION",
    "CHECKPOINT_ID_PREFIX",
    "CONFIDENCE_EXPLICIT",
    "CONFIDENCE_FALLBACK",
    "CONFIDENCE_NATIVE",
    "DEFAULT_ANALYSIS_MAX_TOKENS",
    "DEFAULT_ANALYSIS_TIMEOUT_MS",
    "DEFAULT_CONSCIENCE_VALUES",
    "DEFAULT_SUSTAINED_CHECKS_THRESHOLD",
    "DEFAULT_THINKING_TOKEN_BUDGET",
    "DEFAULT_WINDOW_MAX_AGE_SECONDS",
    "DEFAULT_WINDOW_MAX_SIZE",
    "DRIFT_ALERT_ID_PREFIX",
    "DRIFT_SEVERITY_LOW_THRESHOLD",
    "DRIFT_SEVERITY_MEDIUM_THRESHOLD",
    "MAX_EVIDENCE_LENGTH",
    "MIN_WINDOW_SIZE",
    "REGISTRATION_ID_PREFIX",
    "TRUNCATION_HEAD_RATIO",
    "TRUNCATION_TAIL_RATIO",
    "WEBHOOK_MAX_RETRIES",
    "WEBHOOK_RETRY_DELAYS_MS",
]
