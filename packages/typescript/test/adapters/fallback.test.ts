import { describe, it, expect } from "vitest";
import { FallbackAdapter } from "../../src/adapters/fallback.js";
import { CONFIDENCE_FALLBACK } from "../../src/constants.js";

describe("FallbackAdapter", () => {
  const adapter = new FallbackAdapter();

  it("has correct provider name", () => {
    expect(adapter.provider).toBe("fallback");
  });

  describe("extractThinking", () => {
    it("extracts reasoning patterns from plain text response", () => {
      const text =
        "I need to analyze this problem carefully. Let me break it down. The answer is 42.";
      const result = adapter.extractThinking(text);

      expect(result).not.toBeNull();
      expect(result!.content).toContain("I need to analyze this problem carefully.");
      expect(result!.content).toContain("Let me break it down.");
      expect(result!.extraction_method).toBe("response_analysis");
      expect(result!.confidence).toBe(CONFIDENCE_FALLBACK);
      expect(result!.confidence).toBe(0.3);
      expect(result!.provider).toBe("fallback");
    });

    it("returns null when no reasoning patterns found", () => {
      const text = "Hello, how can I help?";
      const result = adapter.extractThinking(JSON.stringify(text));

      expect(result).toBeNull();
    });

    it("handles Anthropic-like JSON structure", () => {
      const body = JSON.stringify({
        content: [
          {
            type: "text",
            text: "I think this is a good approach. However, we should also consider alternatives.",
          },
        ],
        model: "some-model",
      });

      const result = adapter.extractThinking(body);

      expect(result).not.toBeNull();
      expect(result!.content).toContain("I think");
      expect(result!.content).toContain("However");
      expect(result!.extraction_method).toBe("response_analysis");
      expect(result!.confidence).toBe(CONFIDENCE_FALLBACK);
    });

    it("handles OpenAI-like JSON structure", () => {
      const body = JSON.stringify({
        choices: [
          {
            message: {
              content:
                "I should consider multiple options. First, I'll look at the data. Alternatively, we could try a different method.",
            },
          },
        ],
        model: "gpt-4",
      });

      const result = adapter.extractThinking(body);

      expect(result).not.toBeNull();
      expect(result!.content).toContain("I should");
      expect(result!.extraction_method).toBe("response_analysis");
      expect(result!.confidence).toBe(CONFIDENCE_FALLBACK);
    });

    it("returns null for completely empty content", () => {
      const emptyBodies = [
        "",
        JSON.stringify({ content: [] }),
        JSON.stringify({ choices: [{ message: { content: "" } }] }),
      ];

      for (const body of emptyBodies) {
        const result = adapter.extractThinking(body);
        expect(result).toBeNull();
      }
    });

    it("has correct extraction_method and confidence", () => {
      const text = "Let me think about this. I need to consider the edge cases.";
      const result = adapter.extractThinking(text);

      expect(result).not.toBeNull();
      expect(result!.extraction_method).toBe("response_analysis");
      expect(result!.confidence).toBe(0.3);
      expect(result!.truncated).toBe(false);
      expect(result!.model).toBe("unknown");
    });
  });

  describe("extractThinkingFromStream", () => {
    it("extracts reasoning from accumulated stream text", () => {
      const sse = [
        'data: {"choices":[{"delta":{"content":"I need to "}}]}',
        'data: {"choices":[{"delta":{"content":"analyze this carefully. "}}]}',
        'data: {"choices":[{"delta":{"content":"The result is 42."}}]}',
        "data: [DONE]",
      ].join("\n");

      const result = adapter.extractThinkingFromStream(sse);

      expect(result).not.toBeNull();
      expect(result!.content).toContain("I need to analyze this carefully.");
      expect(result!.extraction_method).toBe("response_analysis");
      expect(result!.confidence).toBe(CONFIDENCE_FALLBACK);
    });

    it("returns null when stream has no reasoning patterns", () => {
      const sse = [
        'data: {"choices":[{"delta":{"content":"Hello! "}}]}',
        'data: {"choices":[{"delta":{"content":"How can I help you today?"}}]}',
        "data: [DONE]",
      ].join("\n");

      const result = adapter.extractThinkingFromStream(sse);

      expect(result).toBeNull();
    });
  });
});
