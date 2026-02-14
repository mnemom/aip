# EU AI Act Article 50 Compliance Example

Demonstrates how to configure AIP with EU compliance presets for fail-closed integrity checking with extended window retention.

## Quick Start

```bash
# Python
cd examples/eu-compliance
python main.py

# TypeScript
npx tsx main.ts
```

## What It Does

This example configures AIP for EU AI Act compliance:

1. **Fail-closed failure policy** using `EU_COMPLIANCE_FAILURE_POLICY` — no agent response passes without integrity analysis
2. **Extended window retention** using `EU_COMPLIANCE_WINDOW_CONFIG` — 2-hour session windows (vs. default 1 hour)
3. **Evaluates thinking blocks** against an Alignment Card using the conscience prompt
4. **Prints an Article 50 compliance summary**

## Article 50 Obligations Satisfied

| Obligation | How This Example Addresses It |
|-----------|------------------------------|
| **50(1)** Inform users of AI interaction | `agent_id` and `card_id` in every IntegrityCheckpoint |
| **50(2)** Machine-readable marking | IntegrityCheckpoint structured JSON with `thinking_block_hash` |
| **50(3)** Transparency of decisions | `reasoning_summary`, `ConscienceContext.values_checked`, `verdict` |
| **50(4)** Audit trail | `WindowConfig` with extended retention, `linked_trace_id` to AAP |

## SDK Compliance Presets Used

```python
from aip import EU_COMPLIANCE_WINDOW_CONFIG, EU_COMPLIANCE_FAILURE_POLICY

# Window: max_size=10, mode="sliding", session_boundary="reset", max_age_seconds=7200
# Failure: mode="fail_closed", analysis_timeout_ms=15000
```

## Files

- `alignment-card.json` — Alignment Card with EU-appropriate values
- `main.py` — Python example using EU presets
- `main.ts` — TypeScript mirror

## Further Reading

- [EU AI Act Compliance Mapping](../../docs/EU_AI_ACT_MAPPING.md)
- [AIP Specification](../../docs/SPEC.md)
- [Article 50 Full Text](https://artificialintelligenceact.eu/article/50/)
