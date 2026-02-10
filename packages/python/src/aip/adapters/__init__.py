"""Provider adapters for thinking block extraction."""

from aip.adapters.types import ExtractionMethod, ExtractedThinking, ProviderAdapter
from aip.adapters.anthropic import AnthropicAdapter
from aip.adapters.openai import OpenAIAdapter
from aip.adapters.google import GoogleAdapter
from aip.adapters.fallback import FallbackAdapter
from aip.adapters.registry import AdapterRegistry, create_adapter_registry

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
