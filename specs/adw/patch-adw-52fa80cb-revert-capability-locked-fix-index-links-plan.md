# Spec — Patch: Revert capability.yaml --locked removal; fix decisions/index.md canonical-home links

- **Status:** Draft
- **Branch:** chore-issue-94-adw-52fa80cb-aip-add-decisions-index-md-pointer-file
- **Location:** `.mnemom/capability.yaml`, `decisions/index.md`
- **Related docs:** N/A

## Problem / Objective
**Original Spec:** N/A
**Issue:** Two review-gate blocking findings:
1. `.mnemom/capability.yaml` silently removed `--locked` from all `uv sync` and `uv run` invocations (plus added a NOTE justifying the removal via UV_FROZEN=1). This change was out-of-scope (the issue only asked for `decisions/index.md`), no acceptance criterion covers it, and it silently degrades lockfile enforcement if the ADW runner ever runs without `UV_FROZEN=1`.
2. `decisions/index.md` canonical-home cells in the ADR table are backtick-wrapped text strings (`mnemom/decisions (pending — see note)`), not markdown hyperlinks. The acceptance criterion explicitly requires "correct canonical-home links."

**Solution:**
1. Revert capability.yaml to restore `--locked` on every `uv sync` and `uv run` command, and remove the out-of-scope NOTE comment that justified the omission.
2. Replace each backtick placeholder in the ADR table's Canonical home column with a markdown hyperlink pointing to the expected future URL, annotated as pending.

## Approach & Changes
### Files to Modify
- `.mnemom/capability.yaml` — restore `--locked` flags, remove NOTE comment
- `decisions/index.md` — replace three text placeholders with markdown links

### Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Restore `--locked` in `.mnemom/capability.yaml` and remove the NOTE comment
- Remove lines 19–22 (the NOTE: block explaining why --locked is omitted)
- In the `commands:` block, update each verb:
  - `lint`:      `uv sync --extra dev` → `uv sync --locked --extra dev`; `uv run --extra dev` → `uv run --locked --extra dev`
  - `typecheck`: same substitutions for the Python portion
  - `test`:      same substitutions for the Python portion
  - `build`:     `uv sync --extra dev` → `uv sync --locked --extra dev` (the `uv build` call has no `--locked` flag and does not need one)
- Do not touch npm/TypeScript lines or any other section of the file.

### Step 2: Fix canonical-home cells in `decisions/index.md`
- Replace each of the three table cells that read `` `mnemom/decisions` (pending — see note) `` with a markdown link to the expected per-ADR URL, marked pending:
  - ADR-006: `[mnemom/decisions](https://github.com/mnemom/decisions/blob/main/adr-006-api-stability.md) *(pending — repo not yet created)*`
  - ADR-007: `[mnemom/decisions](https://github.com/mnemom/decisions/blob/main/adr-007-unified-yaml-agent-card.md) *(pending — repo not yet created)*`
  - ADR-048: `[mnemom/decisions](https://github.com/mnemom/decisions/blob/main/adr-048-triggering-governance-signal.md) *(pending — repo not yet created)*`
- Also update the closing sentence of the "Note on canonical-home links" section to say "update the pending links above" instead of "replace the 'pending' placeholders above with direct links", since they are now links already.
- Do not touch any other line in the file.

## Key Decisions & Rationale
**Lines of code to change:** ~12 (6 in capability.yaml, 5 in decisions/index.md)
**Risk level:** low
**Testing required:** Run the manifest `lint`, `typecheck`, `test`, and `build` verbs to confirm the restored `--locked` flags do not break anything in the local environment; confirm `uv sync --locked` exits 0 (the lockfile is already present and pinned).

## Verification
Execute every command to validate the patch is complete with zero regressions.

```bash
# From repo/worktree root: packages/python
cd packages/python && uv sync --locked --extra dev && uv run --locked --extra dev ruff check src/ tests/

# Typecheck (Python + TS)
cd packages/python && uv sync --locked --extra dev && uv run --locked --extra dev mypy src/ && cd ../typescript && npm ci && npm run typecheck

# Tests (Python + TS)
cd packages/python && uv sync --locked --extra dev && uv run --locked --extra dev pytest && cd ../typescript && npm ci && npm run test

# Build (Python + TS)
cd packages/python && uv sync --locked --extra dev && uv build && cd ../typescript && npm ci && npm run build

# Confirm markdown links exist in the table (not bare backtick strings)
grep -n 'mnemom/decisions' decisions/index.md
```

Expected: all uv commands succeed; `grep` output shows three lines containing `](https://github.com/mnemom/decisions/blob/main/adr-0` (proper markdown link syntax).

## Known Limitations / Follow-ups
- The UV_FROZEN=1 vs --locked compatibility question is explicitly out of scope here. If it is a real incompatibility in the ADW runner, it should be raised as a separate issue with its own acceptance criteria, rationale, and a smoke test — not bundled silently into an unrelated commit.
- The `mnemom/decisions` repo does not exist as of 2026-07-13; the links will 404 until it is created. This is expected and acknowledged in the file.
