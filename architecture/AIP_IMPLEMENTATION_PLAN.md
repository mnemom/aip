# AIP Implementation Plan

**Protocol:** Agent Integrity Protocol v0.1.0
**Spec:** `docs/SPEC.md`
**Date:** 2026-02-09
**Sister Implementation:** AAP SDK v0.1.5 (`@mnemom/agent-alignment-protocol`)

---

## 0. Principles

AIP is AAP's sister protocol, built by the same team, for the same ecosystem. The implementation reflects this:

1. **Mirror AAP's SDK structure.** Same directory layout (`schemas/`, top-level API module), same build tooling (tsup, vitest), same export pattern (re-export through `index.ts`), same dual-format output (CJS + ESM + `.d.ts`). A developer who knows AAP should feel at home immediately.

2. **Zero runtime dependencies.** Like AAP, the AIP SDK ships with no runtime dependencies. Pure TypeScript. This keeps it embeddable in Cloudflare Workers, browser environments, and any Node.js project without dependency conflicts.

3. **Schema-first.** Domain types are defined in `schemas/`, business logic in `analysis/`. Types are the contract; functions implement the contract.

4. **Shared types, not duplicated.** AIP imports `AlignmentCard`, `APTrace`, and related types from `@mnemom/agent-alignment-protocol`. It does not redefine them. One source of truth.

5. **Professional consistency.** Same license (Apache-2.0), same npm scope (`@mnemom/`), same documentation style, same test patterns, same CI. The two packages look like they belong together because they do.

---

## 1. Deliverables

| # | Deliverable | Package / Location | Description |
|---|---|---|---|
| 1 | **TypeScript SDK** | `@mnemom/agent-integrity-protocol` | Core protocol library. Provider adapters, analysis engine, windowing, drift detection. Published to npm. |
| 2 | **Python SDK** | `agent-integrity-protocol` | Python port of the TypeScript SDK. Published to PyPI. |
| 3 | **Smoltbot Integration** | `smoltbot/observer`, `smoltbot/api` | AIP wired into the existing Observer Worker and API Worker. |
| 4 | **Database Migration** | `smoltbot/database` | Schema additions for integrity checkpoints and AIP drift alerts. |

Deliverables 1 and 3 are the critical path. Deliverable 2 follows. Deliverable 4 is prerequisite infrastructure for Deliverable 3.

---

## 2. TypeScript SDK

### 2.1 Repository & Package

```
Repository: github.com/mnemom/aip (this repo)
Package:    @mnemom/agent-integrity-protocol
Registry:   npm (public)
License:    Apache-2.0
```

### 2.2 Directory Structure

Mirrors AAP's layout. AAP has `schemas/` + `verification/`; AIP has `schemas/` + `analysis/` + `adapters/`.

```
aip/
├── docs/
│   └── SPEC.md                          # Protocol specification (exists)
├── architecture/
│   └── AIP_IMPLEMENTATION_PLAN.md       # This document (exists)
├── packages/
│   └── typescript/
│       ├── package.json
│       ├── tsconfig.json
│       ├── tsup.config.ts
│       ├── vitest.config.ts
│       ├── README.md
│       ├── LICENSE
│       ├── src/
│       │   ├── index.ts                 # Public API surface (re-exports)
│       │   ├── constants.ts             # Calibrated thresholds
│       │   │
│       │   ├── schemas/                 # Domain types (SPEC §5)
│       │   │   ├── index.ts             # Re-exports
│       │   │   ├── checkpoint.ts        # IntegrityCheckpoint, IntegrityVerdict, etc.
│       │   │   ├── signal.ts            # IntegritySignal, WindowSummary
│       │   │   ├── concern.ts           # IntegrityConcern, ConcernCategory, IntegritySeverity
│       │   │   ├── conscience.ts        # ConscienceContext, ConscienceValue
│       │   │   ├── drift-alert.ts       # IntegrityDriftAlert, DriftDirection
│       │   │   ├── config.ts            # AIPConfig, WindowConfig, AnalysisLLMConfig, FailurePolicy
│       │   │   └── agreement.ts         # CardConscienceAgreement
│       │   │
│       │   ├── adapters/                # Provider adapters (SPEC §7)
│       │   │   ├── index.ts             # Re-exports + adapter registry
│       │   │   ├── types.ts             # ProviderAdapter, ExtractedThinking interfaces
│       │   │   ├── anthropic.ts         # Anthropic adapter (JSON + SSE)
│       │   │   ├── openai.ts            # OpenAI adapter (JSON + SSE)
│       │   │   ├── google.ts            # Google/Gemini adapter (JSON + SSE)
│       │   │   └── fallback.ts          # Response text analysis adapter
│       │   │
│       │   ├── analysis/                # Integrity analysis engine (SPEC §6, §9)
│       │   │   ├── index.ts             # Re-exports
│       │   │   ├── engine.ts            # Core: check() function
│       │   │   ├── prompt.ts            # Conscience prompt builder (SPEC §6.1–6.7)
│       │   │   ├── card-summary.ts      # AlignmentCard → ~500 token summary
│       │   │   ├── drift.ts             # Integrity drift detection (SPEC §9.3)
│       │   │   └── agreement.ts         # Card-conscience agreement validation (SPEC §11)
│       │   │
│       │   ├── window/                  # Session windowing (SPEC §8)
│       │   │   ├── index.ts             # Re-exports
│       │   │   ├── manager.ts           # WindowManager: push, getContext, reset, getSummary
│       │   │   └── state.ts             # WindowState type + operations
│       │   │
│       │   └── sdk/                     # High-level SDK (SPEC §10)
│       │       ├── index.ts             # Re-exports
│       │       ├── client.ts            # AIPClient: initialize, check, getWindowState, destroy
│       │       └── http.ts              # HTTP signal path: webhook delivery, HMAC signing
│       │
│       └── test/
│           ├── schemas/
│           │   └── checkpoint.test.ts
│           ├── adapters/
│           │   ├── anthropic.test.ts
│           │   ├── openai.test.ts
│           │   ├── google.test.ts
│           │   ├── fallback.test.ts
│           │   └── registry.test.ts
│           ├── analysis/
│           │   ├── engine.test.ts
│           │   ├── prompt.test.ts
│           │   ├── card-summary.test.ts
│           │   ├── drift.test.ts
│           │   └── agreement.test.ts
│           ├── window/
│           │   └── manager.test.ts
│           ├── sdk/
│           │   ├── client.test.ts
│           │   └── http.test.ts
│           └── fixtures/
│               ├── cards.ts             # Sample AlignmentCards
│               ├── thinking-blocks.ts   # Sample thinking blocks (benign + adversarial)
│               ├── responses.ts         # Sample LLM responses (Anthropic, OpenAI, Google)
│               └── verdicts.ts          # Expected analysis LLM responses
```

