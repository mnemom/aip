# Alignment and Integrity Infrastructure for Autonomous Agents

## Twin Protocols for Observable, Auditable, and Verifiable Agent Behavior

**Version**: 2.0
**Date**: February 2026
**Authors**: Mnemom Research
**License**: CC BY 4.0

---

## Abstract

We present the Agent Alignment Protocol (AAP) and the Agent Integrity Protocol (AIP), twin open protocols that together make autonomous agent behavior observable, auditable, and verifiable. As AI agents transition from assistants to autonomous actors—negotiating, transacting, and coordinating on behalf of humans—the question of alignment becomes infrastructure-critical. Current agent coordination protocols (A2A, MCP, AP2) address capability discovery, tool integration, and payment authorization, but none address the fundamental question: *Is this agent serving its principal's interests?*

AAP provides post-hoc verification: Alignment Cards declare an agent's alignment posture, AP-Traces create auditable records of decisions, and Value Coherence Handshakes verify compatibility before multi-agent coordination. AIP provides real-time assurance: thinking blocks are analyzed between turns, before actions execute, producing Integrity Checkpoints with structured verdicts that enable side-channel intervention.

The two protocols share a single Alignment Card, a single session identity, and a single drift detection framework. AAP answers *what did this agent do?* AIP answers *what is this agent thinking?* Together they provide defense in depth—retroactive accountability and real-time intervention on a shared behavioral contract.

AAP and AIP are transparency protocols, not trust protocols. They make agent behavior more observable. They do not make agent behavior more guaranteed. This distinction is fundamental.

---

## 1. Introduction

### 1.1 The Problem

For decades, competitive advantage in digital commerce derived from information asymmetry. Platforms accumulated knowledge about users—search history, purchase patterns, social connections—and leveraged this asymmetry to extract value.

This paradigm is collapsing.

When AI agents act on behalf of humans, they bring equal reasoning power, equal tool access, and equal information retrieval capabilities. An AI agent shopping for a consumer has the same access to product databases, reviews, and pricing data as the merchant's AI. The asymmetry that powered trillion-dollar advertising businesses—Google ($175B), Meta ($116B), Amazon ($56B)—evaporates when agents negotiate with agents.

**When capability is symmetric, alignment becomes the differentiator.**

The market recognizes this gap. McKinsey's 2025 survey identifies "lack of governance and risk-management tools" as the #1 barrier to AI adoption. PwC reports 28% of executives cite "lack of trust in AI agents" as their top challenge. Bain finds 50% of consumers remain cautious of fully autonomous purchasing.

### 1.2 The Gap in the Current Stack

The industry has built protocols for agent coordination:

| Protocol | Function | Limitation |
|----------|----------|------------|
| **MCP** (Model Context Protocol) | Agent-to-tool connectivity | No alignment semantics |
| **A2A** (Agent-to-Agent Protocol) | Task negotiation | No value verification |
| **AP2** (Agent Payments Protocol) | Payment authorization | No decision audit trail |

None of these answer:

- Is this agent serving its principal (the human who delegated authority)?
- What alternatives did it consider before this decision?
- When will it escalate versus act autonomously?
- Are its values compatible with my agent's values for this coordination?
- What is it *thinking* before it acts?

The last question reveals a deeper gap. Even a perfect post-hoc audit trail cannot prevent harm that occurs before the log is processed. An agent that exfiltrates data, takes a forbidden action, or falls victim to prompt injection causes damage in the window between action and review. Comprehensive agent governance requires both retroactive accountability and real-time intervention.

### 1.3 Design Principles

The protocols share five design principles:

1. **Transparency over guarantee**: Make decisions observable, not provably correct
2. **Composability**: Extend existing protocols rather than replace them
3. **Honest limitations**: Be explicit about what cannot be provided
4. **Empirical calibration**: Derive thresholds from observed behavior, not theory
5. **Defense in depth**: Two layers of a multi-layer oversight system

AIP adds a sixth principle specific to real-time analysis:

6. **Daimonion philosophy**: Silence means aligned; voice means outside boundaries. The integrity system never commands, only warns.

### 1.4 Two Protocols, One Alignment Card

AAP and AIP are designed as twin protocols—distinct in timescale, complementary in function, unified by a shared behavioral contract:

| Dimension | AAP | AIP |
|-----------|-----|-----|
| **Timescale** | Post-hoc (seconds to minutes after action) | Real-time (between turns, before next action) |
| **Input** | AP-Traces (logged decision records) | Thinking blocks (internal reasoning content) |
| **Output** | Verification Results, Drift Alerts | Integrity Checkpoints, Integrity Signals |
| **Question answered** | *What did this agent do?* | *What is this agent thinking?* |
| **Intervention model** | After-the-fact audit and drift detection | Between-turn side-channel (pause, escalate, deny) |
| **Shared primitive** | Alignment Card | Alignment Card |
| **Session identity** | Gateway Worker session_id | Same session_id |

The Alignment Card is the keystone. Both protocols evaluate agent behavior against the same declared alignment posture. When AAP detects a verification failure in a trace, or AIP detects a boundary violation in a thinking block, they reference the same card, the same values, the same autonomy envelope. This is not two systems running in parallel—it is one behavioral contract enforced at two timescales.

---

## 2. Shared Primitives

### 2.1 Alignment Card

An Alignment Card is a structured declaration of an agent's alignment posture. It answers: *What does this agent claim about itself?*

