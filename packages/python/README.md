# agent-integrity-proto

Python SDK for the Agent Integrity Protocol — real-time thinking block analysis for AI agent alignment.

## Installation

```bash
pip install agent-integrity-proto
```

## Usage

```python
from aip import check_integrity, build_signal, AdapterRegistry

# Extract thinking block from LLM response
registry = AdapterRegistry()
thinking = registry.extract(response, provider="anthropic")

# Run integrity analysis
checkpoint = check_integrity(
    thinking_block=thinking.content,
    card=alignment_card,
    config={
        "agent_id": "my-agent",
        "analysis_llm": {
            "model": "claude-haiku-4-5-20251001",
            "base_url": "https://api.anthropic.com",
            "api_key": os.environ["ANTHROPIC_API_KEY"],
            "max_tokens": 1024,
        },
    },
)

# Act on the verdict
if checkpoint.verdict == "clear":
    proceed()
else:
    escalate(checkpoint.concerns)
```

## API

See the [full documentation](https://github.com/mnemom/aip#readme) and [specification](https://github.com/mnemom/aip/blob/main/docs/SPEC.md).

## Requirements

- Python >= 3.10

## License

Apache 2.0. See [LICENSE](../../LICENSE) for details.