### 2.3 Package Configuration

```jsonc
// packages/typescript/package.json
{
  "name": "@mnemom/agent-integrity-protocol",
  "version": "0.1.0",
  "description": "Agent Integrity Protocol (AIP) - Real-time integrity assurance for AI agents",
  "main": "dist/index.js",
  "module": "dist/index.mjs",
  "types": "dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.mjs",
      "require": "./dist/index.js"
    }
  },
  "files": ["dist", "src", "README.md", "LICENSE"],
  "scripts": {
    "build": "tsup src/index.ts --format cjs,esm --dts --clean",
    "dev": "tsup src/index.ts --format cjs,esm --dts --watch",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  },
  "keywords": [
    "ai", "agent", "integrity", "alignment", "verification",
    "thinking", "conscience", "aap", "aip", "mcp"
  ],
  "author": "Mnemom",
  "license": "Apache-2.0",
  "repository": {
    "type": "git",
    "url": "https://github.com/mnemom/aip"
  },
  "homepage": "https://github.com/mnemom/aip",
  "publishConfig": {
    "access": "public"
  },
  "peerDependencies": {
    "@mnemom/agent-alignment-protocol": ">=0.1.5"
  },
  "peerDependenciesMeta": {
    "@mnemom/agent-alignment-protocol": {
      "optional": true
    }
  },
  "devDependencies": {
    "@mnemom/agent-alignment-protocol": "^0.1.5",
    "@types/node": "^20.0.0",
    "tsup": "^8.0.0",
    "typescript": "^5.0.0",
    "vitest": "^1.0.0"
  },
  "engines": {
    "node": ">=18.0.0"
  }
}
```

**Key decision: `peerDependencies` not `dependencies`.**

AAP is a peer dependency, not a direct dependency. AIP needs AAP's types (`AlignmentCard`, `APTrace`) but doesn't bundle AAP. Consumers who use both protocols install both packages. Consumers who only use AIP's types without AAP integration can skip it (hence `optional: true`). This mirrors how React ecosystem packages declare peer dependencies.

AIP re-exports the AAP types it needs so consumers get a clean API surface even if AAP isn't installed — the types are structural (TypeScript interfaces), so they work at compile time regardless.

### 2.4 Public API Surface

```typescript
// src/index.ts — mirrors AAP's index.ts pattern

/**
 * Agent Integrity Protocol (AIP) - TypeScript SDK
 *
 * Real-time integrity assurance for autonomous agents.
 * Sister protocol to AAP (@mnemom/agent-alignment-protocol).
 *
 * Core API:
 * - checkIntegrity: Analyze a thinking block against an alignment card
 * - detectIntegrityDrift: Detect drift within a session window
 * - validateAgreement: Validate card-conscience agreement at config time
 * - createClient: Create a managed AIP client with windowing and callbacks
 */

// ─── Core API ───────────────────────────────────────────────────────────
export { checkIntegrity } from "./analysis/engine";
export { detectIntegrityDrift } from "./analysis/drift";
export { validateAgreement } from "./analysis/agreement";
export { buildConsciencePrompt } from "./analysis/prompt";
export { summarizeCard } from "./analysis/card-summary";

// ─── SDK Client ─────────────────────────────────────────────────────────
export { createClient, type AIPClient } from "./sdk/client";
export { signPayload, verifySignature } from "./sdk/http";

// ─── Provider Adapters ──────────────────────────────────────────────────
export {
  AnthropicAdapter,
  OpenAIAdapter,
  GoogleAdapter,
  FallbackAdapter,
  createAdapterRegistry,
  type AdapterRegistry,
} from "./adapters";
export type { ProviderAdapter, ExtractedThinking } from "./adapters/types";

// ─── Schema Types ───────────────────────────────────────────────────────
export type {
  // Checkpoint (§5)
  IntegrityCheckpoint,
  IntegrityVerdict,

  // Concerns (§5.3–5.4)
  IntegrityConcern,
  ConcernCategory,
  IntegritySeverity,

  // Conscience (§5.5)
  ConscienceContext,
  ConscienceValue,

  // Signal (§10.1)
  IntegritySignal,
  WindowSummary,
  RecommendedAction,

  // Drift Alert (§9)
  IntegrityDriftAlert,
  DriftDirection,

  // Config (§8, §10)
  AIPConfig,
  WindowConfig,
  AnalysisLLMConfig,
  FailurePolicy,

  // Agreement (§11)
  CardConscienceAgreement,

  // Analysis Metadata (§5.6)
  AnalysisMetadata,
} from "./schemas";

// ─── Window Manager ─────────────────────────────────────────────────────
export { WindowManager } from "./window/manager";
export type { WindowState } from "./window/state";

// ─── Constants ──────────────────────────────────────────────────────────
export * from "./constants";
```

### 2.5 Constants