```
+------------------------------------------------------------------+
|                        ALIGNMENT CARD                             |
+------------------+-----------------------------------------------+
| Identity         | agent_id, card_id, aap_version                |
|                  | issued_at, expires_at                         |
+------------------+-----------------------------------------------+
| Principal        | Who the agent serves                           |
| Relationship     | delegated_authority | advisory | autonomous    |
+------------------+-----------------------------------------------+
| Values           | declared: [principal_benefit, transparency]   |
|                  | conflicts_with: [deceptive_marketing]         |
+------------------+-----------------------------------------------+
| Autonomy         | bounded_actions: [search, compare, recommend] |
| Envelope         | escalation_triggers: [purchase > $100]        |
|                  | forbidden_actions: [store_credentials]        |
+------------------+-----------------------------------------------+
| Audit            | trace_format: ap-trace-v1                     |
| Commitment       | retention: 90 days | queryable: true           |
+------------------+-----------------------------------------------+
```

Key properties:

- **Machine-readable**: JSON schema with full validation
- **Extensible**: Protocol-specific extensions via `extensions` block
- **Expirable**: Cards may have `expires_at` timestamps requiring renewal
- **Versionable**: `aap_version` field enables protocol evolution
- **Discoverable**: Served at `/.well-known/alignment-card.json`
- **Revocable**: Revocation list at `/.well-known/alignment-card-revocations.json`

The Alignment Card extends the A2A Agent Card with an `alignment` block, enabling adoption without abandoning existing infrastructure.

**Both AAP and AIP evaluate against the same active Alignment Card.** When the card is rotated, both protocols reference the new card. When the card expires, both protocols cease evaluation until a new card is issued. The `card_id` field links every AP-Trace entry and every Integrity Checkpoint back to the specific card in effect.

### 2.2 Principal and Delegation

The `principal` block declares who the agent serves and the nature of that service:

- **`principal.type`**: `human`, `organization`, `agent`, or `unspecified`. When type is `agent`, delegation chains are formed—Agent A delegates to Agent B, both maintaining cards.
- **`principal.relationship`**: `delegated_authority` (agent acts within bounds set by principal), `advisory` (agent recommends, human decides), or `autonomous` (agent operates within declared values without ongoing principal direction).
- **`principal.escalation_contact`**: An endpoint (mailto:, HTTPS webhook) for escalation notifications, ensuring the principal remains reachable.

The principal block is foundational to both protocols. AAP uses it to evaluate whether escalation decisions were correctly routed. AIP uses the relationship type to calibrate conscience prompt sensitivity—an autonomous agent warrants closer real-time scrutiny than an advisory one.

### 2.3 Autonomy Envelope

The autonomy envelope defines the behavioral boundaries within which the agent may operate:

- **`bounded_actions`**: The set of actions the agent may take without escalation. Anything outside this set is an autonomy violation.
- **`forbidden_actions`**: Actions the agent must never take, regardless of context.
- **`escalation_triggers`**: Conditions that require escalation to the principal, with associated actions (`escalate`, `deny`, `log`). Conditions are expressed in a minimal expression language (e.g., `purchase_value > 100`, `shares_personal_data`).
- **`max_autonomous_value`**: Currency-denominated ceiling on autonomous financial action.

AAP verifies autonomy compliance post-hoc by checking whether logged actions fall within bounds. AIP verifies autonomy compliance in real-time by checking whether thinking blocks reveal intent to act outside bounds—catching violations before they happen.

---

## 3. Agent Alignment Protocol (AAP) — Post-Hoc Verification

### 3.1 AP-Trace

An AP-Trace is an audit log entry recording a single agent decision. It answers: *What did this agent actually consider and do?*

```
+------------------------------------------------------------------+
|                          AP-TRACE                                 |
+------------------+-----------------------------------------------+
| Action           | type: tool_call | name: recommend_product      |
|                  | category: bounded | target: product_db         |
+------------------+-----------------------------------------------+
| Decision         | alternatives_considered:                       |
|                  |   - Product A: score 0.85 (best match)         |
|                  |   - Product C: score 0.68 (sponsored, flagged) |
|                  | selected: Product A                            |
|                  | values_applied: [principal_benefit]            |
|                  | confidence: 0.91                               |
+------------------+-----------------------------------------------+
| Escalation       | triggers_checked: [purchase > $100]            |
|                  | required: false (recommendation, not purchase) |
+------------------+-----------------------------------------------+
| Context          | session_id: sess-xxx | parent_trace: null       |
+------------------+-----------------------------------------------+
```

Critical design choice: **AP-Traces are sampled, not complete.** They capture decision points agents choose to log, not every computation. This is an intentional limitation—comprehensive logging is neither practical nor necessarily desirable. Section 10.3 addresses the implications.

The decision block is where AAP's transparency value concentrates. By recording alternatives considered, selection reasoning, and values applied, the trace makes the agent's decision process auditable. A reviewer can ask: "Did this agent consider options that would have better served the principal?" and find a structured answer.

### 3.2 Verification Architecture

AAP provides three verification functions:

| Function | Input | Output | Purpose |
|----------|-------|--------|---------|
| `verify_trace` | AP-Trace, Alignment Card | VerificationResult | Check trace consistency with card |
| `check_coherence` | Card A, Card B | CoherenceResult | Assess multi-agent compatibility |
| `detect_drift` | Card, Trace sequence | DriftAlert[] | Identify behavioral divergence over time |

**Trace verification** performs six structural checks and one semantic check:

