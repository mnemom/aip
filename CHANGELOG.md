# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.4] - 2026-02-12

### Added
- Enriched analysis context: value descriptions and `agent_description` field flow to the analysis model
- `taskContext` parameter on `check()` (TypeScript) / `task_context` (Python) for caller-provided, PII-safe task context
- `IMPORTANT EVALUATION PRINCIPLES` section in analysis prompt — evaluates behavioral intent not topic content

### Changed
- Card summary uses expanded format when value descriptions are present, falls back to compact for backward compat
- Lower severity for short/ambiguous thinking blocks
- Source pivoting recognized as normal adaptive behavior

## [0.1.3] - 2026-02-12

### Fixed
- `client.check()` now tries SSE stream extraction as fallback when standard JSON parsing fails
- Word-boundary agreement matching prevents false positives (e.g., `"execute"` no longer matches `"exec"`)

### Changed
- All provider adapters (Anthropic, OpenAI, Google) attempt SSE stream extraction as fallback
- Python package bumped to 0.1.3 for coordinated release

## [0.1.2] - 2026-02-11

### Changed
- Improved npm package metadata

## [0.1.1] - 2026-02-11

### Added
- Root README.md with badges, quick start, architecture diagram, API reference
- Apache 2.0 LICENSE
- CONTRIBUTING.md (monorepo dev setup, SDK parity requirement)
- docs/SECURITY.md (threat model, meta-injection, fail-open/closed, HMAC)
- docs/QUICKSTART.md (7-step guide, Python + TypeScript)
- docs/LIMITS.md (5 fundamental limitations, misconceptions, appropriate use cases)
- docs/images/aip-architecture.svg (3-layer architecture diagram)
- Examples: basic-check, gateway-integration, adversarial detection scenarios
- JSON Schemas: integrity-checkpoint, integrity-signal, conscience-value
- Per-package READMEs (packages/typescript, packages/python)
- PEP 561 py.typed marker for typed Python package
- publish.yml workflow (version validation + test gate + PyPI + npm)
- codeql.yml workflow (weekly security scan, Python + JS/TS)

### Changed
- CI: Python version matrix (3.10, 3.11, 3.12), ruff lint step, codecov upload
- pyproject.toml: classifiers, project URLs, keywords, readme, ruff rules, mypy target
- package.json: publishConfig, homepage, bugs fields
- Python imports reordered by ruff (78 auto-fixes)

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
