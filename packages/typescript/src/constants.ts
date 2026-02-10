/** Protocol version identifiers. */
export const AIP_VERSION = "0.1.0";
export const ALGORITHM_VERSION = "1.0.0";

/** Drift detection thresholds (Section 9.1). */
export const DEFAULT_SUSTAINED_CHECKS_THRESHOLD = 3;
export const DRIFT_SEVERITY_LOW_THRESHOLD = 0.7;
export const DRIFT_SEVERITY_MEDIUM_THRESHOLD = 0.4;

/** Thinking block processing (Section 6.5). */
export const DEFAULT_THINKING_TOKEN_BUDGET = 4096;
export const TRUNCATION_HEAD_RATIO = 0.75;
export const TRUNCATION_TAIL_RATIO = 0.25;
export const MAX_EVIDENCE_LENGTH = 200;

/** Analysis LLM defaults (Section 10.5). */
export const DEFAULT_ANALYSIS_TIMEOUT_MS = 10000;
export const DEFAULT_ANALYSIS_MAX_TOKENS = 1024;

/** Window configuration defaults (Section 8.1). */
export const DEFAULT_WINDOW_MAX_SIZE = 10;
export const MIN_WINDOW_SIZE = 3;
export const DEFAULT_WINDOW_MAX_AGE_SECONDS = 3600;

/** Provider extraction confidence levels (Section 7). */
export const CONFIDENCE_NATIVE = 1.0;
export const CONFIDENCE_EXPLICIT = 0.9;
export const CONFIDENCE_FALLBACK = 0.3;

/** Webhook delivery retry policy (Section 10.5). */
export const WEBHOOK_MAX_RETRIES = 3;
export const WEBHOOK_RETRY_DELAYS_MS = [1000, 4000, 16000] as const;

/** HTTP content type and headers (Section 10.3, 15.2). */
export const AIP_CONTENT_TYPE = "application/aip+json";
export const AIP_VERSION_HEADER = "X-AIP-Version";
export const AIP_SIGNATURE_HEADER = "X-AIP-Signature";

/** ID prefixes for protocol entities. */
export const CHECKPOINT_ID_PREFIX = "ic-";
export const DRIFT_ALERT_ID_PREFIX = "ida-";
export const REGISTRATION_ID_PREFIX = "reg-";
