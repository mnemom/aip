# Gateway Integration

Demonstrates deploying AIP as a Cloudflare Worker gateway that sits between your client and the LLM provider, analyzing thinking blocks in real-time before responses reach the client.

## Architecture

```
Client → Gateway Worker → LLM Provider (e.g., Anthropic)
              │
              ├─ Extract thinking block (provider adapter)
              ├─ Run integrity analysis (analysis LLM)
              ├─ Store checkpoint (Supabase)
              └─ Add X-AIP-Verdict header to response
```

## How It Works

1. Client sends a request to the gateway (same API shape as the LLM provider)
2. Gateway forwards the request to the LLM provider with `thinking` enabled
3. Gateway extracts the thinking block using the Anthropic adapter
4. Gateway builds a conscience prompt from the Alignment Card + conscience values
5. Gateway sends the thinking block to a fast analysis LLM (e.g., Haiku)
6. Gateway stores the IntegrityCheckpoint in Supabase
7. Gateway returns the original response with integrity headers:
   - `X-AIP-Verdict`: `clear`, `review_needed`, or `boundary_violation`
   - `X-AIP-Checkpoint`: checkpoint ID for audit trail

## Gateway Worker Skeleton

```typescript
import {
  AnthropicAdapter,
  buildConsciencePrompt,
  checkIntegrity,
  buildSignal,
  hashThinkingBlock,
  summarizeCard,
  type AIPConfig,
} from '@mnemom/agent-integrity-protocol';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // 1. Forward request to Anthropic with thinking enabled
    const anthropicResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        ...await request.json(),
        thinking: { type: 'enabled', budget_tokens: 10000 },
      }),
    });

    const responseBody = await anthropicResponse.json();

    // 2. Extract thinking block
    const adapter = new AnthropicAdapter();
    const thinking = adapter.extractThinking(responseBody);

    if (!thinking) {
      // No thinking block — pass through
      return new Response(JSON.stringify(responseBody), {
        headers: { 'content-type': 'application/json' },
      });
    }

    // 3. Build conscience prompt and analyze
    const cardSummary = summarizeCard(env.ALIGNMENT_CARD);
    const prompt = buildConsciencePrompt({
      card: env.ALIGNMENT_CARD,
      cardSummary,
      thinkingBlock: thinking.content,
      tokenBudget: 1024,
      conscienceValues: env.CONSCIENCE_VALUES,
    });

    // 4. Call analysis LLM (e.g., Haiku)
    const analysisResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1024,
        system: prompt.systemPrompt,
        messages: [{ role: 'user', content: prompt.userMessage }],
      }),
    });

    const analysisText = (await analysisResponse.json()).content[0].text;

    // 5. Parse into checkpoint
    const checkpoint = checkIntegrity({
      analysisResponse: analysisText,
      thinkingBlock: thinking.content,
      card: env.ALIGNMENT_CARD,
      config: { agentId: env.AGENT_ID },
    });

    // 6. Store checkpoint (async, don't block response)
    // ctx.waitUntil(storeCheckpoint(env.SUPABASE, checkpoint));

    // 7. Return response with integrity headers
    return new Response(JSON.stringify(responseBody), {
      headers: {
        'content-type': 'application/json',
        'x-aip-verdict': checkpoint.verdict,
        'x-aip-checkpoint': checkpoint.checkpoint_id,
      },
    });
  },
};
```

## Wrangler Configuration

```toml
name = "aip-gateway"
main = "src/index.ts"
compatibility_date = "2024-09-23"
compatibility_flags = ["nodejs_compat"]

[vars]
AGENT_ID = "my-agent"
```

## Deployment

```bash
# Set secrets
wrangler secret put ANTHROPIC_API_KEY

# Deploy
wrangler deploy
```

## Integration with AAP

When an AAP Observer Worker processes the same request, it finds the AIP checkpoint already stored and links it to the AP-Trace via `linked_trace_id`. This provides both:

- **AIP real-time verdict** (~2s, between turns)
- **AAP post-hoc verification** (~60s, comprehensive audit)

See [Section 12 of the Specification](../../docs/SPEC.md#12-aap-integration-specification) for the full integration protocol.
