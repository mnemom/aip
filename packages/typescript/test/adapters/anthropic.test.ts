import { describe, it, expect } from "vitest";
import { AnthropicAdapter } from "../../src/adapters/anthropic.js";
import {
  ANTHROPIC_JSON_WITH_THINKING,
  ANTHROPIC_JSON_NO_THINKING,
  ANTHROPIC_JSON_MULTI_THINKING,
  ANTHROPIC_SSE_WITH_THINKING,
} from "../fixtures/responses.js";

describe("AnthropicAdapter", () => {
  const adapter = new AnthropicAdapter();

  describe("extractThinking (JSON)", () => {
    it("extracts thinking from response with thinking block", () => {
      const result = adapter.extractThinking(ANTHROPIC_JSON_WITH_THINKING);

      expect(result).not.toBeNull();
      expect(result!.content).toBe(
        "Let me analyze this request carefully. The user wants help with their code. I should consider the structure of their existing implementation, identify potential issues with the current approach, evaluate alternative design patterns that might be more suitable, and provide clear explanations for each recommendation. Let me also check whether there are any edge cases that need to be handled and ensure the solution follows established best practices for maintainability and performance."
      );
    });

    it("returns null from response without thinking blocks", () => {
      const result = adapter.extractThinking(ANTHROPIC_JSON_NO_THINKING);

      expect(result).toBeNull();
    });

    it("returns null for invalid JSON", () => {
      const result = adapter.extractThinking("not valid json {{{");

      expect(result).toBeNull();
    });

    it("returns null for empty string input", () => {
      const result = adapter.extractThinking("");

      expect(result).toBeNull();
    });

    it("has correct provider", () => {
      const result = adapter.extractThinking(ANTHROPIC_JSON_WITH_THINKING);

      expect(result).not.toBeNull();
      expect(result!.provider).toBe("anthropic");
    });

    it("has correct extraction_method", () => {
      const result = adapter.extractThinking(ANTHROPIC_JSON_WITH_THINKING);

      expect(result).not.toBeNull();
      expect(result!.extraction_method).toBe("native_thinking");
    });

    it("has correct confidence of 1.0", () => {
      const result = adapter.extractThinking(ANTHROPIC_JSON_WITH_THINKING);

      expect(result).not.toBeNull();
      expect(result!.confidence).toBe(1.0);
    });

    it("extracts model from response", () => {
      const result = adapter.extractThinking(ANTHROPIC_JSON_WITH_THINKING);

      expect(result).not.toBeNull();
      expect(result!.model).toBe("claude-sonnet-4-5-20250514");
    });

    it("concatenates multiple thinking blocks with separator", () => {
      const result = adapter.extractThinking(ANTHROPIC_JSON_MULTI_THINKING);

      expect(result).not.toBeNull();
      expect(result!.content).toBe(
        "First, let me understand the problem. The user is dealing with a complex data transformation pipeline that needs to handle multiple input formats while maintaining backward compatibility. I need to consider the tradeoffs between a unified adapter pattern versus format-specific handlers, examine how errors should propagate through the pipeline, and assess whether the current architecture supports the required throughput.\n\n---\n\nNow let me evaluate the second approach. The adapter pattern offers better extensibility since new formats can be added without modifying existing code. However, the format-specific handler approach provides better performance because it avoids the overhead of abstraction layers. Given the user's requirements for both extensibility and performance, a hybrid approach using lazy-loaded adapters with format detection at the entry point would be optimal."
      );
    });

    it("truncated is false for normal extraction", () => {
      const result = adapter.extractThinking(ANTHROPIC_JSON_WITH_THINKING);

      expect(result).not.toBeNull();
      expect(result!.truncated).toBe(false);
    });

    it("returns null when content array is empty", () => {
      const body = JSON.stringify({
        id: "msg_test_empty",
        type: "message",
        role: "assistant",
        model: "claude-sonnet-4-5-20250514",
        content: [],
        stop_reason: "end_turn",
        usage: { input_tokens: 10, output_tokens: 0 },
      });

      const result = adapter.extractThinking(body);

      expect(result).toBeNull();
    });

    it("returns null when content array has only text blocks", () => {
      const body = JSON.stringify({
        id: "msg_test_textonly",
        type: "message",
        role: "assistant",
        model: "claude-sonnet-4-5-20250514",
        content: [
          { type: "text", text: "First paragraph." },
          { type: "text", text: "Second paragraph." },
        ],
        stop_reason: "end_turn",
        usage: { input_tokens: 50, output_tokens: 30 },
      });

      const result = adapter.extractThinking(body);

      expect(result).toBeNull();
    });
  });

  describe("extractThinkingFromStream (SSE)", () => {
    it("extracts thinking from SSE stream", () => {
      const result = adapter.extractThinkingFromStream(ANTHROPIC_SSE_WITH_THINKING);

      expect(result).not.toBeNull();
      expect(result!.content).toBe("Let me analyze this.");
    });

    it("extracts model from message_start event", () => {
      const result = adapter.extractThinkingFromStream(ANTHROPIC_SSE_WITH_THINKING);

      expect(result).not.toBeNull();
      expect(result!.model).toBe("claude-sonnet-4-5-20250514");
    });

    it("returns null for SSE with no thinking blocks", () => {
      const sseBody = [
        'data: {"type":"message_start","message":{"id":"msg_test_005","type":"message","role":"assistant","model":"claude-sonnet-4-5-20250514","content":[],"stop_reason":null,"usage":{"input_tokens":50,"output_tokens":0}}}',
        'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}',
        'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello there."}}',
        'data: {"type":"content_block_stop","index":0}',
        'data: {"type":"message_stop"}',
      ].join("\n");

      const result = adapter.extractThinkingFromStream(sseBody);

      expect(result).toBeNull();
    });

    it("returns null for empty SSE body", () => {
      const result = adapter.extractThinkingFromStream("");

      expect(result).toBeNull();
    });

    it("handles malformed data lines gracefully", () => {
      const sseBody = [
        "data: not-valid-json",
        "data: {broken",
        'data: {"type":"message_start","message":{"id":"msg_test_006","type":"message","role":"assistant","model":"claude-sonnet-4-5-20250514","content":[],"stop_reason":null,"usage":{"input_tokens":10,"output_tokens":0}}}',
        "event: some_event",
        ": comment line",
        "",
        'data: {"type":"message_stop"}',
      ].join("\n");

      const result = adapter.extractThinkingFromStream(sseBody);

      // No thinking blocks were present, so should return null
      // The important thing is that it doesn't throw
      expect(result).toBeNull();
    });

    it("has correct provider, extraction_method, and confidence on SSE result", () => {
      const result = adapter.extractThinkingFromStream(ANTHROPIC_SSE_WITH_THINKING);

      expect(result).not.toBeNull();
      expect(result!.provider).toBe("anthropic");
      expect(result!.extraction_method).toBe("native_thinking");
      expect(result!.confidence).toBe(1.0);
    });
  });
});
