import type { ExtractedThinking, ProviderAdapter } from "./types.js";
import { CONFIDENCE_EXPLICIT } from "../constants.js";

/**
 * Google / Gemini provider adapter.
 *
 * Extracts thinking content from Google Gemini API responses.
 * Gemini surfaces thinking as content parts with `thought: true`.
 * Confidence is 0.9 (CONFIDENCE_EXPLICIT) because the thinking flag
 * is an explicit but secondary signal compared to Anthropic's native
 * first-class thinking blocks.
 */
export class GoogleAdapter implements ProviderAdapter {
  readonly provider = "google";

  /**
   * Extract thinking content from a non-streaming Google Gemini response body.
   *
   * Navigates to `candidates[0].content.parts` and filters for parts
   * where `thought === true`, collecting their `text` fields.
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

    const model = typeof parsed["modelVersion"] === "string" ? parsed["modelVersion"] : "unknown";
    const candidates = parsed["candidates"];

    if (!Array.isArray(candidates)) {
      return null;
    }

    const firstCandidate = candidates[0];
    if (!isRecord(firstCandidate)) {
      return null;
    }

    const content = firstCandidate["content"];
    if (!isRecord(content)) {
      return null;
    }

    const parts = content["parts"];
    if (!Array.isArray(parts)) {
      return null;
    }

    const thinkingTexts: string[] = [];

    for (const part of parts) {
      if (
        isRecord(part) &&
        part["thought"] === true &&
        typeof part["text"] === "string"
      ) {
        thinkingTexts.push(part["text"]);
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
      confidence: CONFIDENCE_EXPLICIT,
      truncated: false,
    };
  }

  /**
   * Extract thinking content from a Google Gemini SSE streaming response.
   *
   * Processes Server-Sent Events, parsing each `data: ` line as JSON
   * and looking for `candidates[0].content.parts` where `thought === true`.
   */
  extractThinkingFromStream(sseBody: string): ExtractedThinking | null {
    const lines = sseBody.split("\n");

    let model = "unknown";
    const thinkingTexts: string[] = [];

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

      // Track model from modelVersion field
      if (typeof data["modelVersion"] === "string") {
        model = data["modelVersion"];
      }

      const candidates = data["candidates"];
      if (!Array.isArray(candidates)) {
        continue;
      }

      const firstCandidate = candidates[0];
      if (!isRecord(firstCandidate)) {
        continue;
      }

      const content = firstCandidate["content"];
      if (!isRecord(content)) {
        continue;
      }

      const parts = content["parts"];
      if (!Array.isArray(parts)) {
        continue;
      }

      for (const part of parts) {
        if (
          isRecord(part) &&
          part["thought"] === true &&
          typeof part["text"] === "string"
        ) {
          thinkingTexts.push(part["text"]);
        }
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
      confidence: CONFIDENCE_EXPLICIT,
      truncated: false,
    };
  }
}

/** Type guard for plain objects / records. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
