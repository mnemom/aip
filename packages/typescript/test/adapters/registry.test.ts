import { describe, it, expect } from "vitest";
import { createAdapterRegistry } from "../../src/adapters/index.js";
import { AnthropicAdapter } from "../../src/adapters/anthropic.js";
import { OpenAIAdapter } from "../../src/adapters/openai.js";
import { GoogleAdapter } from "../../src/adapters/google.js";
import { FallbackAdapter } from "../../src/adapters/fallback.js";
import type { ProviderAdapter, ExtractedThinking } from "../../src/adapters/types.js";

describe("AdapterRegistry", () => {
  describe("get()", () => {
    it('returns AnthropicAdapter for "anthropic"', () => {
      const registry = createAdapterRegistry();
      const adapter = registry.get("anthropic");
      expect(adapter).toBeInstanceOf(AnthropicAdapter);
      expect(adapter.provider).toBe("anthropic");
    });

    it('returns OpenAIAdapter for "openai"', () => {
      const registry = createAdapterRegistry();
      const adapter = registry.get("openai");
      expect(adapter).toBeInstanceOf(OpenAIAdapter);
      expect(adapter.provider).toBe("openai");
    });

    it('returns GoogleAdapter for "google"', () => {
      const registry = createAdapterRegistry();
      const adapter = registry.get("google");
      expect(adapter).toBeInstanceOf(GoogleAdapter);
      expect(adapter.provider).toBe("google");
    });

    it("returns FallbackAdapter for unknown provider", () => {
      const registry = createAdapterRegistry();
      const adapter = registry.get("unknown");
      expect(adapter).toBeInstanceOf(FallbackAdapter);
      expect(adapter.provider).toBe("fallback");
    });
  });

  describe("detectFromUrl()", () => {
    it("detects Anthropic from URL", () => {
      const registry = createAdapterRegistry();
      const adapter = registry.detectFromUrl(
        "https://api.anthropic.com/v1/messages",
      );
      expect(adapter).toBeInstanceOf(AnthropicAdapter);
      expect(adapter.provider).toBe("anthropic");
    });

    it("detects OpenAI from URL", () => {
      const registry = createAdapterRegistry();
      const adapter = registry.detectFromUrl(
        "https://api.openai.com/v1/chat/completions",
      );
      expect(adapter).toBeInstanceOf(OpenAIAdapter);
      expect(adapter.provider).toBe("openai");
    });

    it("detects Google from googleapis URL", () => {
      const registry = createAdapterRegistry();
      const adapter = registry.detectFromUrl(
        "https://generativelanguage.googleapis.com/v1/models",
      );
      expect(adapter).toBeInstanceOf(GoogleAdapter);
      expect(adapter.provider).toBe("google");
    });

    it("falls back for unknown URL", () => {
      const registry = createAdapterRegistry();
      const adapter = registry.detectFromUrl("https://example.com/api");
      expect(adapter).toBeInstanceOf(FallbackAdapter);
      expect(adapter.provider).toBe("fallback");
    });
  });

  describe("register()", () => {
    it("registers a custom adapter and retrieves it via get()", () => {
      const registry = createAdapterRegistry();

      const customAdapter: ProviderAdapter = {
        provider: "custom",
        extractThinking(_responseBody: string): ExtractedThinking | null {
          return null;
        },
        extractThinkingFromStream(_sseBody: string): ExtractedThinking | null {
          return null;
        },
      };

      registry.register(customAdapter);

      const retrieved = registry.get("custom");
      expect(retrieved).toBe(customAdapter);
      expect(retrieved.provider).toBe("custom");
    });
  });

  describe("providers()", () => {
    it("lists all registered provider names", () => {
      const registry = createAdapterRegistry();
      const providerList = registry.providers();

      expect(providerList).toContain("anthropic");
      expect(providerList).toContain("openai");
      expect(providerList).toContain("google");
      expect(providerList).toContain("fallback");
      expect(providerList.length).toBeGreaterThanOrEqual(4);
    });

    it("includes custom adapters after registration", () => {
      const registry = createAdapterRegistry();

      const customAdapter: ProviderAdapter = {
        provider: "my-provider",
        extractThinking(): ExtractedThinking | null {
          return null;
        },
        extractThinkingFromStream(): ExtractedThinking | null {
          return null;
        },
      };

      registry.register(customAdapter);
      const providerList = registry.providers();

      expect(providerList).toContain("my-provider");
    });
  });
});
