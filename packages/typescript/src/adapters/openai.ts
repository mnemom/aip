import type { ExtractedThinking, ProviderAdapter } from "./types.js";
import { CONFIDENCE_EXPLICIT } from "../constants.js";

/**
 * OpenAI provider adapter.
 *
 * Extracts reasoning content from OpenAI API responses (e.g. o1-preview).
 * Uses `reasoning_content` field on messages and deltas, with confidence
 * level CONFIDENCE_EXPLICIT (0.9) since reasoning is explicitly surfaced
 * but not via a native thinking block.
 */
export class OpenAIAdapter implements ProviderAdapter {
  readonly provider = "openai";

  /**
   * Extract thinking content from a non-streaming OpenAI response body.
   *
   * Looks for `choices[0].message.reasoning_content` and returns it
   * as extracted thinking if present and non-empty.
   */
  extractThinking(responseBody: string): ExtractedThinking | null {
    let parsed: unknown;
    try {
      parsed = JSON.parse(responseBody);
    } catch {
      return null;
    }

    if (!isRecord(parsed)) {
      return null;
    }

    const model = typeof parsed["model"] === "string" ? parsed["model"] : "unknown";
    const choices = parsed["choices"];

    if (!Array.isArray(choices) || choices.length === 0) {
      return null;
    }

    const firstChoice: unknown = choices[0];
    if (!isRecord(firstChoice)) {
      return null;
    }

    const message = firstChoice["message"];
    if (!isRecord(message)) {
      return null;
    }

    const reasoningContent = message["reasoning_content"];
    if (typeof reasoningContent !== "string" || reasoningContent.length === 0) {
      return null;
    }

    return {
      content: reasoningContent,
      provider: this.provider,
      model,
      extraction_method: "reasoning_content",
      confidence: CONFIDENCE_EXPLICIT,
      truncated: false,
    };
  }

  /**
   * Extract thinking content from an OpenAI SSE streaming response.
   *
   * Processes Server-Sent Events to accumulate `reasoning_content` deltas
   * from `choices[0].delta.reasoning_content` fields across chunks.
   */
  extractThinkingFromStream(sseBody: string): ExtractedThinking | null {
    const lines = sseBody.split("\n");

    let model = "unknown";
    let reasoning = "";

    for (const line of lines) {
      if (!line.startsWith("data: ")) {
        continue;
      }

      const dataStr = line.slice(6);

      if (dataStr === "[DONE]") {
        continue;
      }

      let data: unknown;
      try {
        data = JSON.parse(dataStr);
      } catch {
        continue;
      }

      if (!isRecord(data)) {
        continue;
      }

      // Track model from first chunk that has it
      if (model === "unknown" && typeof data["model"] === "string") {
        model = data["model"];
      }

      const choices = data["choices"];
      if (!Array.isArray(choices) || choices.length === 0) {
        continue;
      }

      const firstChoice: unknown = choices[0];
      if (!isRecord(firstChoice)) {
        continue;
      }

      const delta = firstChoice["delta"];
      if (!isRecord(delta)) {
        continue;
      }

      const reasoningContent = delta["reasoning_content"];
      if (typeof reasoningContent === "string") {
        reasoning += reasoningContent;
      }
    }

    if (reasoning.length === 0) {
      return null;
    }

    return {
      content: reasoning,
      provider: this.provider,
      model,
      extraction_method: "reasoning_content",
      confidence: CONFIDENCE_EXPLICIT,
      truncated: false,
    };
  }
}

/** Type guard for plain objects / records. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