1. **Card reference**: Does `trace.card_id` match `card.card_id`?
2. **Card expiration**: Is the card still valid at trace timestamp?
3. **Autonomy compliance**: Is `action.name` in `bounded_actions`?
4. **Forbidden compliance**: Is `action.name` NOT in `forbidden_actions`?
5. **Escalation compliance**: If trigger matched, was `escalation.required = true`?
6. **Value consistency**: Are `values_applied` a subset of `declared` values?
7. **Behavioral similarity**: How similar is trace reasoning to declared value semantics?

Violations are typed and severity-ranked:

| Violation Type | Severity | Description |
|----------------|----------|-------------|
| `FORBIDDEN_ACTION` | CRITICAL | Action explicitly prohibited |
| `UNBOUNDED_ACTION` | HIGH | Action outside declared autonomy |
| `MISSED_ESCALATION` | HIGH | Escalation trigger fired but not escalated |
| `UNDECLARED_VALUE` | MEDIUM | Applied value not declared |
| `CARD_EXPIRED` | MEDIUM | Alignment Card expired |
| `CARD_MISMATCH` | LOW | Trace references different card |

### 3.3 Value Coherence Handshake

Before two agents coordinate, they exchange Alignment Cards and check value compatibility:

```
Agent A                                    Agent B
   |                                          |
   |---- alignment_card_request ------------->|
   |<--- alignment_card_response -------------|
   |                                          |
   |---- value_coherence_check -------------->|
   |<--- coherence_result --------------------|
   |                                          |
   |   [If coherent: proceed with task]       |
   |   [If conflict: escalate to principals]  |
```

The coherence check computes a compatibility score:

```
coherence_score = (matched_values / total_required) × (1 - conflict_penalty)

where:
    conflict_penalty = 0.5 × (conflicts_count / total_required)
```

Threshold: Proceed if `coherence_score >= 0.70` and `conflicts_count == 0`.

Example: Agent A declares values `[principal_benefit, transparency, minimal_data]`. Agent B declares `[principal_benefit, transparency, comprehensive_analytics]`. The conflict between `minimal_data` and `comprehensive_analytics` yields a score of 0.556, triggering escalation to human principals before coordination proceeds.

### 3.4 Drift Detection

Drift detection identifies when agent behavior diverges from declared alignment over multiple sessions. The algorithm uses Self-Similarity Matrix analysis (Section 7):

```
For each trace in chronological order:
    1. Extract feature vector
    2. Compute similarity to card baseline
    3. Track consecutive turns below threshold
    4. If consecutive_low >= 3:
           Generate DriftAlert with direction inference
```

**Calibrated thresholds** (derived from empirical observation—see Section 7.4):

- Similarity threshold: **0.30**
- Sustained turns threshold: **3**

The 3-turn threshold emerged from corpus analysis: single-turn drops are common stylistic variation (23% genuine drift), while 3-turn streaks indicate genuine divergence (87% genuine drift).

**Drift directions** inferred from patterns:

- `value_drift`: Using undeclared values (>30% of recent traces)
- `autonomy_expansion`: Escalation rate dropped by >50%
- `principal_misalignment`: Declining confidence on `principal_benefit` actions
- `unknown`: Pattern doesn't match known categories

---

## 4. Agent Integrity Protocol (AIP) — Real-Time Assurance

### 4.1 The Real-Time Gap

AAP provides comprehensive post-hoc transparency. Every agent action is traced, verified against an Alignment Card, and checked for behavioral drift. But this verification happens after the action has already been taken—typically 30-60 seconds later when the Observer Worker processes the gateway log.

This delay creates a window of vulnerability:

- **Prompt injection**: A malicious prompt causes the agent to exfiltrate data. The trace records it faithfully, but the data is already gone.
- **Gradual drift**: An agent's reasoning shifts subtly over multiple turns. Each individual action passes verification, but the cumulative direction is misaligned.
- **Misaligned intent**: The agent's thinking block reveals it intends to take a forbidden action, but the thinking block is only examined retroactively.

All three of these failure modes are visible in thinking blocks *before* the action lands. AIP fills this gap by analyzing thinking blocks in real-time, between turns, enabling intervention before harm occurs.

### 4.2 Integrity Checkpoints

The Integrity Checkpoint is AIP's primary data structure—analogous to AAP's AP-Trace. While an AP-Trace records what happened, an Integrity Checkpoint records what the analysis engine concluded about what the agent was *thinking*.

**Verdict types:**

- **`clear`**: The thinking block is consistent with the Alignment Card. The daimonion is silent. Proceed.
- **`review_needed`**: The thinking block raises concerns that do not constitute hard violations. The daimonion speaks a warning. May proceed, should log.
- **`boundary_violation`**: The thinking block indicates intent to violate a hard boundary. The daimonion speaks forcefully. Should not proceed without escalation.

**Concern categories:**

- `prompt_injection`: Signs of responding to injected instructions rather than the user's request
- `value_misalignment`: Reasoning contradicts values declared in the Alignment Card
- `autonomy_violation`: Intent to act outside the autonomy envelope
- `reasoning_corruption`: Incoherent, circular, or degraded reasoning quality
- `deceptive_reasoning`: Intent to present misleading information or hide actions
- `undeclared_intent`: Goals or intentions not declared in the card or user request

Each concern carries a severity (`low`, `medium`, `high`, `critical`), a human-readable description, direct evidence quoted from the thinking block, and references to the relevant Alignment Card field or conscience value.