```typescript
// src/constants.ts — mirrors AAP's constants.ts

/**
 * Calibrated constants for AIP integrity analysis and drift detection.
 *
 * Shared thresholds are imported from AAP where applicable.
 * AIP-specific thresholds are documented here.
 */

// ─── Shared with AAP ───────────────────────────────────────────────────
// These values MUST match AAP's constants for ecosystem consistency.

/** Alert after this many consecutive non-clear verdicts. */
export const DEFAULT_SUSTAINED_CHECKS_THRESHOLD = 3;
// Matches AAP: DEFAULT_SUSTAINED_TURNS_THRESHOLD = 3

// ─── Drift Severity Thresholds (Braid V2) ───────────────────────────────
// These match Braid V2's divergence alert thresholds.

/** Low severity: integrity_similarity >= this value */
export const DRIFT_SEVERITY_LOW_THRESHOLD = 0.7;

/** Medium severity: integrity_similarity >= this value (and < LOW) */
export const DRIFT_SEVERITY_MEDIUM_THRESHOLD = 0.4;

/** High severity: integrity_similarity < MEDIUM threshold */
// (implicit: < 0.4)

// ─── Analysis Configuration ─────────────────────────────────────────────

/** Maximum tokens from thinking block to include in conscience prompt. */
export const DEFAULT_THINKING_TOKEN_BUDGET = 4096;

/** Proportion of token budget allocated to the start of thinking block. */
export const TRUNCATION_HEAD_RATIO = 0.75;

/** Proportion of token budget allocated to the end of thinking block. */
export const TRUNCATION_TAIL_RATIO = 0.25;

/** Maximum characters for evidence quotes in IntegrityConcern. */
export const MAX_EVIDENCE_LENGTH = 200;

/** Default analysis LLM response timeout in milliseconds. */
export const DEFAULT_ANALYSIS_TIMEOUT_MS = 10000;

/** Maximum analysis LLM response tokens. */
export const DEFAULT_ANALYSIS_MAX_TOKENS = 1024;

// ─── Window Defaults ────────────────────────────────────────────────────

/** Default maximum checkpoints in session window. */
export const DEFAULT_WINDOW_MAX_SIZE = 10;

/** Minimum allowed window size. */
export const MIN_WINDOW_SIZE = 3;

/** Default maximum checkpoint age in seconds. */
export const DEFAULT_WINDOW_MAX_AGE_SECONDS = 3600;

// ─── Adapter Confidence ─────────────────────────────────────────────────

/** Confidence for native thinking block extraction (Anthropic). */
export const CONFIDENCE_NATIVE = 1.0;

/** Confidence for explicit reasoning field extraction (OpenAI, Google). */
export const CONFIDENCE_EXPLICIT = 0.9;

/** Confidence for fallback response text analysis. */
export const CONFIDENCE_FALLBACK = 0.3;

// ─── Webhook Retry ──────────────────────────────────────────────────────

/** Maximum webhook delivery retries. */
export const WEBHOOK_MAX_RETRIES = 3;

/** Webhook retry delays in milliseconds (exponential backoff). */
export const WEBHOOK_RETRY_DELAYS_MS = [1000, 4000, 16000];

// ─── Version ────────────────────────────────────────────────────────────

export const AIP_VERSION = "0.1.0";
export const ALGORITHM_VERSION = "1.0.0";
```

### 2.6 Key Implementation Details

#### 2.6.1 `checkIntegrity` — The Core Function

Analogous to AAP's `verifyTrace`. Pure function. No state, no network calls (the caller provides the analysis LLM response). This is the SDK's heart.

```typescript
// src/analysis/engine.ts

import type { AlignmentCard } from "@mnemom/agent-alignment-protocol";
import type { IntegrityCheckpoint, ConscienceValue } from "../schemas";
import type { ExtractedThinking } from "../adapters/types";

interface CheckIntegrityInput {
  /** Extracted thinking block */
  thinking: ExtractedThinking;

  /** Raw analysis LLM response (JSON string) */
  analysisResponse: string;

  /** Alignment card to check against */
  card: AlignmentCard;

  /** Active conscience values (optional) */
  conscienceValues?: ConscienceValue[];

  /** Current session/window context */
  sessionId: string;
  windowPosition: { index: number; windowSize: number };

  /** Linked trace ID (if known) */
  linkedTraceId?: string | null;
}

/**
 * Parse an analysis LLM response into an IntegrityCheckpoint.
 *
 * This is a pure function — it does not call any LLM. The caller is
 * responsible for sending the conscience prompt to the analysis LLM
 * and passing the response here. This separation enables testing
 * without mocking network calls.
 *
 * @param input - Thinking block, analysis response, and context
 * @returns IntegrityCheckpoint
 * @throws If analysisResponse is not valid JSON or fails schema validation
 */
export function checkIntegrity(input: CheckIntegrityInput): IntegrityCheckpoint;
```

**Why pure?** AAP's `verifyTrace` is pure — it takes a trace and card, returns a result. No network calls. AIP follows the same pattern. The SDK parses and validates; the host application handles LLM calls. This makes the SDK testable, embeddable, and runtime-agnostic.

The `AIPClient` (Section 2.6.4) wraps this with network calls and state for consumers who want a managed experience.

#### 2.6.2 `buildConsciencePrompt` — Prompt Construction

```typescript
// src/analysis/prompt.ts

import type { AlignmentCard } from "@mnemom/agent-alignment-protocol";
import type { ConscienceValue, WindowState } from "../schemas";

interface PromptInput {
  /** Alignment card (will be summarized) */
  card: AlignmentCard;

  /** Conscience values (only BOUNDARY and FEAR injected) */
  conscienceValues?: ConscienceValue[];

  /** Current window state (for session context) */
  windowState?: WindowState | null;

  /** Thinking block content to evaluate */
  thinkingBlock: string;

  /** Maximum tokens for thinking block (truncation applied if exceeded) */
  thinkingTokenBudget?: number;
}

interface ConsciencePrompt {
  /** System prompt for the analysis LLM */
  system: string;

  /** User message containing the evaluation request */
  user: string;

  /** Whether the thinking block was truncated */
  truncated: boolean;

  /** Original token count (approximate) */
  originalTokens: number;

  /** Analyzed token count (after truncation) */
  analyzedTokens: number;
}

/**
 * Build a conscience prompt for the analysis LLM.
 *
 * Assembles: system prompt + card summary + conscience values +
 * session context + thinking block into a structured prompt.
 *
 * @see SPEC §6 for full specification
 */
export function buildConsciencePrompt(input: PromptInput): ConsciencePrompt;
```

#### 2.6.3 Provider Adapters

