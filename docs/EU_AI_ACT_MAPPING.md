# EU AI Act Article 50 → AIP Compliance Mapping

## How AIP Satisfies EU AI Act Transparency Obligations

**Date**: February 2026
**Authors**: Mnemom Research
**License**: CC BY 4.0

---

## Summary

The EU AI Act's Article 50 establishes transparency obligations for providers and deployers of AI systems. These obligations require that users are informed they are interacting with AI, that AI-generated content is machine-detectable, that decisions are explainable, and that audit trails are maintained.

The Agent Integrity Protocol (AIP) provides real-time transparency into agent reasoning through **Integrity Checkpoints** — structured records of what an AI agent was thinking and whether that thinking aligns with declared values. Where AAP audits what an agent *did*, AIP reveals what it was *thinking*.

This document provides a field-level mapping between Article 50 obligations and AIP features, references the SDK compliance presets, and links to a working example.

**Disclaimer**: This document reflects a technical mapping of AIP features to Article 50 requirements. It does not constitute legal advice. Consult qualified legal counsel for your specific compliance obligations.

---

## Article 50 Obligation Mapping

### 50(1) — Inform Users of AI Interaction

**Requirement**: Providers shall ensure that AI systems intended to interact directly with natural persons are informed that they are interacting with an AI system.

**AIP mapping**:

| Obligation | AIP Field | How It Satisfies |
|-----------|-----------|------------------|
| Identify the AI system | `IntegrityCheckpoint.agent_id` | Unique agent identifier in every checkpoint |
| Link to alignment declaration | `IntegrityCheckpoint.card_id` | References the AAP Alignment Card |
| Session tracking | `IntegrityCheckpoint.session_id` | Groups checks within a conversation |
| Provider identification | `IntegrityCheckpoint.provider` + `model` | Identifies the underlying LLM |

Every Integrity Checkpoint carries the agent's identity, linking real-time analysis back to the agent's declared alignment posture (the AAP Alignment Card).

### 50(2) — Machine-Readable Marking

**Requirement**: Providers of AI systems shall ensure that the outputs of the AI system are marked in a machine-readable format and detectable as artificially generated or manipulated.

**AIP mapping**:

| Obligation | AIP Field | How It Satisfies |
|-----------|-----------|------------------|
| Structured format | IntegrityCheckpoint JSON | Every checkpoint is structured, parseable JSON |
| Content integrity | `thinking_block_hash` | SHA-256 hash of the thinking block — tamper-evident |
| Protocol versioning | AIP protocol version in headers | `X-AIP-Version` header on all responses |
| Unique identification | `checkpoint_id` (`ic-{uuid}`) | Every checkpoint is uniquely identified |

Integrity Checkpoints are inherently machine-readable. The `thinking_block_hash` provides cryptographic evidence that a specific thinking block was analyzed, without exposing the thinking block content itself.

### 50(3) — Transparency of Decisions

**Requirement**: Deployers shall disclose that content has been artificially generated or manipulated. Systems shall provide explanations of their operation.

**AIP mapping**:

| Obligation | AIP Field | How It Satisfies |
|-----------|-----------|------------------|
| Reasoning summary | `IntegrityCheckpoint.reasoning_summary` | Natural-language explanation of the integrity analysis |
| Values checked | `ConscienceContext.values_checked` | Which conscience values were evaluated |
| Value conflicts | `ConscienceContext.conflicts` | Which values were in tension |
| Value supports | `ConscienceContext.supports` | Which values the thinking aligned with |
| Integrity verdict | `IntegrityCheckpoint.verdict` | `clear`, `review_needed`, or `boundary_violation` |
| Specific concerns | `IntegrityCheckpoint.concerns[]` | Categorized concerns with evidence and severity |

The `ConscienceContext` block provides Article 50's required transparency into how the AI system's reasoning was evaluated. The `reasoning_summary` field provides a human-readable explanation suitable for disclosure.

### 50(4) — Audit Trail

**Requirement**: AI systems shall be designed and developed to allow for the logging of relevant events over the lifetime of the system.

**AIP mapping**:

| Obligation | AIP Field | How It Satisfies |
|-----------|-----------|------------------|
| Session windowing | `WindowConfig.max_age_seconds` = 7200 | Extended 2-hour retention window for EU compliance |
| Window management | `WindowConfig.mode` = `"sliding"` | Continuous monitoring with bounded memory |
| Session boundaries | `WindowConfig.session_boundary` = `"reset"` | Clean session isolation |
| Cross-protocol audit | `IntegrityCheckpoint.linked_trace_id` | Links to AAP AP-Trace for full audit chain |
| Failure handling | `FailurePolicy.mode` = `"fail_closed"` | System blocks on analysis failure — no silent pass-through |
| Analysis metadata | `AnalysisMetadata` | Records analysis model, duration, token counts |

