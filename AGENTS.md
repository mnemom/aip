# AGENTS.md — aip

You are a coding agent working on the **Agent Integrity Protocol (AIP)**.
Audience: AI coding tools (Claude Code, Cursor, Cline, Aider) and humans
onboarding via them.

For the protocol explanation, start at the README. For the public
agent-readability commitment that depends on this repo staying Apache
2.0, see https://www.mnemom.ai/for-agents (commitment #6).

## What this repo is

AIP is the **real-time thinking-block analysis** protocol — sister to
AAP (Agent Alignment Protocol). Where AAP works on AP-Traces after a
turn, AIP analyzes thinking blocks *during* a turn and delivers
integrity verdicts in time to intervene.

Tri-language workspace under `packages/`:
- `packages/python/` — `agent-integrity-proto` on PyPI (reference)
- `packages/typescript/` — `@mnemom/agent-integrity-protocol` on npm
- `packages/verifier/` — verifier service

Same Alignment Card as AAP, same AP-Trace shape — different timescale.
License: **Apache-2.0** (forever — see commitment #6 on /for-agents).

## Stack

- **Python**: hatchling build, pydantic v2, pytest. Reference impl.
- **TypeScript**: tsup bundler, vitest, strict tsconfig.
- **Verifier**: separate package — see `packages/verifier/README.md`.

## Install + dev — Python

```bash
cd packages/python
pip install -e ".[dev]"
pytest
ruff check .
mypy src
```

## Install + dev — TypeScript

```bash
cd packages/typescript
npm install
npm test
npm run typecheck
npm run build
```

## Project layout

```
schemas/                     # NORMATIVE protocol schemas (both impls validate)
packages/
  python/                    # Python reference implementation
    src/aip/                 # public API: create_client, …
    tests/
    pyproject.toml
  typescript/                # TypeScript mirror
    src/
    tests/
    package.json
  verifier/                  # Verifier service (Python)
docs/                        # Spec + integration guides (long-form)
examples/                    # Working examples — used in docs
```

## Conventions

- **Schemas in `schemas/` are the normative spec.** When you change a
  schema, update both Python and TypeScript implementations to match
  in the same PR. Cross-language consistency tests will fail otherwise.
- **Python and TypeScript versions stay in lockstep.** Bump
  `packages/python/pyproject.toml::project.version` and
  `packages/typescript/package.json::version` together.
- **Apache-2.0 only.** This is a public commitment (see /for-agents
  commitment #6). The Mnemom watchdog asserts the LICENSE string
  nightly. Do not relicense.
- **Same Alignment Card as AAP.** AIP and AAP share card definitions —
  changes to alignment-card schemas must round-trip both repos.
- Commit messages: imperative, concise, describe the **why**.

## Branch protection + deploy

- Never commit directly to `main`. Always feature branch first.
- Branch protection enforced.
- Deploy: `mnemom/deploy` orchestrator publishes to npm + PyPI on
  tagged releases. Don't modify the orchestrator.

## What you should NOT do

- Don't add new runtime dependencies without explicit approval. AIP is
  intentionally minimal.
- Don't relicense.
- Don't drift Python and TypeScript implementations apart.
- Don't change AP-Trace or Alignment Card shapes without coordinating
  with the AAP repo — they share the contract.
- Don't skip pre-commit hooks (`--no-verify`).
- Don't `git push --force` to `main`.

## Cross-links

- **Sister protocol**: [Agent Alignment Protocol (AAP)](https://github.com/mnemom/aap) —
  retroactive verification on AP-Traces. Shared Alignment Card.
- **OTel exporter**: [aip-otel-exporter](https://github.com/mnemom/aip-otel-exporter) —
  ships AIP/AAP verdicts into OpenTelemetry pipelines.
- **Public commitment depending on this repo**:
  https://www.mnemom.ai/for-agents — commitment #6 ("Open protocols")
  asserts AIP stays Apache 2.0.
- **Mintlify-hosted protocol docs**: https://docs.mnemom.ai/protocols/aip