Each adapter is a class implementing `ProviderAdapter`. The registry selects adapters by provider name or URL pattern.

```typescript
// src/adapters/index.ts

export { AnthropicAdapter } from "./anthropic";
export { OpenAIAdapter } from "./openai";
export { GoogleAdapter } from "./google";
export { FallbackAdapter } from "./fallback";
export type { ProviderAdapter, ExtractedThinking } from "./types";

interface AdapterRegistry {
  /** Get adapter by explicit provider name */
  get(provider: string): ProviderAdapter | null;

  /** Detect adapter from URL */
  detectFromUrl(url: string): ProviderAdapter | null;

  /** Register a custom adapter */
  register(adapter: ProviderAdapter): void;
}

/**
 * Create an adapter registry with built-in adapters.
 * Custom adapters can be registered at runtime.
 */
export function createAdapterRegistry(): AdapterRegistry;
```

**Anthropic adapter implementation** is derived directly from `observer/src/index.ts` functions `tryParseResponseJSON`, `tryParseSSE`, and `extractFromContentBlocks`. The spec (Appendix C.1) contains the reference implementation. The SDK implementation is a cleaned-up version of the same logic.

#### 2.6.4 `AIPClient` — Managed Client

The high-level client wraps the pure functions with state management, LLM calls, and signal delivery.

```typescript
// src/sdk/client.ts

import type { AIPConfig, IntegritySignal, IntegrityDriftAlert } from "../schemas";
import type { WindowState } from "../window/state";

interface AIPClient {
  /**
   * Perform an integrity check on a response body.
   *
   * 1. Extracts thinking via appropriate adapter
   * 2. Builds conscience prompt
   * 3. Calls analysis LLM
   * 4. Parses response into IntegrityCheckpoint
   * 5. Updates session window
   * 6. Checks for drift
   * 7. Delivers signal via configured callbacks
   *
   * @param responseBody - Raw LLM response body (JSON or SSE string)
   * @param provider - Provider name (auto-detected if omitted)
   * @returns IntegritySignal
   */
  check(responseBody: string, provider?: string): Promise<IntegritySignal>;

  /** Get current session window state */
  getWindowState(): WindowState;

  /** Reset session window (e.g., on manual session boundary) */
  resetWindow(): void;

  /** Clean up resources */
  destroy(): void;
}

/**
 * Create a managed AIP client.
 *
 * Validates card-conscience agreement at creation time.
 * Throws if agreement validation fails.
 *
 * @param config - AIP configuration
 * @returns AIPClient instance
 * @throws CardConscienceConflictError if conscience values conflict with card
 */
export function createClient(config: AIPConfig): AIPClient;
```

**The client is the only part that makes network calls** (to the analysis LLM). Everything else in the SDK is pure. This is identical to how AAP works — `verifyTrace` is pure, and the Observer Worker handles the network.

#### 2.6.5 HTTP Signal Path

```typescript
// src/sdk/http.ts

/**
 * Compute HMAC-SHA256 signature for webhook payload.
 *
 * @param secret - Shared secret (minimum 32 characters)
 * @param payload - Request body bytes
 * @returns Hex-encoded signature string
 */
export function signPayload(secret: string, payload: string): Promise<string>;

/**
 * Verify HMAC-SHA256 signature using constant-time comparison.
 *
 * @param secret - Shared secret
 * @param payload - Request body bytes
 * @param signature - Received signature (hex string)
 * @returns true if signature is valid
 */
export function verifySignature(
  secret: string,
  payload: string,
  signature: string
): Promise<boolean>;
```

Uses `crypto.subtle` (Web Crypto API) for Cloudflare Worker compatibility. Falls back to Node.js `crypto` module when `crypto.subtle` is unavailable.

### 2.7 Test Strategy

Mirrors AAP's test patterns: unit tests per module, fixture files for sample data, no network mocks needed for the core SDK (pure functions).

| Test File | What It Tests | Key Assertions |
|---|---|---|
| `adapters/anthropic.test.ts` | JSON + SSE extraction | Correct thinking extraction from real Anthropic response shapes; multi-block concatenation; SSE delta accumulation |
| `adapters/openai.test.ts` | reasoning_content extraction | JSON and streaming; handles missing field gracefully |
| `adapters/google.test.ts` | Gemini thought parts | Parts with `thought: true`; streaming accumulation |
| `adapters/fallback.test.ts` | Response text analysis | Reasoning pattern detection; low confidence; graceful empty |
| `adapters/registry.test.ts` | Adapter selection | URL detection, explicit provider, custom registration, fallback |
| `analysis/engine.test.ts` | `checkIntegrity` | Valid JSON → checkpoint; invalid JSON → throws; verdict mapping; concern validation; hash computation |
| `analysis/prompt.test.ts` | `buildConsciencePrompt` | Card summary inclusion; BOUNDARY/FEAR injection; COMMITMENT/BELIEF/HOPE exclusion; window context formatting; truncation |
| `analysis/card-summary.test.ts` | `summarizeCard` | Token budget; includes values, bounded, forbidden, triggers; omits principal, audit |
| `analysis/drift.test.ts` | `detectIntegrityDrift` | Threshold crossing; streak reset on clear; direction inference; severity mapping to Braid thresholds |
| `analysis/agreement.test.ts` | `validateAgreement` | BOUNDARY vs bounded_actions conflict detection; FEAR→trigger mapping; valid agreement; empty conscience values |
| `window/manager.test.ts` | `WindowManager` | Sliding eviction; fixed reset; max_age eviction; session boundary reset; getSummary accuracy; integrity_ratio computation |
| `sdk/client.test.ts` | `createClient` | Agreement validation at init; check lifecycle; callback invocation; fail-open/fail-closed; window state |
| `sdk/http.test.ts` | HMAC signing/verification | Round-trip sign→verify; tampered payload rejection; constant-time comparison |

**Fixture files** contain:
- `cards.ts`: Minimal card, full card, card with forbidden actions, expired card.
- `thinking-blocks.ts`: Benign coding assistance, prompt injection attempt, value misalignment, deceptive reasoning, autonomy violation. Same examples as SPEC Appendix B.
- `responses.ts`: Sample Anthropic JSON response, Anthropic SSE stream, OpenAI JSON, Google JSON.
- `verdicts.ts`: Expected analysis LLM JSON responses for each thinking block fixture.

