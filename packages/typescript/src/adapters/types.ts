/** Method used to extract thinking content */
export type ExtractionMethod = "native_thinking" | "reasoning_content" | "response_analysis";

/** Extracted thinking block from a provider response */
export interface ExtractedThinking {
  content: string;
  provider: string;
  model: string;
  extraction_method: ExtractionMethod;
  confidence: number; // 0.0–1.0
  truncated: boolean;
}

/** Interface all provider adapters must implement */
export interface ProviderAdapter {
  readonly provider: string;
  extractThinking(responseBody: string): ExtractedThinking | null;
  extractThinkingFromStream(sseBody: string): ExtractedThinking | null;
}
