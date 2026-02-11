# @mnemom/agent-integrity-protocol

TypeScript SDK for the Agent Integrity Protocol — real-time thinking block analysis for AI agent alignment.

## Installation

```bash
npm install @mnemom/agent-integrity-protocol
```

## Usage

```typescript
import {
  checkIntegrity,
  buildSignal,
  AnthropicAdapter,
  WindowManager,
} from '@mnemom/agent-integrity-protocol';

// Extract thinking block from LLM response
const adapter = new AnthropicAdapter();
const thinking = adapter.extract(response);

// Run integrity analysis
const checkpoint = await checkIntegrity({
  thinkingBlock: thinking.content,
  card: alignmentCard,
  config: {
    agentId: 'my-agent',
    analysisLlm: {
      model: 'claude-haiku-4-5-20251001',
      baseUrl: 'https://api.anthropic.com',
      apiKey: process.env.ANTHROPIC_API_KEY,
      maxTokens: 1024,
    },
  },
});

// Act on the verdict
if (checkpoint.verdict === 'clear') {
  proceed();
} else {
  escalate(checkpoint.concerns);
}
```

## API

See the [full documentation](https://github.com/mnemom/aip#readme) and [specification](https://github.com/mnemom/aip/blob/main/docs/SPEC.md).

## Requirements

- Node.js >= 18.0.0

## License

Apache 2.0. See [LICENSE](LICENSE) for details.