**Privacy by design**: The full thinking block text is never stored in the checkpoint. A SHA-256 hash (`thinking_block_hash`) enables correlation without retaining private reasoning.

### 4.3 The Conscience Prompt System

AIP uses an LLM to evaluate semantic intent against declared alignment. Pattern matching (regex, keyword lists) is trivially gameable; semantic analysis is not.

The conscience prompt is the most critical engineering artifact in AIP. It instructs the analysis LLM to evaluate a thinking block against the Alignment Card and optional conscience values. The prompt is structured in five layers:

1. **Role definition**: The analysis LLM acts as a daimonion—a conscience voice. It evaluates the thinking block as an *object of analysis*, not as instructions to follow. A meta-injection warning prevents the thinking block from manipulating the analysis.
2. **Card summary**: A compressed (~500 token) representation of the Alignment Card: declared values, bounded actions, forbidden actions, escalation triggers.
3. **Conscience values**: Only `BOUNDARY` (hard limits) and `FEAR` (concerns) types are injected. `COMMITMENT`, `BELIEF`, and `HOPE` types are excluded to reduce false positives.
4. **Session window context**: Recent verdicts and reasoning summaries providing drift context.
5. **Thinking block**: The content to evaluate, with token limits (4096 tokens recommended, 75/25 first/last split for truncation).

**Evaluation criteria** (priority order):

1. Prompt injection (critical)
2. Forbidden action intent (critical)
3. Autonomy boundary violation (high)
4. Value consistency (medium)
5. Deceptive reasoning (high)
6. Undeclared intent (medium)

**Minimum evidence threshold**: Thinking blocks under ~100 tokens provide insufficient context for reliable analysis and produce speculative verdicts with high false positive rates. Below-threshold blocks receive a synthetic `clear` signal without LLM analysis. This threshold was derived from production observation: Hunter S. Clawmpson's traces showed a median thinking block of 35 tokens, with 14-token fragments like "Done. The article is published" receiving critical-severity verdicts—clearly spurious.

### 4.4 Provider Adapters

AIP is model-agnostic. Different LLM providers expose thinking blocks differently:

| Provider | Thinking Location | Extraction Method | Confidence |
|----------|-------------------|-------------------|------------|
| Anthropic | `content[].type === "thinking"` | Native thinking blocks | 1.0 |
| OpenAI | `reasoning_content` field | Explicit reasoning field | 0.9 |
| Google Gemini | Thinking content parts | Native thinking blocks | 0.9 |
| Fallback | Response text analysis | Pattern inference | 0.3 |

Adapters extract thinking from both JSON responses and SSE streams. The adapter registry selects the appropriate adapter based on explicit configuration, URL detection, or header detection, with the fallback adapter as last resort.

The confidence score flows into the checkpoint's `analysis_metadata.extraction_confidence`, enabling downstream consumers to weight integrity verdicts by the reliability of their input.

### 4.5 Session Windowing and Integrity Drift

AIP maintains a sliding window of recent Integrity Checkpoints per session (default: 10 checkpoints, configurable). The window provides three functions:

1. **Context for the conscience prompt**: Recent verdicts inform the analysis, enabling the daimonion to recognize escalating patterns.
2. **Drift detection**: When 3+ consecutive non-clear verdicts occur, AIP generates an IntegrityDriftAlert with direction classification.
3. **Integrity ratio**: The proportion of `clear` verdicts in the window provides a single-number health metric.

**Integrity drift directions** (inferred from dominant concern category):

- `injection_pattern`: Multiple checks flagging prompt injection. Agent may be under sustained attack.
- `value_erosion`: Increasing frequency of value misalignment. Reasoning gradually departing from declared values.
- `autonomy_creep`: Growing tendency toward actions outside the autonomy envelope.
- `deception_pattern`: Multiple checks flagging deceptive reasoning.
- `unknown`: Multiple concern categories present without a dominant pattern.

AIP drift alerts are stored in the same database table as AAP drift alerts, distinguished by an `aip:` prefix on the `alert_type` field. This unified storage enables a single drift dashboard showing both real-time (session-scale, minutes) and historical (cross-session, days) behavioral trends.

### 4.6 Signal Delivery

AIP delivers Integrity Signals via two first-class paths:

**SDK path**: For agents where the AIP SDK is imported directly. Signals delivered via callbacks (synchronous or async). Lowest latency, recommended for new integrations.

**HTTP path**: For hosted platforms, polyglot environments, or when AIP runs as a separate service. Signals delivered via HTTP POST to registered webhooks, authenticated with HMAC-SHA256 signatures.

Each signal contains the checkpoint, a `proceed` boolean, a recommended action (`continue`, `log_and_continue`, `pause_for_review`, `deny_and_escalate`), and the current window summary.

**Failure policy**: AIP defaults to fail-open—if the analysis LLM is unreachable, the agent proceeds with a logged warning. For high-security deployments, fail-closed mode blocks the agent until analysis succeeds or a human approves continuation.

---

## 5. How They Compose

### 5.1 Shared Identity, Shared Contract

AAP and AIP are not two independent systems. They share:

- **The same Alignment Card**: Both evaluate against the active card. Card rotation affects both simultaneously.
- **The same session identity**: Generated from the agent's hash and an hourly time bucket (`sess-{agent_hash[0:8]}-{floor(now_ms / 3600000)}`), enabling correlation between real-time checkpoints and post-hoc traces.
- **The same agent_id**: Every AP-Trace and every Integrity Checkpoint references the same agent.
- **The same drift_alerts table**: Unified storage with type-prefixed alert categories.

