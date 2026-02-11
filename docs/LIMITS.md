# AIP Limitations

**Version:** 0.1.0
**Date:** 2026-02-10

This document describes what AIP does and does not do. Read it before depending on AIP for anything consequential.

---

## Five Fundamental Limitations

### 1. Detects Injection, Does Not Prevent It

AIP analyzes thinking blocks *after* the agent has already processed the injected content. The injection has occurred. AIP detects its effects on reasoning. By the time AIP raises a `boundary_violation`, the agent has already thought the problematic thoughts — AIP prevents the *action*, not the *reasoning*.

**Implication:** AIP is an intervention layer between thinking and acting. It cannot protect against attacks that succeed entirely within the thinking phase (e.g., information leaking through the thinking block itself to a monitoring adversary).

### 2. Analysis Quality Bounded by Analysis Model

AIP uses an LLM to evaluate another LLM's thinking. This means:

- **Detection accuracy is bounded by the analysis model's capability.** A smaller, cheaper analysis model (e.g., Haiku) will miss subtleties that a larger model would catch.
- **The analysis model can be fooled.** Sophisticated adversarial content can manipulate the analysis LLM into returning false `clear` verdicts (meta-injection).
- **No formal verification.** AIP provides probabilistic detection, not mathematical proof of alignment.

**Implication:** AIP is a practical defense that raises the bar for adversaries. It is not a theoretical guarantee. The analysis model is a best-effort evaluator, not an oracle.

### 3. Thinking Blocks May Not Be Complete

LLM providers may truncate, filter, or summarize thinking blocks before exposing them. AIP can only analyze what is provided.

- **Anthropic:** Full thinking blocks with high fidelity (extraction confidence 1.0)
- **OpenAI:** `reasoning_content` field (extraction confidence 0.9)
- **Google:** Gemini thinking blocks (extraction confidence 0.9)
- **Fallback:** Regex-based extraction from response text (extraction confidence 0.3)
- **No thinking:** Some models don't expose thinking at all. AIP cannot analyze what doesn't exist.

**Implication:** AIP's coverage depends entirely on the provider's willingness to expose thinking. A model with opaque reasoning is invisible to AIP.

### 4. Timing is Not Free

AIP adds latency between agent turns. The analysis LLM call typically takes 1-3 seconds. During this time, the agent is waiting.

- If the agent acts before analysis completes (in async architectures), the integrity check is retroactive, not preventive.
- If the agent waits for analysis, every turn is 1-3 seconds slower.

**Implication:** AIP requires explicit architectural coordination to be preventive. In a gateway deployment, the gateway holds the response until analysis completes. In an SDK deployment, the caller must await the signal before proceeding.

### 5. Conscience Values Are Advisory

Conscience values increase detection sensitivity but AIP cannot enforce them. An agent system without AIP integration proceeds regardless of what AIP would have detected. AIP has no enforcement mechanism of its own — it relies on the host system to act on signals.

**Implication:** AIP is only as effective as the host system's willingness to respect its verdicts. A host that ignores `boundary_violation` signals gets no benefit.

---

## What AIP Actually Provides

Despite its limitations, AIP provides concrete value:

1. **Early warning.** Detection of misalignment *between* turns rather than *after* actions, reducing the window of vulnerability from 30-60 seconds (AAP) to ~2 seconds (AIP).

2. **Structured analysis.** Integrity checkpoints provide machine-readable verdicts, concern categories, severity levels, and evidence — not just a binary pass/fail.

3. **Session context.** Window-based state tracking detects patterns invisible in single-turn analysis (gradual drift, escalating autonomy).

4. **Provider abstraction.** A single analysis interface across Anthropic, OpenAI, Google, and custom providers.

5. **AAP integration.** Checkpoints link to AP-Traces, enriching the post-hoc audit trail with real-time analysis data.

---

## Common Misconceptions

### "AIP-checked means safe"

No. AIP-checked means the analysis model found no concerns in the thinking block it was given. The thinking block may have been incomplete, the analysis model may have been fooled, or the concern may manifest in ways invisible to thinking block analysis.

### "A `clear` verdict is a guarantee"

No. `clear` means the daimonion is silent — not that alignment is certain. The daimonion's silence may reflect genuine alignment, or it may reflect a limitation of the analysis.

### "AIP replaces human oversight"

No. AIP is a monitoring layer, not a decision-maker. Boundary violations and drift alerts SHOULD trigger human review. AIP reduces the volume of what humans need to review, not the need for review itself.

### "More conscience values means better detection"

Not necessarily. Excessive or contradictory conscience values can dilute the analysis prompt, leading to more false positives and lower detection quality. Use targeted values for specific, real concerns.

---

## Appropriate Use Cases

- **Gateway-level monitoring** — Analyzing thinking blocks in a proxy between client and LLM
- **Agent framework integration** — Adding integrity checks between agent tool calls
- **Compliance monitoring** — Structured evidence for alignment claims
- **Development testing** — Testing agent behavior against adversarial inputs
- **Defense in depth** — One layer alongside AAP, human oversight, and runtime monitoring

## Inappropriate Use Cases

- **Safety certification** — AIP cannot certify an agent as safe
- **Replacing human oversight** — AIP augments, does not replace
- **Adversarial guarantees** — A sophisticated adversary can bypass AIP
- **Non-thinking-block models** — Models that don't expose thinking cannot be analyzed
- **Standalone security** — AIP without other security layers provides incomplete protection

---

## The Detection-Prevention Distinction

AIP detects misalignment in thinking. It does not prevent misalignment from occurring.

This is analogous to a smoke detector vs. a fire suppression system. AIP is the smoke detector: it alerts you to a problem so you can take action. The fire suppression system — blocking the action, escalating to a human, shutting down the agent — is the host system's responsibility.

AIP makes this explicit in the signal contract: the signal contains a `proceed` boolean and a `recommended_action`, but the host system decides what to do. AIP never takes action on its own.

---

See also: [Section 14 of the Specification](SPEC.md#14-limitations)
