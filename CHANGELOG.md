# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-02-10

Initial release.

### Added
- IETF-style protocol specification (docs/SPEC.md, 2,214 lines)
- TypeScript SDK with full API surface (272 tests)
- Python SDK with full TypeScript parity (267 tests)
- Provider adapters: Anthropic, OpenAI, Google, Fallback
- Integrity checkpoint schema and analysis engine
- Conscience prompt builder with card summary and value injection
- Session windowing for multi-turn context tracking
- Integrity drift detection across checkpoint history
- Card-conscience agreement validation
- HMAC signing and signature verification
- CI pipeline (GitHub Actions: TypeScript + Python)
