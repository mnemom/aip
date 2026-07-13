# AIP — Decisions Index

This file is a **pointer file**, not the canonical ADR home.
Canonical home: `github.com/mnemom/decisions` (not yet created as of 2026-07-13 —
see note below).

## Repo character

AIP is the public, Apache-2.0 Agent Integrity Protocol SDK (Python + TypeScript).
It is a **minimal protocol library** — intentionally no runtime dependencies beyond
its own pydantic/zod schemas. Decisions that land here tend to be about API
stability contracts, protocol evolution, and cross-layer integration principles.

## ADR table

| ADR | Title | Status | Canonical home |
|-----|-------|--------|----------------|
| ADR-006 | API stability and major-version support window | Adopted | `mnemom/decisions` (pending — see note) |
| ADR-007 | Unified YAML agent card — 2.0 design intent | Adopted | `mnemom/decisions` (pending — see note) |
| ADR-048 | Triggering governance signal reference (operator-vs-agent layering) | Adopted | `mnemom/decisions` (pending — see note) |

### ADR-006 — API stability and major-version support window

The 1.0.0 release locks the public API surface. Breaking changes require a major
version bump (e.g. 1.x → 2.0). Each major version is supported for **18 months**
from the release of its successor. Deprecations follow a four-notice schedule at
T+0, +12 months, +16 months, and +17 months via `Deprecation`, `Sunset`, and
`Link` response headers plus email notifications.

*References in this repo:* `packages/typescript/CHANGELOG.md` §1.0.0,
`packages/typescript/test/backward-compat.test.ts` header comment.

### ADR-007 — Unified YAML agent card (2.0 design intent)

A 2.0 is planned that unifies AAP alignment cards and CLPI policy YAML into a
single YAML agent card with runtime composition. Target window: 6–12 months after
the 1.0 stability lock, informed by production data. No breaking changes ship in
the 1.x line.

*References in this repo:* `packages/typescript/CHANGELOG.md` §1.0.0
forward-looking note.

### ADR-048 — Triggering governance signal reference

`IntegritySignal` carries an optional `triggering_governance_signal_id`
(`gs-{12-hex}`) set by the host platform when an integrity result correlates with
a Mnemom governance signal (e.g., a `sideband.coherence` drop preceded a boundary
violation). The field is purely informational — the integrity verdict stands without
it. ADR-048 §1 defines the operator-vs-agent layering principle: operators attach
the cross-link; agents and SDK consumers read it passively.

*References in this repo:* `packages/typescript/src/schemas/signal.ts`
(`triggering_governance_signal_id` field JSDoc), `packages/typescript/CHANGELOG.md`
§1.1.0.

## Local decisions

No decisions are recorded locally in this repo; all AIP ADRs live (or will live)
in the canonical `mnemom/decisions` repo.

## Note on canonical-home links

The `mnemom/decisions` repository does not yet exist (verified 2026-07-13 via
`gh api repos/mnemom/decisions` → 404). Canonical-home links will resolve once
that repo is created. The slug convention expected is
`github.com/mnemom/decisions/blob/main/adr-006-*.md` (and similarly for ADR-007,
ADR-048). When the repo is created, replace the "pending" placeholders above with
direct links.