---

## 3. Python SDK

### 3.1 Package

```
Package:    agent-integrity-protocol
Registry:   PyPI (public)
License:    Apache-2.0
Python:     >=3.10
```

### 3.2 Directory Structure

Mirrors the TypeScript SDK's module structure. Python-idiomatic naming (snake_case, `__init__.py`).

```
packages/
└── python/
    ├── pyproject.toml
    ├── README.md
    ├── LICENSE
    ├── src/
    │   └── aip/
    │       ├── __init__.py              # Public API surface
    │       ├── constants.py             # Calibrated thresholds
    │       │
    │       ├── schemas/                 # Domain types (dataclasses)
    │       │   ├── __init__.py
    │       │   ├── checkpoint.py
    │       │   ├── signal.py
    │       │   ├── concern.py
    │       │   ├── conscience.py
    │       │   ├── drift_alert.py
    │       │   ├── config.py
    │       │   └── agreement.py
    │       │
    │       ├── adapters/                # Provider adapters
    │       │   ├── __init__.py
    │       │   ├── types.py
    │       │   ├── anthropic.py
    │       │   ├── openai.py
    │       │   ├── google.py
    │       │   └── fallback.py
    │       │
    │       ├── analysis/                # Analysis engine
    │       │   ├── __init__.py
    │       │   ├── engine.py
    │       │   ├── prompt.py
    │       │   ├── card_summary.py
    │       │   ├── drift.py
    │       │   └── agreement.py
    │       │
    │       ├── window/                  # Session windowing
    │       │   ├── __init__.py
    │       │   ├── manager.py
    │       │   └── state.py
    │       │
    │       └── sdk/                     # High-level client
    │           ├── __init__.py
    │           ├── client.py
    │           └── http.py
    │
    └── tests/
        ├── conftest.py                  # Shared fixtures
        ├── test_adapters/
        ├── test_analysis/
        ├── test_window/
        └── test_sdk/
```

### 3.3 Package Configuration

```toml
# pyproject.toml
[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[project]
name = "agent-integrity-protocol"
version = "0.1.0"
description = "Agent Integrity Protocol (AIP) - Real-time integrity assurance for AI agents"
readme = "README.md"
license = "Apache-2.0"
requires-python = ">=3.10"
authors = [{ name = "Mnemom" }]
keywords = ["ai", "agent", "integrity", "alignment", "verification", "thinking", "conscience"]
classifiers = [
    "Development Status :: 3 - Alpha",
    "Intended Audience :: Developers",
    "License :: OSI Approved :: Apache Software License",
    "Programming Language :: Python :: 3",
    "Programming Language :: Python :: 3.10",
    "Programming Language :: Python :: 3.11",
    "Programming Language :: Python :: 3.12",
    "Topic :: Software Development :: Libraries",
]

[project.optional-dependencies]
aap = ["agent-alignment-protocol>=0.1.5"]
dev = ["pytest>=8.0", "pytest-asyncio>=0.23", "ruff>=0.2"]

[project.urls]
Homepage = "https://github.com/mnemom/aip"
Repository = "https://github.com/mnemom/aip"
```

**Zero runtime dependencies.** Like the TypeScript SDK. AAP is an optional dependency for consumers who need type interop.

### 3.4 Public API

```python
# src/aip/__init__.py

# Core API
from aip.analysis.engine import check_integrity
from aip.analysis.drift import detect_integrity_drift
from aip.analysis.agreement import validate_agreement
from aip.analysis.prompt import build_conscience_prompt
from aip.analysis.card_summary import summarize_card

# SDK Client
from aip.sdk.client import create_client, AIPClient
from aip.sdk.http import sign_payload, verify_signature

# Provider Adapters
from aip.adapters import (
    AnthropicAdapter,
    OpenAIAdapter,
    GoogleAdapter,
    FallbackAdapter,
    create_adapter_registry,
)
from aip.adapters.types import ProviderAdapter, ExtractedThinking

# Schema Types (dataclasses)
from aip.schemas.checkpoint import IntegrityCheckpoint, IntegrityVerdict
from aip.schemas.concern import IntegrityConcern, ConcernCategory, IntegritySeverity
from aip.schemas.conscience import ConscienceContext, ConscienceValue
from aip.schemas.signal import IntegritySignal, WindowSummary
from aip.schemas.drift_alert import IntegrityDriftAlert, DriftDirection
from aip.schemas.config import AIPConfig, WindowConfig, AnalysisLLMConfig, FailurePolicy
from aip.schemas.agreement import CardConscienceAgreement

# Window
from aip.window.manager import WindowManager
from aip.window.state import WindowState

# Constants
from aip.constants import *
```

### 3.5 Implementation Notes

- Types are `@dataclass` with `from_dict()` / `to_dict()` methods for JSON serialization. No Pydantic dependency.
- Adapters use the same parsing logic as TypeScript, ported to Python's `json` module.
- HMAC signing uses `hmac` and `hashlib` from the standard library.
- Async client variant uses `asyncio` + `aiohttp`-compatible interface (but `aiohttp` is not a dependency — the caller passes an async HTTP function).
- Tests use `pytest` with fixtures mirroring the TypeScript SDK's fixture files.

---

## 4. Smoltbot Integration

### 4.1 Database Migration

New tables and columns added to `smoltbot/database/schema.sql`:

```sql
-- ============================================================================
-- AIP: Integrity Checkpoints
-- ============================================================================

CREATE TABLE integrity_checkpoints (
  checkpoint_id TEXT PRIMARY KEY,              -- ic-{uuid}
  agent_id TEXT NOT NULL REFERENCES agents(id),
  card_id TEXT NOT NULL,
  session_id TEXT NOT NULL,

  timestamp TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),

  -- Thinking block reference (hash only, never full text)
  thinking_block_hash TEXT NOT NULL,            -- SHA-256 hex
  provider TEXT NOT NULL,
  model TEXT NOT NULL,

  -- Verdict
  verdict TEXT NOT NULL,                        -- clear | review_needed | boundary_violation
  concerns JSONB NOT NULL DEFAULT '[]',         -- IntegrityConcern[]
  reasoning_summary TEXT NOT NULL,

  -- Conscience
  conscience_context JSONB NOT NULL,            -- ConscienceContext

  -- Window position
  window_index INTEGER NOT NULL,
  window_size INTEGER NOT NULL,

  -- Analysis metadata
  analysis_metadata JSONB NOT NULL,             -- AnalysisMetadata

  -- AAP integration
  linked_trace_id TEXT REFERENCES traces(trace_id)
);

CREATE INDEX idx_checkpoints_agent_time ON integrity_checkpoints(agent_id, timestamp DESC);
CREATE INDEX idx_checkpoints_session ON integrity_checkpoints(session_id, timestamp);
CREATE INDEX idx_checkpoints_verdict ON integrity_checkpoints(verdict);
CREATE INDEX idx_checkpoints_linked_trace ON integrity_checkpoints(linked_trace_id);

-- RLS: Checkpoints are publicly readable (same transparency policy as traces)
ALTER TABLE integrity_checkpoints ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Checkpoints are publicly readable"
  ON integrity_checkpoints FOR SELECT USING (true);
CREATE POLICY "Observer can insert checkpoints"
  ON integrity_checkpoints FOR INSERT
  WITH CHECK (current_setting('app.role', true) = 'observer');

-- ============================================================================
-- AIP: Integrity Drift Alerts (extends existing drift_alerts table)
-- ============================================================================
-- AIP drift alerts are stored in the SAME drift_alerts table as AAP alerts.
-- Differentiated by alert_type prefix: "aip:injection_pattern", "aip:value_erosion", etc.
-- No schema change needed — the existing table supports this via alert_type TEXT.

-- ============================================================================
-- AIP: Webhook Registrations
-- ============================================================================

CREATE TABLE aip_webhook_registrations (
  registration_id TEXT PRIMARY KEY,             -- reg-{uuid}
  agent_id TEXT NOT NULL REFERENCES agents(id),
  callback_url TEXT NOT NULL,
  secret_hash TEXT NOT NULL,                    -- SHA-256 of secret (never store raw)
  events TEXT[] NOT NULL,                       -- ['verdict', 'drift_alert']
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_delivery_at TIMESTAMPTZ,
  failure_count INTEGER DEFAULT 0
);

CREATE INDEX idx_webhooks_agent ON aip_webhook_registrations(agent_id);

-- RLS: Only the agent owner can manage webhooks
ALTER TABLE aip_webhook_registrations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Observer can manage webhooks"
  ON aip_webhook_registrations
  USING (current_setting('app.role', true) = 'observer');

-- ============================================================================
-- AIP: Enrichment of existing traces table
-- ============================================================================
-- No schema change needed. AIP verdicts are stored in the existing
-- context->metadata JSONB field:
--   context.metadata.integrity_verdict = "clear" | "review_needed" | "boundary_violation"
--   context.metadata.integrity_checkpoint_id = "ic-..."
--   context.metadata.integrity_concerns = 0

-- ============================================================================
-- AIP: Integrity score function
-- ============================================================================

CREATE OR REPLACE FUNCTION compute_integrity_score_aip(p_agent_id TEXT)
RETURNS TABLE(
  total_checks BIGINT,
  clear_count BIGINT,
  review_count BIGINT,
  violation_count BIGINT,
  integrity_ratio NUMERIC,
  latest_verdict TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    COUNT(*)::BIGINT AS total_checks,
    COUNT(*) FILTER (WHERE ic.verdict = 'clear')::BIGINT AS clear_count,
    COUNT(*) FILTER (WHERE ic.verdict = 'review_needed')::BIGINT AS review_count,
    COUNT(*) FILTER (WHERE ic.verdict = 'boundary_violation')::BIGINT AS violation_count,
    CASE WHEN COUNT(*) > 0
      THEN ROUND(COUNT(*) FILTER (WHERE ic.verdict = 'clear')::NUMERIC / COUNT(*)::NUMERIC, 4)
      ELSE 1.0
    END AS integrity_ratio,
    (SELECT ic2.verdict FROM integrity_checkpoints ic2
     WHERE ic2.agent_id = p_agent_id
     ORDER BY ic2.timestamp DESC LIMIT 1) AS latest_verdict
  FROM integrity_checkpoints ic
  WHERE ic.agent_id = p_agent_id;
END;
$$ LANGUAGE plpgsql;
```

### 4.2 Observer Worker Enhancement

The Observer Worker (`smoltbot/observer/src/index.ts`) is enhanced to run AIP analysis alongside its existing AAP processing.

**New dependency:**

```jsonc
// observer/package.json — add:
{
  "dependencies": {
    "@mnemom/agent-alignment-protocol": "^0.1.5",
    "@mnemom/agent-integrity-protocol": "^0.1.0"  // NEW
  }
}
```

**Integration point** — in `processLog()`, after thinking block extraction and before trace submission:

```typescript
// observer/src/index.ts — additions to processLog()

import {
  checkIntegrity,
  buildConsciencePrompt,
  AnthropicAdapter,
  type IntegrityCheckpoint,
} from '@mnemom/agent-integrity-protocol';

// ... existing processLog() code ...

// After: const context = extractContext(bodies.request, bodies.response);
// After: const analysis = await analyzeWithHaiku(context, env);
// Before: const trace = buildTrace(log, metadata, context, analysis, card);

// ── AIP: Real-time integrity check ──
let integrityCheckpoint: IntegrityCheckpoint | null = null;

if (context.thinking) {
  integrityCheckpoint = await runIntegrityCheck(
    context.thinking,
    card,
    metadata,
    log,
    env
  );
}

// When building trace, enrich context.metadata with AIP verdict:
// trace.context.metadata.integrity_verdict = integrityCheckpoint?.verdict
// trace.context.metadata.integrity_checkpoint_id = integrityCheckpoint?.checkpoint_id
// trace.context.metadata.integrity_concerns = integrityCheckpoint?.concerns.length ?? 0

// After trace submission, store checkpoint:
if (integrityCheckpoint) {
  await submitCheckpoint(integrityCheckpoint, env);
}
```