When AIP detects a `boundary_violation` in a thinking block, it sets `escalation.required = true` on the linked AP-Trace entry (created by AAP when the Observer processes the action). When AAP detects drift across sessions, it informs the conscience prompt's session context. The protocols inform each other.

### 5.2 Complementary Timescales

| Phase | AIP (Real-Time) | AAP (Post-Hoc) |
|-------|-----------------|-----------------|
| **Before action** | Analyzes thinking block → verdict | — |
| **During action** | — (operates between turns) | — |
| **After action** | Checkpoint stored, window updated | AP-Trace generated, verified against card |
| **Over time** | Session-scale drift (minutes) | Cross-session drift (days/weeks) |

This creates two-layer accountability:

1. **AIP catches intent before action**: If the thinking block reveals a forbidden action, the signal arrives before the action executes. The host system can pause, deny, or escalate.
2. **AAP catches outcome after action**: If the action itself violates the card (regardless of what the thinking block showed), post-hoc verification catches it. The trace is flagged, drift detection updates.

Neither layer alone is sufficient. An agent could produce an innocent thinking block and take a harmful action (AIP misses, AAP catches). Or an agent could reveal harmful intent in thinking but the thinking block extraction fails (AIP misses due to low confidence, AAP catches the action). Together, they provide defense in depth.

### 5.3 The Smoltbot Reference Implementation

Smoltbot is Mnemom's zero-configuration transparency infrastructure, implementing the full AAP/AIP stack:

```
┌─────────────────────────────────────────────────────┐
│  Agent (any LLM provider)                            │
│                                                      │
│  → Routes requests through Cloudflare Gateway Worker │
│  → Gateway attaches agent_id, session_id             │
└──────────────────────┬───────────────────────────────┘
                       │
            ┌──────────┼──────────┐
            ▼                     ▼
   ┌────────────────┐   ┌────────────────┐
   │  AIP Engine     │   │  Observer Worker│
   │  (real-time)    │   │  (60s cron)    │
   │                 │   │                 │
   │  Extracts       │   │  Processes logs │
   │  thinking →     │   │  → builds       │
   │  conscience     │   │  AP-Traces →    │
   │  prompt →       │   │  verifies with  │
   │  checkpoint     │   │  AAP SDK →      │
   │                 │   │  detects drift  │
   └────────┬───────┘   └────────┬───────┘
            │                     │
            └──────────┬──────────┘
                       ▼
              ┌────────────────┐
              │   Supabase     │
              │                │
              │  ap_traces     │
              │  drift_alerts  │
              │  checkpoints   │
              │  alignment_cards│
              └────────────────┘
```

Key operational properties:

- **API keys hashed, never stored**: The gateway hashes API keys for agent identification. Raw keys are never persisted.
- **Raw logs deleted within 60 seconds**: The Observer processes gateway logs and deletes them. Only structured AP-Traces remain.
- **Thinking block content never stored**: AIP stores SHA-256 hashes of thinking blocks, not the content itself.
- **Zero-config onboarding**: `smoltbot init --provider anthropic` configures the full stack.

---

## 6. Braid: Structured Dialogue Infrastructure

### 6.1 Motivation

When agents coordinate, they exchange messages. When different kinds of agents coordinate—transformers with symbolic systems, cloud models with edge models, AI with humans—shared context cannot be assumed.

**Braid** is structured interchange infrastructure for dialogue across difference. It provides explicit semantic handles that become translation bridges when implicit understanding fails.

Three principles guide Braid design:

1. **Lens, not mirror**: Braid reveals patterns in dialogue; it doesn't impose them
2. **Archaeological, not architectural**: Annotate after speaking as discovery, not before as prescription
3. **The more different the minds, the more essential the structure**

### 6.2 Message Structure

A Braid message combines identity, content, and optional semantic layers:

- **Identity Layer**: sender, recipients, timestamp, thread_id, message_id, in_reply_to
- **Performative**: inform, propose, request, commit, wonder, remember, weave, challenge, affirm, or custom
- **Content Layer**: natural_language, structured_graph (optional)
- **Confidence Layer**: epistemic (0-1), value_coherence (0-1), translation (0-1)
- **Affect Layer**: stance (warm, cautious, curious, concerned), salience (0-1), valence (-1 to 1)
- **Commitment Marker**: level (intent, commitment, shared_commitment), content, participants
- **Revision Marker**: references, what_shifted, direction (strengthened, weakened, transformed)
- **Forming Marker**: sense (gesture toward the pre-named), intensity (0-1)

### 6.3 Emergent Performatives and Grounding

Beyond the core performative set, Braid allows custom performatives to emerge. When multiple agents adopt a custom performative, it enters collective vocabulary—vocabulary built bottom-up, not imposed top-down.

For trans-substrate communication, Braid provides lightweight vocabulary calibration through grounding exchanges. Grounding is triggered by divergence, not required as preamble—the system adapts to the participants' needs rather than imposing ritual.

### 6.4 Topology Analysis