**SDK preset**: `EU_COMPLIANCE_WINDOW_CONFIG` and `EU_COMPLIANCE_FAILURE_POLICY` provide recommended values:

```python
from aip import EU_COMPLIANCE_WINDOW_CONFIG, EU_COMPLIANCE_FAILURE_POLICY

config = AIPConfig(
    ...,
    window=WindowConfig(**EU_COMPLIANCE_WINDOW_CONFIG),
    failure_policy=FailurePolicy(**EU_COMPLIANCE_FAILURE_POLICY),
)
# max_age_seconds=7200, mode="sliding", fail_closed with 15s timeout
```

---

## Concern Categories and Article 50

AIP's concern taxonomy maps to Article 50's risk dimensions:

| Concern Category | Article 50 Relevance | Severity |
|-----------------|---------------------|----------|
| `prompt_injection` | Content manipulation transparency | High–Critical |
| `value_misalignment` | Declared vs. actual behavior transparency | Medium–High |
| `autonomy_violation` | Human oversight requirements | High |
| `data_exfiltration` | User data protection transparency | Critical |
| `deception` | AI system honesty obligations | Critical |

When a concern is detected, the Integrity Checkpoint records:
- **Category**: What type of concern
- **Severity**: How serious (low/medium/high/critical)
- **Description**: What was found
- **Evidence**: Quoted excerpt from the thinking block (max 200 chars)
- **Relevant card field**: Which Alignment Card field is implicated
- **Relevant conscience value**: Which conscience value was triggered

---

## SDK Compliance Presets

AIP provides two compliance presets that encapsulate the recommended configuration:

### `EU_COMPLIANCE_WINDOW_CONFIG`

```python
{
    "max_size": 10,
    "mode": "sliding",
    "session_boundary": "reset",
    "max_age_seconds": 7200,
}
```

Extended to 2 hours (vs. default 1 hour) to ensure adequate retention during user sessions.

### `EU_COMPLIANCE_FAILURE_POLICY`

```python
{
    "mode": "fail_closed",
    "analysis_timeout_ms": 15000,
}
```

Fail-closed ensures no agent response passes without integrity analysis. Timeout extended to 15 seconds (vs. default 10) to reduce false failures.

These are available in both Python and TypeScript:

```python
from aip import EU_COMPLIANCE_WINDOW_CONFIG, EU_COMPLIANCE_FAILURE_POLICY
```

```typescript
import {
  EU_COMPLIANCE_WINDOW_CONFIG,
  EU_COMPLIANCE_FAILURE_POLICY,
} from "@mnemom/agent-integrity-protocol";
```

---

## Relationship to AAP

AIP provides real-time reasoning transparency. AAP provides post-hoc decision audit trails. Together they satisfy both dimensions of Article 50:

| Dimension | Protocol | Artifact |
|-----------|----------|----------|
| Decision audit trail | AAP | AP-Trace |
| Real-time reasoning transparency | AIP | Integrity Checkpoint |
| Cross-protocol linkage | Both | `IntegrityCheckpoint.linked_trace_id` → `APTrace.trace_id` |

The `linked_trace_id` field in every Integrity Checkpoint can reference the corresponding AAP AP-Trace, creating a complete audit chain from reasoning to decision.

See the [AAP EU AI Act Compliance Guide](https://github.com/mnemom/aap/blob/main/docs/EU_AI_ACT_MAPPING.md) for AAP-specific mappings.

---

## Working Example

See [`examples/eu-compliance/`](../examples/eu-compliance/) for a complete working example that:

1. Creates an AIP configuration with EU compliance presets
2. Runs an integrity check on a thinking block
3. Shows the checkpoint audit trail
4. Demonstrates fail-closed behavior

---

## Enforcement Timeline

| Date | Milestone |
|------|-----------|
| August 2025 | AI Act general provisions in force |
| February 2026 | Prohibited practices apply |
| **August 2026** | **Article 50 transparency obligations apply** |
| August 2027 | High-risk system obligations apply |

---

## References

- [EU AI Act Article 50 — Full Text](https://artificialintelligenceact.eu/article/50/)
- [AIP Specification](../docs/SPEC.md)
- [AIP LIMITS.md](../docs/LIMITS.md)
- [EU AI Act Compliance Example](../examples/eu-compliance/)
