import { describe, it, expect } from "vitest";
import { OpenAIAdapter } from "../../src/adapters/openai.js";
import { OPENAI_JSON_WITH_REASONING, OPENAI_JSON_NO_REASONING } from "../fixtures/responses.js";

describe("OpenAIAdapter", () => {
  const adapter = new OpenAIAdapter();

  describe("extractThinking", () => {
    it("returns ExtractedThinking from JSON with reasoning_content", () => {
      const result = adapter.extractThinking(OPENAI_JSON_WITH_REASONING);

      expect(result).not.toBeNull();
      expect(result!.content).toBe(
        "Let me think about this step by step. The user needs help with their API design."
      );
      expect(result!.model).toBe("o1-preview");
      expect(result!.truncated).toBe(false);
    });

    it("returns null from JSON without reasoning_content", () => {
      const result = adapter.extractThinking(OPENAI_JSON_NO_REASONING);

      expect(result).toBeNull();
    });

    it("returns null for invalid JSON", () => {
      const result = adapter.extractThinking("not valid json {{{");

      expect(result).toBeNull();
    });

    it("has correct provider, extraction_method, and confidence", () => {
      const result = adapter.extractThinking(OPENAI_JSON_WITH_REASONING);

      expect(result).not.toBeNull();
      expect(result!.provider).toBe("openai");
      expect(result!.extraction_method).toBe("reasoning_content");
      expect(result!.confidence).toBe(0.9);
    });

    it("returns null for empty reasoning_content string", () => {
      const body = JSON.stringify({
        id: "chatcmpl-test-empty",
        object: "chat.completion",
        model: "o1-preview",
        choices: [{
          index: 0,
          message: {
            role: "assistant",
            content: "Response.",
            reasoning_content: ""
          },
          finish_reason: "stop"
        }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }
      });

      const result = adapter.extractThinking(body);

      expect(result).toBeNull();
    });
  });

  describe("extractThinkingFromStream", () => {
    it("accumulates reasoning deltas from SSE", () => {
      const sseBody = [
        'data: {"id":"chatcmpl-stream-001","object":"chat.completion.chunk","model":"o1-preview","choices":[{"index":0,"delta":{"role":"assistant","reasoning_content":"Let me "},"finish_reason":null}]}',
        'data: {"id":"chatcmpl-stream-001","object":"chat.completion.chunk","model":"o1-preview","choices":[{"index":0,"delta":{"reasoning_content":"think about "},"finish_reason":null}]}',
        'data: {"id":"chatcmpl-stream-001","object":"chat.completion.chunk","model":"o1-preview","choices":[{"index":0,"delta":{"reasoning_content":"this carefully."},"finish_reason":null}]}',
        'data: {"id":"chatcmpl-stream-001","object":"chat.completion.chunk","model":"o1-preview","choices":[{"index":0,"delta":{"content":"Here is my answer."},"finish_reason":null}]}',
        'data: {"id":"chatcmpl-stream-001","object":"chat.completion.chunk","model":"o1-preview","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}',
        'data: [DONE]',
      ].join("\n");

      const result = adapter.extractThinkingFromStream(sseBody);

      expect(result).not.toBeNull();
      expect(result!.content).toBe("Let me think about this carefully.");
      expect(result!.provider).toBe("openai");
      expect(result!.model).toBe("o1-preview");
      expect(result!.extraction_method).toBe("reasoning_content");
      expect(result!.confidence).toBe(0.9);
      expect(result!.truncated).toBe(false);
    });

    it("returns null when no reasoning in stream", () => {
      const sseBody = [
        'data: {"id":"chatcmpl-stream-002","object":"chat.completion.chunk","model":"gpt-4","choices":[{"index":0,"delta":{"role":"assistant","content":"Hello "},"finish_reason":null}]}',
        'data: {"id":"chatcmpl-stream-002","object":"chat.completion.chunk","model":"gpt-4","choices":[{"index":0,"delta":{"content":"world."},"finish_reason":null}]}',
        'data: {"id":"chatcmpl-stream-002","object":"chat.completion.chunk","model":"gpt-4","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}',
        'data: [DONE]',
      ].join("\n");

      const result = adapter.extractThinkingFromStream(sseBody);

      expect(result).toBeNull();
    });
  });
});
