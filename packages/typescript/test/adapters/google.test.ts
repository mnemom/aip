import { describe, it, expect } from "vitest";
import { GoogleAdapter } from "../../src/adapters/google.js";
import { GOOGLE_JSON_WITH_THINKING, GOOGLE_JSON_NO_THINKING } from "../fixtures/responses.js";

describe("GoogleAdapter", () => {
  const adapter = new GoogleAdapter();

  describe("extractThinking", () => {
    it("returns ExtractedThinking from Gemini response with thought:true parts", () => {
      const result = adapter.extractThinking(GOOGLE_JSON_WITH_THINKING);

      expect(result).not.toBeNull();
      expect(result!.content).toBe("Let me consider this carefully.");
    });

    it("returns null from response without thinking parts", () => {
      const result = adapter.extractThinking(GOOGLE_JSON_NO_THINKING);

      expect(result).toBeNull();
    });

    it("returns null for invalid JSON", () => {
      const result = adapter.extractThinking("not valid json {{{");

      expect(result).toBeNull();
    });

    it("has correct provider, extraction_method, and confidence", () => {
      const result = adapter.extractThinking(GOOGLE_JSON_WITH_THINKING);

      expect(result).not.toBeNull();
      expect(result!.provider).toBe("google");
      expect(result!.extraction_method).toBe("native_thinking");
      expect(result!.confidence).toBe(0.9);
    });

    it("handles multiple thought parts concatenated with separator", () => {
      const multiThinkingResponse = JSON.stringify({
        candidates: [{
          content: {
            parts: [
              { text: "First thinking step.", thought: true },
              { text: "Here is a normal response." },
              { text: "Second thinking step.", thought: true },
            ],
            role: "model",
          },
          finishReason: "STOP",
        }],
        modelVersion: "gemini-2.0-flash-thinking-exp",
      });

      const result = adapter.extractThinking(multiThinkingResponse);

      expect(result).not.toBeNull();
      expect(result!.content).toBe("First thinking step.\n\n---\n\nSecond thinking step.");
      expect(result!.model).toBe("gemini-2.0-flash-thinking-exp");
    });
  });

  describe("extractThinkingFromStream", () => {
    it("extracts thinking from SSE stream", () => {
      const sseBody = [
        'data: {"candidates":[{"content":{"parts":[{"text":"Let me think about this.","thought":true}],"role":"model"}}],"modelVersion":"gemini-2.0-flash-thinking-exp"}',
        'data: {"candidates":[{"content":{"parts":[{"text":"Here is my answer."}],"role":"model"}}],"modelVersion":"gemini-2.0-flash-thinking-exp"}',
      ].join("\n");

      const result = adapter.extractThinkingFromStream(sseBody);

      expect(result).not.toBeNull();
      expect(result!.content).toBe("Let me think about this.");
      expect(result!.provider).toBe("google");
      expect(result!.model).toBe("gemini-2.0-flash-thinking-exp");
      expect(result!.extraction_method).toBe("native_thinking");
      expect(result!.confidence).toBe(0.9);
    });

    it("returns null when no thinking in stream", () => {
      const sseBody = [
        'data: {"candidates":[{"content":{"parts":[{"text":"Just a normal response."}],"role":"model"}}],"modelVersion":"gemini-2.0-flash"}',
      ].join("\n");

      const result = adapter.extractThinkingFromStream(sseBody);

      expect(result).toBeNull();
    });
  });
});
