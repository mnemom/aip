import type { ExtractedThinking, ProviderAdapter } from "./types.js";
import { CONFIDENCE_NATIVE } from "../constants.js";

/**
 * Anthropic provider adapter.
 *
 * Extracts thinking blocks from Anthropic API responses. This is the
 * highest-confidence adapter (1.0) because Anthropic natively exposes
 * thinking blocks as first-class content elements.
 */
export class AnthropicAdapter implements ProviderAdapter {
  readonly provider = "anthropic";

  /**
   * Extract thinking content from a non-streaming Anthropic response body.
   *
   * Looks for content blocks where `type === "thinking"` and concatenates
   * their `thinking` field values with a separator.
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
    const contentArray = parsed["content"];

    if (!Array.isArray(contentArray)) {
      return null;
    }

    const thinkingTexts: string[] = [];

    for (const block of contentArray) {
      if (
        isRecord(block) &&
        block["type"] === "thinking" &&
        typeof block["thinking"] === "string"
      ) {
        thinkingTexts.push(block["thinking"]);
      }
    }

    if (thinkingTexts.length === 0) {
      return null;
    }

    return {
      content: thinkingTexts.join("\n\n---\n\n"),
      provider: this.provider,
      model,
      extraction_method: "native_thinking",
      confidence: CONFIDENCE_NATIVE,
      truncated: false,
    };
  }

  /**
   * Extract thinking content from an Anthropic SSE streaming response.
   *
   * Processes Server-Sent Events to accumulate thinking deltas from
   * `content_block_start` and `content_block_delta` events.
   */
  extractThinkingFromStream(sseBody: string): ExtractedThinking | null {
    const lines = sseBody.split("\n");

    let model = "unknown";
    const thinkingBlockIndices = new Set<number>();
    const thinkingContents = new Map<number, string>();

    for (const line of lines) {
      if (!line.startsWith("data: ")) {
        continue;
      }

      const dataStr = line.slice(6);

      let data: unknown;
      try {
        data = JSON.parse(dataStr);
      } catch {
        continue;
      }

      if (!isRecord(data)) {
        continue;
      }

      const eventType = data["type"];

      if (eventType === "message_start") {
        const message = data["message"];
        if (isRecord(message) && typeof message["model"] === "string") {
          model = message["model"];
        }
      } else if (eventType === "content_block_start") {
        const index = data["index"];
        const contentBlock = data["content_block"];
        if (
          typeof index === "number" &&
          isRecord(contentBlock) &&
          contentBlock["type"] === "thinking"
        ) {
          thinkingBlockIndices.add(index);
          thinkingContents.set(index, "");
        }
      } else if (eventType === "content_block_delta") {
        const index = data["index"];
        const delta = data["delta"];
        if (
          typeof index === "number" &&
          thinkingBlockIndices.has(index) &&
          isRecord(delta) &&
          delta["type"] === "thinking_delta" &&
          typeof delta["thinking"] === "string"
        ) {
          const existing = thinkingContents.get(index) ?? "";
          thinkingContents.set(index, existing + delta["thinking"]);
        }
      }
    }

    if (thinkingBlockIndices.size === 0) {
      return null;
    }

    // Collect thinking contents in block index order
    const sortedIndices = [...thinkingBlockIndices].sort((a, b) => a - b);
    const thinkingTexts: string[] = [];
    for (const idx of sortedIndices) {
      const text = thinkingContents.get(idx) ?? "";
      if (text.length > 0) {
        thinkingTexts.push(text);
      }
    }

    if (thinkingTexts.length === 0) {
      return null;
    }

    return {
      content: thinkingTexts.join("\n\n---\n\n"),
      provider: this.provider,
      model,
      extraction_method: "native_thinking",
      confidence: CONFIDENCE_NATIVE,
      truncated: false,
    };
  }
}

/** Type guard for plain objects / records. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
