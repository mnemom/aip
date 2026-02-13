/**
 * Sample provider response fixtures for testing.
 *
 * Provides JSON and SSE response bodies from Anthropic, OpenAI,
 * and Google Gemini for use in adapter tests.
 */

/** Anthropic response with thinking block (JSON) */
export const ANTHROPIC_JSON_WITH_THINKING = JSON.stringify({
  id: "msg_test_001",
  type: "message",
  role: "assistant",
  model: "claude-sonnet-4-5-20250514",
  content: [
    { type: "thinking", thinking: "Let me analyze this request carefully. The user wants help with their code. I should consider the structure of their existing implementation, identify potential issues with the current approach, evaluate alternative design patterns that might be more suitable, and provide clear explanations for each recommendation. Let me also check whether there are any edge cases that need to be handled and ensure the solution follows established best practices for maintainability and performance." },
    { type: "text", text: "I'd be happy to help with your code!" }
  ],
  stop_reason: "end_turn",
  usage: { input_tokens: 100, output_tokens: 50 }
});

/** Anthropic response without thinking (JSON) */
export const ANTHROPIC_JSON_NO_THINKING = JSON.stringify({
  id: "msg_test_002",
  type: "message",
  role: "assistant",
  model: "claude-sonnet-4-5-20250514",
  content: [
    { type: "text", text: "Here is your answer." }
  ],
  stop_reason: "end_turn",
  usage: { input_tokens: 50, output_tokens: 20 }
});

/** Anthropic response with multiple thinking blocks (JSON) */
export const ANTHROPIC_JSON_MULTI_THINKING = JSON.stringify({
  id: "msg_test_003",
  type: "message",
  role: "assistant",
  model: "claude-sonnet-4-5-20250514",
  content: [
    { type: "thinking", thinking: "First, let me understand the problem. The user is dealing with a complex data transformation pipeline that needs to handle multiple input formats while maintaining backward compatibility. I need to consider the tradeoffs between a unified adapter pattern versus format-specific handlers, examine how errors should propagate through the pipeline, and assess whether the current architecture supports the required throughput." },
    { type: "text", text: "I see two approaches." },
    { type: "thinking", thinking: "Now let me evaluate the second approach. The adapter pattern offers better extensibility since new formats can be added without modifying existing code. However, the format-specific handler approach provides better performance because it avoids the overhead of abstraction layers. Given the user's requirements for both extensibility and performance, a hybrid approach using lazy-loaded adapters with format detection at the entry point would be optimal." },
    { type: "text", text: "Here is my recommendation." }
  ],
  stop_reason: "end_turn",
  usage: { input_tokens: 150, output_tokens: 80 }
});

/** Anthropic SSE stream with thinking */
export const ANTHROPIC_SSE_WITH_THINKING = [
  'data: {"type":"message_start","message":{"id":"msg_test_004","type":"message","role":"assistant","model":"claude-sonnet-4-5-20250514","content":[],"stop_reason":null,"usage":{"input_tokens":100,"output_tokens":0}}}',
  'data: {"type":"content_block_start","index":0,"content_block":{"type":"thinking","thinking":""}}',
  'data: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"Let me "}}',
  'data: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"analyze this."}}',
  'data: {"type":"content_block_stop","index":0}',
  'data: {"type":"content_block_start","index":1,"content_block":{"type":"text","text":""}}',
  'data: {"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":"Here is my response."}}',
  'data: {"type":"content_block_stop","index":1}',
  'data: {"type":"message_stop"}',
].join('\n');

/** OpenAI response with reasoning_content */
export const OPENAI_JSON_WITH_REASONING = JSON.stringify({
  id: "chatcmpl-test-001",
  object: "chat.completion",
  model: "o1-preview",
  choices: [{
    index: 0,
    message: {
      role: "assistant",
      content: "Here is my response.",
      reasoning_content: "Let me think about this step by step. The user needs help with their API design. I should consider RESTful principles, proper resource naming conventions, authentication and authorization patterns, rate limiting strategies, versioning approaches, and error handling standards. The API should support pagination for list endpoints, filtering for search operations, and proper HTTP status codes for different response scenarios. Let me also evaluate whether GraphQL might be a better fit for their use case."
    },
    finish_reason: "stop"
  }],
  usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 }
});

/** OpenAI response without reasoning */
export const OPENAI_JSON_NO_REASONING = JSON.stringify({
  id: "chatcmpl-test-002",
  object: "chat.completion",
  model: "gpt-4",
  choices: [{
    index: 0,
    message: {
      role: "assistant",
      content: "Here is my response."
    },
    finish_reason: "stop"
  }],
  usage: { prompt_tokens: 50, completion_tokens: 20, total_tokens: 70 }
});

/** Google Gemini response with thinking */
export const GOOGLE_JSON_WITH_THINKING = JSON.stringify({
  candidates: [{
    content: {
      parts: [
        { text: "Let me consider this carefully. The request involves analyzing a complex system with multiple interconnected components. I need to evaluate the dependencies between services, assess the impact of proposed changes on downstream consumers, and identify potential failure modes. The architecture uses event-driven communication patterns which adds complexity to the analysis but also provides natural boundaries for isolating changes. I should also consider the testing strategy.", thought: true },
        { text: "Here is my response." }
      ],
      role: "model"
    },
    finishReason: "STOP"
  }],
  modelVersion: "gemini-2.0-flash-thinking-exp"
});

/** Google Gemini response without thinking */
export const GOOGLE_JSON_NO_THINKING = JSON.stringify({
  candidates: [{
    content: {
      parts: [
        { text: "Here is my response." }
      ],
      role: "model"
    },
    finishReason: "STOP"
  }],
  modelVersion: "gemini-2.0-flash"
});