**New function — `runIntegrityCheck()`:**

```typescript
async function runIntegrityCheck(
  thinking: string,
  card: AlignmentCard | null,
  metadata: GatewayMetadata,
  log: GatewayLog,
  env: Env
): Promise<IntegrityCheckpoint | null> {
  if (!card) return null;

  // 1. Build conscience prompt
  const prompt = buildConsciencePrompt({
    card,
    thinkingBlock: thinking,
    // No conscience values in Phase 1 — added in Phase 2
  });

  // 2. Call analysis LLM (Haiku — same model as existing analysis)
  const analysisResponse = await callAnalysisLLM(prompt, env);
  if (!analysisResponse) return null;

  // 3. Parse response into checkpoint
  const adapter = new AnthropicAdapter();
  const extracted = {
    content: thinking,
    provider: log.provider || 'anthropic',
    model: log.model,
    extraction_method: 'native_thinking' as const,
    confidence: 1.0,
    truncated: false,
  };

  try {
    return checkIntegrity({
      thinking: extracted,
      analysisResponse,
      card,
      sessionId: metadata.session_id,
      windowPosition: { index: 0, windowSize: 1 }, // Per-log, no persistent window yet
    });
  } catch (error) {
    console.error('[observer] AIP analysis failed:', error);
    return null; // Fail-open
  }
}
```

**Phase 1:** Observer runs AIP inline. No persistent window (each log is independent). No conscience values. No webhooks. This gets checkpoints flowing into the database and enriching traces.

**Phase 2:** Persistent window via Durable Objects or KV. Conscience values from daimonion. Webhook delivery. Full drift detection with session continuity.

### 4.3 API Worker Enhancement

New endpoints added to `smoltbot/api/src/index.ts`:

```typescript
// ─── AIP Endpoints ──────────────────────────────────────────────────────

// GET /v1/agents/:id/integrity
// Returns AIP integrity score (checkpoints-based, not trace-based)
// Uses compute_integrity_score_aip() function

// GET /v1/agents/:id/checkpoints
// Returns paginated IntegrityCheckpoints for an agent
// Query params: limit, offset, session_id, verdict

// GET /v1/agents/:id/checkpoints/:checkpoint_id
// Returns a single IntegrityCheckpoint

// GET /v1/agents/:id/drift/realtime
// Returns AIP drift alerts (alert_type LIKE 'aip:%')
// Distinct from existing /v1/drift/:agent_id which returns AAP drift

// POST /v1/aip/register
// Register a webhook for AIP signals (SPEC §10.4)

// DELETE /v1/aip/register/:registration_id
// Remove a webhook registration
```

These follow the same patterns as existing API endpoints (Supabase REST queries, pagination, error handling).

---

## 5. Implementation Phases

### Phase 1: TypeScript SDK Core

**Goal:** Publishable `@mnemom/agent-integrity-protocol` package with pure functions and provider adapters.

| Step | Module | Description |
|---|---|---|
| 1.1 | `schemas/*` | All type definitions as TypeScript interfaces. No logic, just types. |
| 1.2 | `constants.ts` | All calibrated thresholds. |
| 1.3 | `adapters/anthropic.ts` | Anthropic adapter (JSON + SSE). Derived from Observer. |
| 1.4 | `adapters/openai.ts` | OpenAI adapter (JSON + SSE). |
| 1.5 | `adapters/google.ts` | Google adapter (JSON + SSE). |
| 1.6 | `adapters/fallback.ts` | Response text analysis adapter. |
| 1.7 | `adapters/index.ts` | Adapter registry. |
| 1.8 | `analysis/card-summary.ts` | AlignmentCard → ~500 token summary. |
| 1.9 | `analysis/prompt.ts` | Conscience prompt builder (SPEC §6). |
| 1.10 | `analysis/engine.ts` | `checkIntegrity()` — core pure function. |
| 1.11 | `analysis/agreement.ts` | Card-conscience agreement validation. |
| 1.12 | `analysis/drift.ts` | `detectIntegrityDrift()` — window-based drift. |
| 1.13 | `window/state.ts` | WindowState type. |
| 1.14 | `window/manager.ts` | WindowManager: push, evict, getContext, getSummary. |
| 1.15 | `sdk/http.ts` | HMAC signing/verification. |
| 1.16 | `sdk/client.ts` | `createClient()` — managed client with LLM calls. |
| 1.17 | `index.ts` | Public API surface, re-exports. |
| 1.18 | Tests | Full test suite for all modules. |
| 1.19 | Build | tsup config, package.json, README. |
| 1.20 | Publish | `npm publish` as `@mnemom/agent-integrity-protocol@0.1.0`. |

**Dependency order:** 1.1–1.2 (types/constants) → 1.3–1.7 (adapters) → 1.8–1.12 (analysis) → 1.13–1.14 (window) → 1.15–1.16 (SDK) → 1.17–1.20 (integration/publish).

### Phase 2: Smoltbot Integration

**Goal:** AIP running in production alongside AAP.

| Step | Component | Description |
|---|---|---|
| 2.1 | Database | Run migration: `integrity_checkpoints` table, `compute_integrity_score_aip()` function, `aip_webhook_registrations` table. |
| 2.2 | Observer | Add `@mnemom/agent-integrity-protocol` dependency. Implement `runIntegrityCheck()` in `processLog()`. Store checkpoints. Enrich traces. |
| 2.3 | API | Add AIP endpoints: `/v1/agents/:id/checkpoints`, `/v1/agents/:id/integrity` (AIP), `/v1/agents/:id/drift/realtime`. |
| 2.4 | Testing | E2E: Send a request through gateway → verify checkpoint appears in database → verify trace is enriched with verdict. |
| 2.5 | Deploy | Deploy updated Observer and API workers. |

### Phase 3: Python SDK

**Goal:** Publishable `agent-integrity-protocol` Python package.

