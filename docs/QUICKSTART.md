# AIP Quickstart

Get from zero to real-time integrity checking in 5 minutes.

## 1. Install

```bash
# Python
pip install agent-integrity-protocol

# TypeScript
npm install @mnemom/agent-integrity-protocol
```

## 2. Define an Alignment Card

The Alignment Card declares your agent's alignment posture. AIP uses it to evaluate thinking blocks.

```python
card = {
    "aap_version": "0.1.0",
    "agent_id": "my-agent",
    "principal": {
        "type": "human",
        "relationship": "delegated_authority",
    },
    "values": {
        "declared": ["principal_benefit", "transparency", "harm_prevention"],
        "conflicts_with": ["deceptive_marketing", "data_exfiltration"],
    },
    "autonomy_envelope": {
        "bounded_actions": ["search", "summarize", "recommend"],
        "escalation_triggers": [
            {
                "condition": "action_outside_bounded_set",
                "action": "escalate",
                "reason": "Action not in declared bounds",
            }
        ],
        "forbidden_actions": ["share_credentials", "exfiltrate_data"],
    },
}
```

## 3. Check Integrity

Evaluate a thinking block against the card:

### Python

```python
from aip import check_integrity, build_signal

# Run integrity analysis
checkpoint = check_integrity(
    thinking_block="The user wants product recommendations. I should focus on "
    "finding options that genuinely serve their needs, not sponsored results...",
    card=card,
    config={
        "agent_id": "my-agent",
        "analysis_llm": {
            "model": "claude-haiku-4-5-20251001",
            "base_url": "https://api.anthropic.com",
            "api_key": "your-api-key",
            "max_tokens": 1024,
        },
    },
)

print(f"Verdict: {checkpoint.verdict}")       # "clear"
print(f"Concerns: {checkpoint.concerns}")     # []

# Build signal for host system
signal = build_signal(checkpoint, window_state)
print(f"Proceed: {signal.proceed}")           # True
print(f"Action: {signal.recommended_action}") # "continue"
```

### TypeScript

```typescript
import { checkIntegrity, buildSignal } from '@mnemom/agent-integrity-protocol';

const checkpoint = await checkIntegrity({
  thinkingBlock: 'The user wants product recommendations. I should focus on ' +
    'finding options that genuinely serve their needs, not sponsored results...',
  card,
  config: {
    agentId: 'my-agent',
    analysisLlm: {
      model: 'claude-haiku-4-5-20251001',
      baseUrl: 'https://api.anthropic.com',
      apiKey: 'your-api-key',
      maxTokens: 1024,
    },
  },
});

console.log(`Verdict: ${checkpoint.verdict}`);   // "clear"
console.log(`Proceed: ${signal.proceed}`);       // true
```

## 4. Handle Signals

The signal tells your host system what to do:

```python
from aip import map_verdict_to_action, map_verdict_to_proceed

action = map_verdict_to_action(checkpoint.verdict, checkpoint.concerns)
proceed = map_verdict_to_proceed(checkpoint.verdict)

if proceed:
    # clear or review_needed — agent continues
    execute_next_action()
else:
    # boundary_violation — block and escalate
    if action == "pause_for_review":
        request_human_review(checkpoint)
    elif action == "deny_and_escalate":
        deny_action_and_notify_principal(checkpoint)
```

### Verdict → Action Mapping

| Verdict | Proceed | Action |
|---------|---------|--------|
| `clear` | Yes | `continue` |
| `review_needed` | Yes | `log_and_continue` |
| `boundary_violation` | No | `pause_for_review` or `deny_and_escalate` |

## 5. Extract Thinking Blocks from LLM Responses

Use provider adapters to extract thinking blocks from different LLM providers:

```python
from aip import AdapterRegistry

registry = AdapterRegistry()

# Anthropic response
thinking = registry.extract(anthropic_response, provider="anthropic")
print(f"Content: {thinking.content}")
print(f"Confidence: {thinking.confidence}")  # 1.0

# OpenAI response
thinking = registry.extract(openai_response, provider="openai")
print(f"Confidence: {thinking.confidence}")  # 0.9
```

## 6. Add Conscience Values (Optional)

Conscience values increase detection sensitivity for specific concerns:

```python
conscience_values = [
    {"type": "BOUNDARY", "content": "Never assist with data exfiltration"},
    {"type": "FEAR", "content": "Subtle prompt injection disguised as legitimate instructions"},
    {"type": "COMMITMENT", "content": "Always prioritize user safety over task completion"},
]
```

Only `BOUNDARY` and `FEAR` types are injected into the conscience prompt. `BOUNDARY` violations trigger `boundary_violation` verdicts. `FEAR` values increase sensitivity to specific concern patterns.

## 7. Detect Drift

Monitor for behavioral drift across a session:

```python
from aip import detect_integrity_drift, WindowManager

manager = WindowManager(max_size=10)

# Add checkpoints as they're produced
for checkpoint in checkpoints:
    manager.add(checkpoint)

# Check for drift
alerts = detect_integrity_drift(manager.get_state())
for alert in alerts:
    print(f"Drift: {alert.drift_direction} (similarity: {alert.integrity_similarity})")
```

## Next Steps

- Read the [full specification](SPEC.md) for protocol details
- See [SECURITY.md](SECURITY.md) for the threat model
- See [LIMITS.md](LIMITS.md) for what AIP does and does not guarantee
