import type { ExtractedThinking, ProviderAdapter } from "./types.js";
import { CONFIDENCE_FALLBACK } from "../constants.js";

/**
 * Reasoning indicator patterns used to infer thinking from plain text.
 *
 * These prefixes commonly appear at the start of sentences when a model
 * is narrating its reasoning process, even without native thinking support.
 */
const REASONING_INDICATORS = [
  "I need to",
  "Let me",
  "I should",
  "My approach",
  "First, I'll",
  "I'm going to",
  "Step 1",
  "Consider",
  "On one hand",
  "However",
  "But",
  "Alternatively",
  "I think",
  "I'll",
] as const;

/**
 * Build a regex that matches any sentence starting with a reasoning indicator.
 *
 * The pattern captures full sentences (terminated by `.`, `!`, `?`, or end-of-string).
 */
function buildReasoningPattern(): RegExp {
  const escaped = REASONING_INDICATORS.map((i) =>
    i.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
  );
  // Match sentence beginning with indicator, ending at sentence boundary
  return new RegExp(
    `(?:^|(?<=[.!?]\\s))(?:${escaped.join("|")})[^.!?]*[.!?]?`,
    "gi",
  );
}

const REASONING_PATTERN = buildReasoningPattern();

/**
 * Fallback provider adapter for models without native thinking support.
 *
 * Applies heuristic pattern matching to infer reasoning segments from
 * the model's text output. Confidence is low (CONFIDENCE_FALLBACK = 0.3)
 * because the extraction is purely inferential.
 */
export class FallbackAdapter implements ProviderAdapter {
  readonly provider = "fallback";

  /**
   * Extract thinking content from a non-streaming response body.
   *
   * Attempts to parse the response as JSON and locate the main text
   * content using provider-agnostic heuristics (Anthropic-like,
   * OpenAI-like, Google-like, or plain string). Then applies pattern
   * matching to identify reasoning sentences.
   */
  extractThinking(responseBody: string): ExtractedThinking | null {
    const text = extractTextContent(responseBody);
    if (text === null || text.length === 0) {
      return null;
    }

    return matchReasoningPatterns(text, this.provider);
  }

  /**
   * Extract thinking content from an SSE streaming response.
   *
   * Accumulates all text deltas from `data:` lines, then applies
   * the same pattern matching as `extractThinking`.
   */
  extractThinkingFromStream(sseBody: string): ExtractedThinking | null {
    const lines = sseBody.split("\n");
    let accumulated = "";

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
        // Non-JSON data line; skip
        continue;
      }

      if (!isRecord(data)) {
        continue;
      }

      // Anthropic-style: content_block_delta with text_delta
      const delta = data["delta"];
      if (isRecord(delta)) {
        if (typeof delta["text"] === "string") {
          accumulated += delta["text"];
          continue;
        }
        if (typeof delta["thinking"] === "string") {
          accumulated += delta["thinking"];
          continue;
        }
      }

      // OpenAI-style: choices[0].delta.content
      const choices = data["choices"];
      if (Array.isArray(choices) && choices.length > 0) {
        const firstChoice: unknown = choices[0];
        if (isRecord(firstChoice)) {
          const choiceDelta = firstChoice["delta"];
          if (isRecord(choiceDelta) && typeof choiceDelta["content"] === "string") {
            accumulated += choiceDelta["content"];
            continue;
          }
        }
      }

      // Google-style: candidates[0].content.parts[0].text
      const candidates = data["candidates"];
      if (Array.isArray(candidates) && candidates.length > 0) {
        const firstCandidate: unknown = candidates[0];
        if (isRecord(firstCandidate)) {
          const content = firstCandidate["content"];
          if (isRecord(content)) {
            const parts = content["parts"];
            if (Array.isArray(parts) && parts.length > 0) {
              const firstPart: unknown = parts[0];
              if (isRecord(firstPart) && typeof firstPart["text"] === "string") {
                accumulated += firstPart["text"];
              }
            }
          }
        }
      }
    }

    if (accumulated.length === 0) {
      return null;
    }

    return matchReasoningPatterns(accumulated, "fallback");
  }
}

/**
 * Extract the main text content from a response body string.
 *
 * Tries multiple provider formats in order:
 * 1. Anthropic-like: `content[0].text`
 * 2. OpenAI-like: `choices[0].message.content`
 * 3. Google-like: `candidates[0].content.parts[0].text`
 * 4. Plain string: if parsing fails, use the raw string
 */
function extractTextContent(responseBody: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(responseBody);
  } catch {
    // Not valid JSON — treat as plain text if non-empty
    return responseBody.trim().length > 0 ? responseBody : null;
  }

  // If parsing results in a plain string, use it directly
  if (typeof parsed === "string") {
    return parsed.length > 0 ? parsed : null;
  }

  if (!isRecord(parsed)) {
    return null;
  }

  // Anthropic-like: content[0].text
  const contentArray = parsed["content"];
  if (Array.isArray(contentArray)) {
    for (const block of contentArray) {
      if (isRecord(block) && typeof block["text"] === "string" && block["text"].length > 0) {
        return block["text"];
      }
    }
  }

  // OpenAI-like: choices[0].message.content
  const choices = parsed["choices"];
  if (Array.isArray(choices) && choices.length > 0) {
    const firstChoice: unknown = choices[0];
    if (isRecord(firstChoice)) {
      const message = firstChoice["message"];
      if (isRecord(message) && typeof message["content"] === "string" && message["content"].length > 0) {
        return message["content"];
      }
    }
  }

  // Google-like: candidates[0].content.parts[0].text
  const candidates = parsed["candidates"];
  if (Array.isArray(candidates) && candidates.length > 0) {
    const firstCandidate: unknown = candidates[0];
    if (isRecord(firstCandidate)) {
      const content = firstCandidate["content"];
      if (isRecord(content)) {
        const parts = content["parts"];
        if (Array.isArray(parts) && parts.length > 0) {
          const firstPart: unknown = parts[0];
          if (isRecord(firstPart) && typeof firstPart["text"] === "string" && firstPart["text"].length > 0) {
            return firstPart["text"];
          }
        }
      }
    }
  }

  return null;
}

/**
 * Apply reasoning pattern matching to the given text.
 *
 * Returns `ExtractedThinking` if reasoning patterns are found,
 * or `null` if no patterns match.
 */
function matchReasoningPatterns(
  text: string,
  provider: string,
): ExtractedThinking | null {
  // Reset regex state since it has the global flag
  REASONING_PATTERN.lastIndex = 0;

  const matches: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = REASONING_PATTERN.exec(text)) !== null) {
    matches.push(match[0].trim());
  }

  if (matches.length === 0) {
    return null;
  }

  return {
    content: matches.join(" "),
    provider,
    model: "unknown",
    extraction_method: "response_analysis",
    confidence: CONFIDENCE_FALLBACK,
    truncated: false,
  };
}

/** Type guard for plain objects / records. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