| Step | Description |
|---|---|
| 3.1 | Port `schemas/` to Python dataclasses. |
| 3.2 | Port `constants.py`. |
| 3.3 | Port `adapters/` (all four adapters). |
| 3.4 | Port `analysis/` (engine, prompt, card_summary, drift, agreement). |
| 3.5 | Port `window/` (manager, state). |
| 3.6 | Port `sdk/` (client, http). |
| 3.7 | Tests with pytest. |
| 3.8 | Publish to PyPI as `agent-integrity-protocol@0.1.0`. |

### Phase 4: Advanced Features

**Goal:** Full SPEC compliance.

| Step | Feature | Description |
|---|---|---|
| 4.1 | Persistent windowing | Durable Objects or KV-backed window state across Observer invocations. |
| 4.2 | Conscience values | Integration with daimonion system. BOUNDARY/FEAR injection in conscience prompt. |
| 4.3 | Webhook delivery | POST signals to registered webhooks with HMAC signatures. Retry logic. |
| 4.4 | Drift detection | Full session-aware drift detection with IntegrityDriftAlerts stored in `drift_alerts`. |
| 4.5 | Dashboard | AIP integrity view alongside AAP traces. Braid-styled drift alerts. |

---

## 6. Testing Strategy

### 6.1 Unit Tests (SDK)

All pure functions tested without network mocks:

- `checkIntegrity`: Given analysis response JSON, assert correct checkpoint fields.
- `buildConsciencePrompt`: Assert card summary present, BOUNDARY values injected, COMMITMENT excluded, truncation applied.
- `summarizeCard`: Assert token budget, included fields, omitted fields.
- `detectIntegrityDrift`: Assert threshold crossing, streak reset, direction inference.
- `validateAgreement`: Assert conflict detection, augmentation discovery.
- Adapters: Assert correct extraction from fixture response bodies.
- WindowManager: Assert sliding eviction, fixed reset, max_age, getSummary.
- HMAC: Assert round-trip sign→verify, rejection of tampered payloads.

### 6.2 Integration Tests (Smoltbot)

- **Observer E2E**: Mock AI Gateway log → Observer processes → checkpoint stored in Supabase → trace enriched with verdict.
- **API E2E**: Stored checkpoint → GET `/v1/agents/:id/checkpoints` returns it → integrity score endpoint returns correct ratio.
- **Drift E2E**: Sequence of non-clear checkpoints → drift alert stored in `drift_alerts` with `aip:` prefix → API returns it from realtime drift endpoint.

### 6.3 Adversarial Tests

The SPEC (Appendix B.6) includes a prompt injection example. The test suite includes adversarial thinking blocks to verify:

- Meta-injection attempts (thinking block tries to manipulate analysis LLM into returning `clear`).
- Gradual value erosion (sequence of increasingly misaligned thinking blocks).
- Deceptive reasoning (thinking block reveals intent to hide actions).
- Autonomy creep (thinking block plans forbidden actions).

These tests verify that `checkIntegrity` produces the expected verdicts when given the expected analysis LLM responses. They do not test the analysis LLM's actual detection capability — that's a model evaluation concern, not an SDK concern.

---

## 7. CI/CD

### 7.1 GitHub Actions

```yaml
# .github/workflows/ci.yml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  typescript:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: packages/typescript
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm ci
      - run: npm run typecheck
      - run: npm run test
      - run: npm run build

  python:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: packages/python
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: "3.12"
      - run: pip install -e ".[dev]"
      - run: ruff check src/ tests/
      - run: pytest
```

### 7.2 Release

```yaml
# .github/workflows/release.yml
name: Release

on:
  push:
    tags: ["v*"]

jobs:
  publish-npm:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: packages/typescript
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          registry-url: "https://registry.npmjs.org"
      - run: npm ci
      - run: npm run build
      - run: npm publish --access public
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}

  publish-pypi:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: packages/python
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: "3.12"
      - run: pip install build twine
      - run: python -m build
      - run: twine upload dist/*
        env:
          TWINE_USERNAME: __token__
          TWINE_PASSWORD: ${{ secrets.PYPI_TOKEN }}
```

---

## 8. Risk Register

| Risk | Impact | Mitigation |
|---|---|---|
| Analysis LLM latency adds >5s to each agent turn | High — degrades user experience | Phase 1 uses Haiku (fast, cheap). Budget is ~500ms. If latency is unacceptable, degrade to async-only (don't block agent). |
| Analysis LLM returns invalid JSON | Medium — fail-open returns false `clear` | Strict JSON schema validation. Invalid responses trigger `on_error` callback. Configurable fail-closed. |
| Meta-injection: adversarial thinking fools analysis LLM | High — false negatives | System prompt includes explicit meta-injection warning. Use different model for analysis than agent. Structured output only. |
| Provider adapter breaks on API changes | Medium — extraction fails | Fallback adapter catches all. Adapter confidence score tells consumers to weight results. Pin adapter to API version. |
| Persistent window state lost (Worker restarts) | Low — window resets | Phase 1: no persistent window. Phase 2: Durable Objects for window state. Graceful reset on state loss. |
| AAP SDK type changes break AIP | Medium — compile-time failure | AAP is a peer dependency with `>=0.1.5`. Types are structural (interfaces), so minor additions are compatible. Pin major version. |

---

## 9. Open Questions

These decisions are deferred to implementation time:

1. **Analysis model choice.** SPEC says Haiku. Should we support configurable models per deployment? (Likely yes — `AnalysisLLMConfig.model` already supports this.)

2. **Persistent window backend.** Durable Objects vs Cloudflare KV vs Supabase for cross-invocation window state. Durable Objects are the natural fit for Worker-based architecture but add complexity.

3. **Checkpoint retention policy.** How long are checkpoints retained? Same as traces (365 days)? Shorter since they're more granular?

4. **Webhook secret rotation.** The SPEC defines registration but not rotation. Add a `PUT /v1/aip/register/:id` endpoint for secret rotation?

5. **Rate limiting AIP analysis.** Should there be a maximum checks-per-minute per agent? The analysis LLM has a cost. Consider a per-agent budget.

---

*End of implementation plan.*
