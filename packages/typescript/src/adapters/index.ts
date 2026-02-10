import type { ProviderAdapter } from "./types.js";
import { AnthropicAdapter } from "./anthropic.js";
import { OpenAIAdapter } from "./openai.js";
import { GoogleAdapter } from "./google.js";
import { FallbackAdapter } from "./fallback.js";

export interface AdapterRegistry {
  /** Get adapter by provider name */
  get(provider: string): ProviderAdapter;
  /** Detect provider from API base URL */
  detectFromUrl(url: string): ProviderAdapter;
  /** Register a custom adapter */
  register(adapter: ProviderAdapter): void;
  /** List all registered provider names */
  providers(): string[];
}

export function createAdapterRegistry(): AdapterRegistry {
  const adapters = new Map<string, ProviderAdapter>();
  const fallback = new FallbackAdapter();

  // Register built-in adapters
  adapters.set("anthropic", new AnthropicAdapter());
  adapters.set("openai", new OpenAIAdapter());
  adapters.set("google", new GoogleAdapter());
  adapters.set("fallback", fallback);

  return {
    get(provider: string): ProviderAdapter {
      return adapters.get(provider) ?? fallback;
    },
    detectFromUrl(url: string): ProviderAdapter {
      const lower = url.toLowerCase();
      if (lower.includes("anthropic")) return adapters.get("anthropic")!;
      if (lower.includes("openai")) return adapters.get("openai")!;
      if (lower.includes("googleapis") || lower.includes("generativelanguage")) return adapters.get("google")!;
      return fallback;
    },
    register(adapter: ProviderAdapter): void {
      adapters.set(adapter.provider, adapter);
    },
    providers(): string[] {
      return [...adapters.keys()];
    },
  };
}

// Re-export all adapters and types
export { AnthropicAdapter } from "./anthropic.js";
export { OpenAIAdapter } from "./openai.js";
export { GoogleAdapter } from "./google.js";
export { FallbackAdapter } from "./fallback.js";
export type { ProviderAdapter, ExtractedThinking, ExtractionMethod } from "./types.js";
