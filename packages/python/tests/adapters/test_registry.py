"""Tests for AdapterRegistry.

Ported from test/adapters/registry.test.ts.
"""

from __future__ import annotations

from aip.adapters.anthropic import AnthropicAdapter
from aip.adapters.fallback import FallbackAdapter
from aip.adapters.google import GoogleAdapter
from aip.adapters.openai import OpenAIAdapter
from aip.adapters.registry import create_adapter_registry
from aip.adapters.types import ExtractedThinking

# ---------------------------------------------------------------------------
# get()
# ---------------------------------------------------------------------------

class TestGet:
    """AdapterRegistry.get() tests."""

    def test_returns_anthropic_adapter_for_anthropic(self) -> None:
        registry = create_adapter_registry()
        adapter = registry.get("anthropic")

        assert isinstance(adapter, AnthropicAdapter)
        assert adapter.provider == "anthropic"

    def test_returns_openai_adapter_for_openai(self) -> None:
        registry = create_adapter_registry()
        adapter = registry.get("openai")

        assert isinstance(adapter, OpenAIAdapter)
        assert adapter.provider == "openai"

    def test_returns_google_adapter_for_google(self) -> None:
        registry = create_adapter_registry()
        adapter = registry.get("google")

        assert isinstance(adapter, GoogleAdapter)
        assert adapter.provider == "google"

    def test_returns_fallback_adapter_for_unknown(self) -> None:
        registry = create_adapter_registry()
        adapter = registry.get("unknown")

        assert isinstance(adapter, FallbackAdapter)
        assert adapter.provider == "fallback"


# ---------------------------------------------------------------------------
# detect_from_url()
# ---------------------------------------------------------------------------

class TestDetectFromUrl:
    """AdapterRegistry.detect_from_url() tests."""

    def test_detects_anthropic_from_url(self) -> None:
        registry = create_adapter_registry()
        adapter = registry.detect_from_url("https://api.anthropic.com/v1/messages")

        assert isinstance(adapter, AnthropicAdapter)
        assert adapter.provider == "anthropic"

    def test_detects_openai_from_url(self) -> None:
        registry = create_adapter_registry()
        adapter = registry.detect_from_url("https://api.openai.com/v1/chat/completions")

        assert isinstance(adapter, OpenAIAdapter)
        assert adapter.provider == "openai"

    def test_detects_google_from_googleapis_url(self) -> None:
        registry = create_adapter_registry()
        adapter = registry.detect_from_url("https://generativelanguage.googleapis.com/v1/models")

        assert isinstance(adapter, GoogleAdapter)
        assert adapter.provider == "google"

    def test_falls_back_for_unknown_url(self) -> None:
        registry = create_adapter_registry()
        adapter = registry.detect_from_url("https://example.com/api")

        assert isinstance(adapter, FallbackAdapter)
        assert adapter.provider == "fallback"


# ---------------------------------------------------------------------------
# register()
# ---------------------------------------------------------------------------

class TestRegister:
    """AdapterRegistry.register() tests."""

    def test_registers_custom_adapter_and_retrieves_via_get(self) -> None:
        registry = create_adapter_registry()

        class CustomAdapter:
            @property
            def provider(self) -> str:
                return "custom"

            def extract_thinking(self, response_body: str) -> ExtractedThinking | None:
                return None

            def extract_thinking_from_stream(self, sse_body: str) -> ExtractedThinking | None:
                return None

        custom_adapter = CustomAdapter()
        registry.register(custom_adapter)

        retrieved = registry.get("custom")
        assert retrieved is custom_adapter
        assert retrieved.provider == "custom"


# ---------------------------------------------------------------------------
# providers()
# ---------------------------------------------------------------------------

class TestProviders:
    """AdapterRegistry.providers() tests."""

    def test_lists_all_registered_provider_names(self) -> None:
        registry = create_adapter_registry()
        provider_list = registry.providers()

        assert "anthropic" in provider_list
        assert "openai" in provider_list
        assert "google" in provider_list
        assert "fallback" in provider_list
        assert len(provider_list) >= 4

    def test_includes_custom_adapters_after_registration(self) -> None:
        registry = create_adapter_registry()

        class MyProviderAdapter:
            @property
            def provider(self) -> str:
                return "my-provider"

            def extract_thinking(self, response_body: str) -> ExtractedThinking | None:
                return None

            def extract_thinking_from_stream(self, sse_body: str) -> ExtractedThinking | None:
                return None

        registry.register(MyProviderAdapter())
        provider_list = registry.providers()

        assert "my-provider" in provider_list