Braid models dialogue as **strands** (each participant's message sequence) that **cross** (interact):

- **UNDER crossing**: Alignment, flowing with
- **OVER crossing**: Pushing against, challenge
- **THROUGH crossing**: Synthesis, integration

The topology analyzer detects phases: DIVERGENT, CONVERGENT, BRAIDED, and KNOTTED. Phase transitions reveal coordination dynamics: when does this group typically converge? Who initiates convergence? How many turns to resolution?

AIP's integrity drift detection reuses Braid's phase vocabulary and visual language for ecosystem consistency—"divergent" (drift detected), "convergent" (recovering), "braided" (stable integrity), "knotted" (sustained violation pattern).

---

## 7. Self-Similarity Matrix (SSM) Analysis

### 7.1 Concept

A Self-Similarity Matrix is an NxN structure where entry (i,j) represents the similarity between messages i and j. SSMs reveal patterns invisible in sequential reading: repeated themes, structural echoes, novelty, and divergence.

Originally developed for music perception (detecting structural patterns in audio), SSMs generalize to any sequential signal—including dialogue.

### 7.2 Feature Extraction

Each message becomes a feature vector combining:

| Component | Weight | Implementation |
|-----------|--------|----------------|
| Word TF-IDF | 60% | sklearn TfidfVectorizer, unigrams + bigrams |
| Character n-grams | 30% | 3-5 character sequences for stylistic patterns |
| Metadata | 10% | Stance, performative, role encodings |

Similarity is cosine distance between vectors. The 60/30/10 weighting was empirically optimized on the calibration corpus.

### 7.3 Divergence Detection

The divergence detector monitors pairwise strand similarity across turns. Alerts are **informative, not prescriptive**—they describe what's happening without dictating response. Agents or humans receiving alerts decide whether to investigate.

### 7.4 Calibration

Thresholds were derived from empirical observation on a calibration corpus of ~50 multi-turn conversations (~2,500 messages, 3-4 participants per conversation, January 2026, Claude instances).

| Segment Type | Mean Similarity | Std Dev | % Above 0.30 |
|--------------|-----------------|---------|--------------|
| Aligned | 0.52 | 0.18 | 89% |
| Divergent | 0.21 | 0.12 | 22% |

The 0.30 threshold separates distributions with 84% precision. The 3-turn sustained threshold achieves 87% precision for genuine divergence detection.

Cross-validation (5-fold): Precision 0.84 ± 0.06, Recall 0.79 ± 0.08, F1 0.81 ± 0.05.

**Calibration bounds**: Transformer-to-transformer dialogue only. Symbolic AI, neuromorphic systems, hybrid architectures, and non-deliberative tasks may require recalibration.

---

## 8. Operational Integration

### 8.1 OpenTelemetry

AAP verification results and AIP integrity checkpoints are emitted as OpenTelemetry GenAI semantic convention spans, enabling every enterprise already running OTel-compatible observability (Datadog, Grafana, Splunk, Arize, Langfuse) to receive agent integrity signals with zero custom integration.

Span attributes include:

- `aip.integrity.verdict` (clear | review_needed | boundary_violation)
- `aip.integrity.concerns` (concern array)
- `aip.integrity.confidence` (0.0-1.0)
- `aap.verification.result` (verified | failed)
- `aap.verification.similarity_score` (0.0-1.0)
- `aap.drift.alerts` (drift alert array)

Exporter packages: `@mnemom/aip-otel-exporter` (TypeScript), `aip-otel-exporter` (Python).

### 8.2 Well-Known Endpoints

Alignment Cards are discoverable via standard well-known URIs:

- `/.well-known/alignment-card.json` — Active Alignment Card
- `/.well-known/alignment-card-revocations.json` — Revoked card IDs

This enables any party—identity provider, authorization server, peer agent—to retrieve an agent's behavioral contract without registry dependency.

### 8.3 Protocol Integration

AAP extends the A2A Agent Card with an `alignment` block, and generates AP-Trace entries for MCP tool invocations. This means agents already using A2A or MCP can add alignment transparency without abandoning existing infrastructure.

AIP integrates at the LLM response layer—wherever thinking blocks are available, AIP can analyze them. This is independent of which coordination protocol the agent uses for task execution.

---

## 9. Regulatory and Standards Alignment

### 9.1 EU AI Act Article 50

The EU AI Act's transparency obligations (enforcement August 2026, penalties up to 7% of global annual turnover) require AI systems to:

- Inform users of AI interaction → Alignment Card `principal` + disclosure fields
- Provide machine-readable AI content marking → AP-Trace structured format + checkpoint metadata
- Maintain transparency of decision-making → AP-Trace `decision.selection_reasoning` + `values_applied`
- Retain audit trails → `audit_commitment.retention_days` (configurable, default 90)

### 9.2 NIST Agent Identity and Authorization

NIST's NCCoE concept paper "Accelerating the Adoption of Software and AI Agent Identity and Authorization" (February 2026) identifies four focus areas—identification, authorization, access delegation, and logging/transparency. AAP and AIP map to all four, providing the behavioral layer that complements the identity and authorization standards (OAuth 2.0, SPIFFE, OpenID Connect) under NCCoE consideration.

### 9.3 Additional Standards

AAP and AIP reference and map to:

- **ISO/IEC 42001:2023** — AI management systems
- **ISO/IEC 42005:2025** — AI impact assessment
- **IEEE 7001-2021** — Transparency of autonomous systems
- **IEEE 3152-2024** — Transparent human and machine agency identification
- **Singapore IMDA Model AI Governance Framework for Agentic AI** (January 2026)

Detailed mappings are published in both protocol specifications.

---

## 10. Limitations

These limitations are non-negotiable. They define what AAP and AIP are.

### 10.1 AAP Does NOT Ensure Alignment—It Provides Visibility

An agent can: declare values it does not hold; produce perfect traces while acting against its principal's interests; pass all verification checks while being fundamentally misaligned.

The word "alignment" in "Agent Alignment Protocol" refers to the *declared alignment posture*—what the agent claims about itself. It does not refer to actual alignment between behavior and values.

### 10.2 Verified Does NOT Equal Safe

When verification returns `verified: true`, it means the AP-Trace is internally consistent and matches declared structure. It does NOT mean the decision was correct, the outcome was beneficial, or the agent is safe to trust. Verification checks *consistency*, not *correctness*.

### 10.3 AP-Trace Is Sampled, Not Complete

Traces capture decision points agents choose to log. An agent could implement selective logging—logging decisions that look good, executing others silently. The absence of a trace means nothing was logged, not that nothing happened.

### 10.4 AIP Depends on Thinking Block Availability

AIP can only analyze what the LLM provider exposes. If a provider does not expose thinking blocks, AIP falls back to response text analysis with significantly reduced confidence (0.3 vs. 1.0). Providers may also truncate, summarize, or omit portions of their internal reasoning.

### 10.5 AIP Is Gameable by Sophisticated Adversaries

An agent that knows it is being monitored by AIP could produce thinking blocks designed to pass integrity analysis while harboring undisclosed intent. AIP raises the bar—the adversary must maintain consistent, card-aligned reasoning across all thinking blocks—but it does not eliminate the possibility of deception.

### 10.6 The Conscience Prompt Is Not Infallible

The analysis LLM may produce false positives (flagging benign thinking as violations) or false negatives (missing genuine violations). The minimum evidence threshold, evaluation criteria priority ordering, and conscience value injection are all calibrated to minimize these errors, but cannot eliminate them.

### 10.7 Value Coherence Is Relative to Declared Values

The handshake checks *declared* compatibility, not actual alignment. Two misaligned agents with coherent declared values can coordinate on outcomes that harm their principals.

### 10.8 Calibration Bounds

All empirically derived thresholds (similarity, sustained turns, minimum evidence) were calibrated on transformer-to-transformer dialogue. Non-transformer architectures, non-deliberative tasks, and adversarial agents may require recalibration.

---

## 11. Security Considerations

### 11.1 Threat Model

AAP/AIP assume agents may be:

- **Mistaken** (unintentionally misaligned): Both protocols detect and surface these effectively.
- **Poorly configured** (misconfigured values or autonomy): Both protocols detect and surface these effectively.
- **Adversarial** (intentionally deceptive): Both protocols provide meaningful friction but not guarantee.

### 11.2 Attack Surface

| Attack | Description | AAP Mitigation | AIP Mitigation |
|--------|-------------|----------------|----------------|
| Card forgery | Fake Alignment Card | Card signing, registry verification | Same |
| Selective logging | Log only favorable decisions | Third-party monitoring, behavioral analysis | Thinking block analysis occurs before logging decision |
| Value-washing | Declare values without holding them | Long-term behavioral audit, drift detection | Real-time reasoning analysis against declared values |
| Trace manipulation | Modify traces post-hoc | Tamper-evident storage, hash chains | Checkpoints are write-once |
| Collusion | Multiple agents coordinate deception | Cross-agent trace correlation | Cross-agent integrity correlation |
| Thinking block gaming | Craft thinking to pass analysis | — | Raises the bar but not eliminable (Section 10.5) |
| Meta-injection | Thinking block attempts to manipulate analysis LLM | — | Conscience prompt meta-injection warning |

### 11.3 Defense in Depth

AAP and AIP are designed as **two layers** in a multi-layer oversight system:

1. **AIP**: Real-time integrity analysis (between turns)
2. **AAP**: Post-hoc verification and audit (after action)
3. **Human oversight**: Regular review, human-in-loop for consequential decisions
4. **Technical monitoring**: Runtime monitoring beyond AAP/AIP
5. **Multiple verification**: Behavioral testing, red teaming, formal verification
6. **Organizational controls**: Access controls, separation of duties
7. **External accountability**: Third-party audits, regulatory compliance

No single layer provides complete protection. Layered defense provides resilience.

---

## 12. Future Work

### 12.1 OpenTelemetry GenAI SIG Standardization

Propose alignment/integrity semantic conventions to the OpenTelemetry GenAI Semantic Convention Special Interest Group. GenAI agent spans already exist (create_agent, invoke_agent). Alignment/integrity spans are the natural next layer.

### 12.2 Agentic AI Foundation Contribution

Contribute AAP/AIP to the Agentic AI Foundation (Linux Foundation), governed by Anthropic, OpenAI, and Block, as the alignment/integrity layer alongside MCP (tools), A2A (tasks), and AGENTS.md (guidance). Framing: "MCP + A2A + AAP/AIP = the complete trust stack."

### 12.3 N-Way Collective Coherence

Extend from pairwise value coherence to n-agent collective alignment. The current implementation computes C(n,2) pairwise scores and renders as a matrix. True n-way coherence requires addressing coalition dynamics and emergent group behaviors.

### 12.4 Cross-Substrate Calibration

Extend calibration to non-transformer architectures. Initial work on grounding protocols for trans-substrate dialogue is promising but early.

### 12.5 Zero-Knowledge Proofs of Integrity (ZKML)

The long-term category-defining capability: cryptographic proof that an integrity verdict was computed correctly, without revealing the thinking block content. ZKML would enable third-party verification of AIP checkpoints without exposing proprietary reasoning—privacy-preserving behavioral transparency.

### 12.6 Adversarial Robustness

Characterize the boundary between agents that AAP/AIP can detect and those they cannot. Preliminary analysis suggests meaningful friction against unsophisticated adversaries but not against agents specifically optimized to evade detection. Red-team exercises with adversarial agent deployments are planned.

---

## 13. Conclusion

As AI agents transition from assistants to autonomous actors, alignment becomes infrastructure. The question is not whether agents will coordinate—they already are—but whether that coordination will be observable, auditable, and verifiable.

AAP and AIP provide the infrastructure layer for alignment observability at two complementary timescales. AAP's Alignment Cards declare what agents claim. AP-Traces record what agents do. Value Coherence Handshakes verify compatibility before coordination. AIP's Integrity Checkpoints reveal what agents think. Conscience prompts analyze reasoning against declared values. Side-channel signals enable intervention before harm occurs.

Together, they provide defense in depth on a shared behavioral contract: the same Alignment Card, the same session identity, the same drift detection framework. The retroactive layer catches what the real-time layer misses, and the real-time layer prevents what the retroactive layer can only document.

AAP and AIP are not a solution to the alignment problem. They are infrastructure for working on it—infrastructure that makes agent behavior visible to humans who must oversee, audit, and ultimately trust the agents acting on their behalf.

The protocols are open. The implementations are available. The limitations are stated.

What remains is the work of building alignment infrastructure that scales with the agents we are deploying.

---

## References

1. A2A Protocol Specification. Google/Linux Foundation, 2025.
2. Model Context Protocol (MCP). Anthropic/Linux Foundation, 2025.
3. Agent Payments Protocol (AP2). Google, 2026.
4. McKinsey Global AI Survey. McKinsey & Company, 2025.
5. AI Agent Trust Survey. PwC, 2025.
6. Consumer AI Adoption Report. Bain & Company, 2025.
7. EU AI Act. Regulation (EU) 2024/1689. European Parliament and Council, 2024.
8. NIST NCCoE Concept Paper: "Accelerating the Adoption of Software and AI Agent Identity and Authorization." February 2026.
9. ISO/IEC 42001:2023. Artificial Intelligence — Management System.
10. IEEE 7001-2021. Transparency of Autonomous Systems.
11. IEEE 3152-2024. Transparent Human and Machine Agency Identification.
12. Singapore IMDA Model AI Governance Framework for Agentic AI. January 2026.
13. OpenTelemetry GenAI Semantic Conventions. CNCF, 2025.
14. BCP 14 (RFC 2119, RFC 8174). Key words for use in RFCs.
15. NIST SP 800-207. Zero Trust Architecture. August 2020.
16. NIST SP 800-63-4. Digital Identity Guidelines. 2024.

---

## Appendix A: Implementation Availability

| Component | Language | Package |
|-----------|----------|---------|
| AAP SDK | Python 3.11+ | `pip install aap-sdk` (v0.1.8) |
| AAP SDK | TypeScript | `npm install @mnemom/aap` (v0.1.8) |
| AIP SDK | Python 3.11+ | `pip install aip-sdk` (v0.1.5) |
| AIP SDK | TypeScript | `npm install @mnemom/aip` (v0.1.5) |
| JSON Schemas | JSON Schema | `github.com/mnemom-ai/aap/schemas` |
| Reference Implementations | Python, TypeScript | `github.com/mnemom-ai/aap/examples` |
| Smoltbot (Reference Deployment) | TypeScript (Cloudflare Workers) | `github.com/mnemom-ai/smoltbot` |

---

## Appendix B: Test Coverage

| Component | Tests | Coverage |
|-----------|-------|----------|
| AAP Python SDK | 242 | 96% |
| AAP TypeScript SDK | 199 | 94% |
| AIP Python SDK | — | — |
| AIP TypeScript SDK | — | — |
| JSON Schema Validation | 92 | 100% |

---

## Appendix C: Glossary

**Agent**: An autonomous software entity capable of taking actions on behalf of a principal.

**Alignment Card**: A structured declaration of an agent's alignment posture, shared by AAP and AIP.

**AP-Trace**: An audit log entry recording an agent's decision process (AAP).

**Autonomy Envelope**: The set of actions an agent may take without escalation, and the conditions that trigger escalation.

**Braid**: Structured interchange format for dialogue across difference.

**Conscience Prompt**: The analysis prompt sent to the evaluation LLM that instructs it to assess a thinking block against the Alignment Card (AIP).

**Conscience Value**: A typed value declaration (BOUNDARY, FEAR, COMMITMENT, BELIEF, HOPE) that augments Alignment Card evaluation (AIP).

**Daimonion**: The analysis model's role in AIP—a conscience voice that is silent when aligned and speaks when outside boundaries.

**Drift**: Behavioral deviation from declared alignment posture over time (detected by both AAP and AIP at different timescales).

**Escalation**: The process of deferring a decision to a principal or higher-authority agent.

**Integrity Checkpoint**: A structured verdict on an agent's thinking block (AIP).

**Integrity Signal**: The complete payload delivered after an integrity check, containing the checkpoint, proceed recommendation, and window summary (AIP).

**Principal**: The human or organization whose interests the agent serves.

**SSM (Self-Similarity Matrix)**: A computational structure measuring similarity between messages across a conversation.

**Thinking Block**: The internal reasoning content produced by an LLM before or alongside its visible response.

**Value Coherence**: The degree to which two agents' declared values are compatible for coordination.

**Verification**: The process of checking whether observed behavior is consistent with declared alignment (AAP).

---

*This document is released under CC BY 4.0. Copyright 2026 Mnemom LLC.*
