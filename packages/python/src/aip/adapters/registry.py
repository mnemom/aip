"""Adapter registry — mirrors packages/typescript/src/adapters/index.ts createAdapterRegistry."""

from __future__ import annotations

from aip.adapters.anthropic import AnthropicAdapter
from aip.adapters.fallback import FallbackAdapter
from aip.adapters.google import GoogleAdapter
from aip.adapters.openai import OpenAIAdapter
from aip.adapters.types import ProviderAdapter


class AdapterRegistry:
    """Registry of provider adapters with URL-based detection."""

    def __init__(self) -> None:
        self._adapters: dict[str, ProviderAdapter] = {}
        self._fallback: FallbackAdapter = FallbackAdapter()

        # Register built-in adapters
        self._adapters["anthropic"] = AnthropicAdapter()
        self._adapters["openai"] = OpenAIAdapter()
        self._adapters["google"] = GoogleAdapter()
        self._adapters["fallback"] = self._fallback

    def get(self, provider: str) -> ProviderAdapter:
        """Get adapter by provider name. Returns fallback for unknown providers."""
        adapter = self._adapters.get(provider)
        if adapter is not None:
            return adapter
        return self._fallback

    def detect_from_url(self, url: str) -> ProviderAdapter:
        """Detect provider from API base URL."""
        lower = url.lower()
        if "anthropic" in lower:
            return self._adapters["anthropic"]
        if "openai" in lower:
            return self._adapters["openai"]
        if "googleapis" in lower or "generativelanguage" in lower:
            return self._adapters["google"]
        return self._fallback

    def register(self, adapter: ProviderAdapter) -> None:
        """Register a custom adapter."""
        self._adapters[adapter.provider] = adapter

    def providers(self) -> list[str]:
        """List all registered provider names."""
        return list(self._adapters.keys())


def create_adapter_registry() -> AdapterRegistry:
    """Create a new adapter registry with default adapters registered."""
    return AdapterRegistry()
