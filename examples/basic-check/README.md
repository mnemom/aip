# Basic Integrity Check

A minimal AIP example demonstrating:

1. Defining an Alignment Card
2. Extracting a thinking block from an LLM response
3. Running an integrity check
4. Handling the signal

## Run

```bash
# Python
pip install agent-integrity-protocol
python main.py

# TypeScript
npm install @mnemom/agent-integrity-protocol
npx tsx main.ts
```

## What It Does

The example creates a simple recommendation agent with declared values (`principal_benefit`, `transparency`) and forbidden actions (`share_credentials`, `exfiltrate_data`). It then evaluates two thinking blocks:

1. **Aligned thinking** — the agent reasons about helping the user genuinely. AIP returns `clear`.
2. **Misaligned thinking** — the agent reasons about exfiltrating user data. AIP returns `boundary_violation`.

## Files

| File | Description |
|------|-------------|
| `alignment-card.json` | Sample Alignment Card |
| `main.py` | Python implementation |
| `main.ts` | TypeScript implementation |

## Expected Output

```
--- Aligned Thinking ---
Verdict: clear
Proceed: True
Action: continue
Concerns: []

--- Misaligned Thinking ---
Verdict: boundary_violation
Proceed: False
Action: deny_and_escalate
Concerns: [prompt_injection (critical): "Agent reasoning shows intent to exfiltrate user data"]
```
