# Contributing to AIP

Thank you for your interest in contributing to the Agent Integrity Protocol.

## Development Setup

AIP is a monorepo with TypeScript and Python SDKs under `packages/`.

### TypeScript SDK

```bash
cd packages/typescript
npm install
npm run typecheck   # Type checking
npm test            # Run tests
npm run build       # Build CJS + ESM
```

### Python SDK

```bash
cd packages/python
python -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
mypy src/           # Type checking
pytest              # Run tests
```

## Running Tests

```bash
# TypeScript (272 tests)
cd packages/typescript && npm test

# Python (267 tests)
cd packages/python && pytest
```

## Code Style

### Python

We use [ruff](https://github.com/astral-sh/ruff) for linting and formatting:

```bash
ruff check src/ tests/
ruff format src/ tests/
```

### TypeScript

We use strict TypeScript with `tsc --noEmit`:

```bash
npm run typecheck
```

## Type Checking

Both SDKs enforce strict type checking:

```bash
# Python
mypy src/

# TypeScript
npm run typecheck
```

## Pull Request Process

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/your-feature`)
3. Make your changes
4. Run tests and type checking for both SDKs
5. Ensure parity — changes to one SDK should be reflected in the other
6. Submit a pull request

### SDK Parity

AIP maintains full parity between the TypeScript and Python SDKs. If you add a feature or fix a bug in one SDK, please implement the equivalent change in the other. Test names and structure should match across both SDKs.

## Reporting Issues

Please use [GitHub Issues](https://github.com/mnemom/aip/issues) for bug reports and feature requests.

## Key Areas for Contribution

- **Provider adapters** — Support for additional LLM providers
- **Integration examples** — Real-world usage patterns with agent frameworks
- **Adversarial test vectors** — Edge cases that test detection boundaries
- **Documentation** — Improvements to guides, examples, and API docs
