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
- `packages/verify/` — verifier service

Same Alignment Card as AAP, same AP-Trace shape — different timescale.
License: **Apache-2.0** (forever — see commitment #6 on /for-agents).

## Stack

- **Python**: hatchling build, pydantic v2, pytest. Reference impl.
- **TypeScript**: tsup bundler, vitest, strict tsconfig.
- **Verifier**: separate package — see `packages/verify/README.md`.

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
  verify/                    # @mnemom/verify, offline verifier (TypeScript)
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

### Release tags (`.github/workflows/publish.yml`)

| Tag | Publishes | Version check |
|---|---|---|
| `vX.Y.Z` | `packages/typescript` to npm `latest`, `packages/python` to PyPI | tag equals both SDK versions |
| `verify-vX.Y.Z` | `packages/verify` to npm `latest` as `@mnemom/verify` (Trusted Publisher, provenance), plus its tarball attached to the GitHub release; never PyPI | tag equals `packages/verify/package.json` version |

- On a `verify-` tag the SDK validate, test, npm and PyPI jobs skip;
  on a `v*` tag the verifier jobs skip. Release steps are under
  "Releasing the verifier" below.
- The `workflow_dispatch` path publishes `packages/typescript` to npm (and
  `packages/python` to PyPI); any other `npm-directory` is refused.

### Releasing the verifier (`packages/verify`)

Nothing mints a `verify-v*` tag: `release-please-config.json` lists
only `packages/typescript` and `packages/python`, and `github-release.yml`
matches `vX.Y.Z-next` only. Cutting a verifier release is a manual step:

1. Land the version bump in `packages/verify/package.json` on `main`.
2. Create the release as a person (`gh` with your own login). A release
   made with `GITHUB_TOKEN` does not start `publish.yml`.

   ```bash
   gh release create verify-v<version> --repo mnemom/aip \
     --target <main-sha> --title "@mnemom/verify <version>" \
     --notes "Verifier built from main. publish.yml publishes it to npm under latest." \
     --prerelease --latest=false
   ```

3. The tag form is exactly `verify-v<version>`, where `<version>`
   equals `packages/verify/package.json`. `publish.yml` strips
   `verify-v` and fails the run on a mismatch, so
   `verify-0.6.0` (no `v`) fails.
4. The verifier jobs attach `mnemom-verify-<version>.tgz`, with a
   build-provenance attestation, to the release. `publish-verify-npm`
   publishes `@mnemom/verify@<version>` to npm under `latest` with
   provenance through the org reusable `npm-publish.yml`; that is a fresh
   build of `packages/verify` at the release commit, not the attested
   tarball's bytes. The reusable also attaches
   `sbom-mnemom-verify-<version>.cdx.json` (CycloneDX) to the release.
   Consumers run `npm install @mnemom/verify`, or install the tarball from
   `https://github.com/mnemom/aip/releases/download/verify-v<version>/mnemom-verify-<version>.tgz`.
5. npm accepts the OIDC publish only from the Trusted Publisher set on
   `@mnemom/verify`: repo `mnemom/aip`, workflow `publish.yml`, environment
   `production`. Renaming that workflow file or environment breaks npm
   publishing until the Trusted Publisher is updated on npmjs.com.

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
