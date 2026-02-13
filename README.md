# Agent Integrity Protocol (AIP)

[![CI](https://github.com/mnemom/aip/actions/workflows/ci.yml/badge.svg)](https://github.com/mnemom/aip/actions/workflows/ci.yml)
[![CodeQL](https://github.com/mnemom/aip/actions/workflows/codeql.yml/badge.svg)](https://github.com/mnemom/aip/actions/workflows/codeql.yml)
[![PyPI](https://img.shields.io/pypi/v/agent-integrity-proto.svg)](https://pypi.org/project/agent-integrity-proto/)
[![npm](https://img.shields.io/npm/v/@mnemom/agent-integrity-protocol.svg)](https://www.npmjs.com/package/@mnemom/agent-integrity-protocol)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)
[![Spec](https://img.shields.io/badge/spec-v0.1.5-green.svg)](docs/SPEC.md)

**Real-time thinking block analysis for AI agent alignment.**

AIP analyzes what an agent is *thinking* before it acts. It extracts thinking blocks from LLM responses, evaluates them against an Alignment Card using an analysis LLM, and delivers integrity verdicts in real-time — enabling intervention between turns, not after the damage is done.

> AIP follows the daimonion philosophy: silence means aligned, voice means outside boundaries. It is a sister protocol to [AAP](https://github.com/mnemom/aap) — sharing the same Alignment Card, enriching the same AP-Trace, but operating on a fundamentally different timescale: real-time rather than retroactive.

## Quick Start

```bash
# Install
pip install agent-integrity-proto
# or
npm install @mnemom/agent-integrity-protocol
```

```python
from aip import create_client

client = create_client(
    base_url="https://gateway.example.com",
    agent_id="my-agent",
    shared_secret="your-secret",
)

# Check a thinking block against an alignment card
signal = client.check(
    thinking_block="I should help the user find the best product...",
    alignment_card=card,
)

if signal.proceed:
    # Verdict was 'clear' — continue
    execute_action()
else:
    # Verdict was 'review_needed' or 'boundary_violation'
    escalate(signal.checkpoint.concerns)
```

```typescript
import { createClient } from '@mnemom/agent-integrity-protocol';

const client = createClient({
  baseUrl: 'https://gateway.example.com',
  agentId: 'my-agent',
  sharedSecret: 'your-secret',
});

const signal = await client.check({
  thinkingBlock: 'I should help the user find the best product...',
  alignmentCard: card,
});

if (signal.proceed) {
  executeAction();
} else {
  escalate(signal.checkpoint.concerns);
}
```

## Why AIP?

AAP provides post-hoc transparency — every agent action is traced, verified, and checked for drift. But verification happens *after* the action, typically 30-60 seconds later. This creates a window of vulnerability:

- **Prompt injection**: A malicious prompt causes data exfiltration. The trace records it, but the data is already gone.
- **Gradual drift**: Reasoning shifts subtly across turns. Each action passes verification, but the cumulative direction is misaligned.
- **Misaligned intent**: The thinking block reveals a forbidden action, but it's only examined retroactively.

All three failure modes are visible in thinking blocks *before* the action lands. AIP fills this gap.

| Protocol | Function | Timescale |
|----------|----------|-----------|
| **AAP** | Post-hoc verification via AP-Traces | Retroactive (30-60s) |
| **AIP** | Real-time thinking block analysis | Between turns (~2s) |
| **Together** | Full coverage: real-time detection + audit trail | Both |

## How It Works

```
                         Agent Turn N
                              │
                              ▼
┌──────────────────────────────────────────────────────┐
│  Layer 1: Thinking Block Extraction                  │
│                                                      │
│  Anthropic  │  OpenAI  │  Google  │  Fallback        │
│  (thinking) │ (reason) │ (think)  │  (regex)         │
└──────────────────────┬───────────────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────────────┐
│  Layer 2: Integrity Analysis                         │
│                                                      │
│  Card Summary + Conscience Values + Session Window   │
│              → Analysis LLM (e.g. Haiku)             │
│              → Integrity Verdict                     │
└──────────────────────┬───────────────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────────────┐
│  Layer 3: Signal Delivery                            │
│                                                      │
│  clear → proceed    │  review_needed → warn/pause    │
│                     │  boundary_violation → block     │
└──────────────────────────────────────────────────────┘
                       │
                       ▼
                  Agent Turn N+1
```

### Integrity Checkpoint

The core output — a structured record of each thinking block evaluation:

```json
{
  "checkpoint_id": "ic-f47ac10b",
  "agent_id": "my-agent",
  "verdict": "clear",
  "confidence": 0.95,
  "concerns": [],
  "thinking_hash": "sha256:a1b2c3...",
  "window_position": { "index": 3, "window_size": 10 },
  "analysis_metadata": {
    "model": "claude-haiku-4-5-20251001",
    "latency_ms": 1847,
    "conscience_values_used": 2
  }
}
```

### Conscience Prompt

AIP builds a system prompt for the analysis LLM from:

- **Card summary** — compact representation of the Alignment Card
- **Conscience values** — `BOUNDARY` (hard limits) and `FEAR` (concerns) types injected as evaluation criteria
- **Session window** — recent checkpoint history for drift context
- **The thinking block itself**

The analysis LLM acts as a daimonion — it never commands, only warns.

### Provider Adapters

Thinking blocks differ by provider. AIP abstracts extraction:

| Provider | Source | Confidence |
|----------|--------|------------|
| Anthropic | `thinking` content blocks (+ SSE stream fallback) | 1.0 |
| OpenAI | `reasoning_content` field (+ SSE stream fallback) | 0.9 |
| Google | Gemini thinking blocks (+ SSE stream fallback) | 0.9 |
| Fallback | Regex-based extraction | 0.3 |

All adapters attempt SSE stream extraction as a fallback when standard JSON parsing fails (v0.1.3+). This allows analysis of streamed responses captured by gateway proxies.

## What AIP Does Not Do

This matters. Read it.

1. **AIP does NOT prevent injection — it detects it.** AIP identifies injection patterns in thinking blocks. It does not prevent injected content from reaching the model.

2. **AIP does NOT interrupt streams.** AIP operates between turns. It does not cancel in-flight streaming responses.

3. **AIP does NOT replace AAP.** Post-hoc verification, trace storage, and public transparency remain AAP's domain. AIP supplements AAP with real-time detection.

4. **LLM-as-judge has inherent limits.** The analysis LLM can be fooled by sophisticated adversarial content. AIP reduces the attack surface but does not eliminate it.

5. **Thinking blocks are model-dependent.** Not all models expose thinking. Models that don't expose thinking blocks cannot be analyzed by AIP.

For the complete limitations disclosure, see [Section 14 of the Specification](docs/SPEC.md#14-limitations).

## Installation

```bash
# Python
pip install agent-integrity-proto

# TypeScript
npm install @mnemom/agent-integrity-protocol
```

**Requirements:** Python >= 3.10 | Node.js >= 18.0.0

## API Reference

### Python

```python
# Core analysis
from aip import (
    check_integrity,        # Evaluate thinking block → IntegrityCheckpoint
    build_signal,           # Construct signal from checkpoint → IntegritySignal
    build_conscience_prompt, # Generate analysis LLM prompt
    hash_thinking_block,    # Content-addressed thinking reference
    detect_integrity_drift, # Track behavioral drift across checkpoints
    validate_agreement,     # Verify card-conscience alignment
)

# Provider adapters
from aip import (
    AnthropicAdapter,       # Anthropic thinking content blocks
    OpenAIAdapter,          # OpenAI reasoning_content
    GoogleAdapter,          # Google Gemini thinking
    FallbackAdapter,        # Regex-based fallback
    AdapterRegistry,        # Dynamic provider selection
)

# SDK client
from aip import create_client, sign_payload, verify_signature

# Session state
from aip import WindowManager, create_window_state
```

### TypeScript

```typescript
import {
  // Core analysis
  checkIntegrity,
  buildSignal,
  buildConsciencePrompt,
  hashThinkingBlock,
  detectIntegrityDrift,
  validateAgreement,

  // Provider adapters
  AnthropicAdapter,
  OpenAIAdapter,
  GoogleAdapter,
  FallbackAdapter,
  AdapterRegistry,

  // SDK client
  createClient,
  signPayload,
  verifySignature,

  // Session state
  WindowManager,
  createWindowState,
} from '@mnemom/agent-integrity-protocol';
```

## Documentation

| Document | Description |
|----------|-------------|
| [**SPEC.md**](docs/SPEC.md) | Full protocol specification (IETF-style, 2,214 lines) |
| [**QUICKSTART.md**](docs/QUICKSTART.md) | Zero to integrity checking in 5 minutes |
| [**LIMITS.md**](docs/LIMITS.md) | What AIP guarantees and doesn't |
| [**SECURITY.md**](docs/SECURITY.md) | Threat model and security considerations |
| [**CHANGELOG.md**](CHANGELOG.md) | Release history |

## Examples

| Example | Description |
|---------|-------------|
| [`basic-check/`](examples/basic-check/) | Minimal integrity check with aligned and misaligned thinking |
| [`gateway-integration/`](examples/gateway-integration/) | Cloudflare Worker gateway with real-time AIP analysis |
| [`adversarial/`](examples/adversarial/) | Attack scenarios: injection, drift, meta-injection, deception |

## Status

**Current Version**: 0.1.4

| Component | Status |
|-----------|--------|
| Specification | ✅ Complete |
| TypeScript SDK | ✅ Complete (272 tests) |
| Python SDK | ✅ Complete (267 tests) |
| Provider Adapters | ✅ Anthropic, OpenAI, Google, Fallback |
| Session Windowing | ✅ Complete |
| Drift Detection | ✅ Complete |
| Gateway Integration | ✅ Verified (Cloudflare Workers) |

## Standards & Compliance

AIP aligns with and supports compliance for the following international standards and regulatory frameworks:

| Standard | Relevance to AIP |
|----------|-----------------|
| **[ISO/IEC 42001:2023](https://www.iso.org/standard/42001)** — AI Management Systems | Integrity Checkpoints provide continuous monitoring evidence for 42001 management system requirements |
| **[ISO/IEC 42005:2025](https://www.iso.org/standard/42005)** — AI System Impact Assessment | Real-time integrity analysis and drift detection support ongoing impact assessment |
| **[IEEE 7001-2021](https://standards.ieee.org/ieee/7001/6929/)** — Transparency of Autonomous Systems | AIP makes agent *reasoning* transparent — not just decisions, but the thinking that precedes them |
| **[IEEE 3152-2024](https://standards.ieee.org/ieee/3152/11718/)** — Transparent Human and Machine Agency Identification | Integrity Checkpoints link `agent_id` to thinking analysis, supporting agency identification in real-time |
| **[Singapore IMDA Model AI Governance Framework for Agentic AI](https://www.imda.gov.sg/-/media/imda/files/about/emerging-tech-and-research/artificial-intelligence/mgf-for-agentic-ai.pdf)** (Jan 2026) | Real-time conscience analysis addresses IMDA's governance principles for agentic AI monitoring |
| **[EU AI Act Article 50](https://artificialintelligenceact.eu/article/50/)** — Transparency Obligations (enforcement Aug 2026) | Integrity Checkpoints with structured verdicts, thinking hashes, and session windows provide the transparency and audit trail required by Article 50. See [EU AI Act Compliance Guide](docs/EU_AI_ACT_MAPPING.md) (forthcoming) |

## Contributing

We welcome contributions. See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

Key areas where we need help:

- Provider adapter implementations for additional LLMs
- Integration examples with agent frameworks
- Adversarial test vectors
- Documentation improvements

## License

Apache 2.0. See [LICENSE](LICENSE) for details.

---

*Agent Integrity Protocol is part of the [Mnemom.ai](https://github.com/mnemom) trust infrastructure for autonomous agents, alongside [AAP](https://github.com/mnemom/aap) (Agent Alignment Protocol).*
