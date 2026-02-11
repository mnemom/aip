"""Provider adapters for thinking block extraction."""

from aip.adapters.anthropic import AnthropicAdapter
from aip.adapters.fallback import FallbackAdapter
from aip.adapters.google import GoogleAdapter
from aip.adapters.openai import OpenAIAdapter
from aip.adapters.registry import AdapterRegistry, create_adapter_registry
from aip.adapters.types import ExtractedThinking, ExtractionMethod, ProviderAdapter

__all__ = [
    "ExtractionMethod",
    "ExtractedThinking",
    "ProviderAdapter",
    "AnthropicAdapter",
    "OpenAIAdapter",
    "GoogleAdapter",
    "FallbackAdapter",
    "AdapterRegistry",
    "create_adapter_registry",
]
