# Plan — aip: re-verify ZTE onboarding artifacts (issue #117)

**ADW ID:** ee3f4072
**Issue:** mnemom/aip #117
**Branch:** chore-issue-117-adw-ee3f4072-aip-re-verify-zte-onboarding-artifacts-l

## Objective

Re-verify that all four ZTE onboarding artifacts on `mnemom/aip` remain complete and correct as of 2026-09-14, following three consecutive dispatch failures (aip#85/#87 history). Confirm nothing has drifted since those PRs and ensure aip passes on day-0 of the MNE-5930 completeness gate.

## Artifacts Verified

### 1. `.github/workflows/adw-zte.yml`
- Verified byte-identical to upstream mnemom-adw template.
- No drift detected.

### 2. ADW repo labels
Verified via `gh label list --repo mnemom/aip`. All twelve `adw:` labels are present:

| Label | Description | Color |
|---|---|---|
| `adw:activation-pending` | ADW: onboarding/activation checklist (human to-do) | #FBCA04 |
| `adw:awaiting-checks` | ADW: ship parked until required checks complete | #0E8A16 |
| `adw:design-gate` | ADW design-gate command | #0075ca |
| `adw:design-gate-pending` | ADW design-gate in progress | #bfd4f2 |
| `adw:freeze` | ADW: per-issue kill-switch — never worked on | #D93F0B |
| `adw:merge-stalled` | ADW: Mergify queue stalled — recoverable, stays queue-eligible | #FBCA04 |
| `adw:needs-human` | ADW: run aborted to a human (worker STOP signal) | #B60205 |
| `adw:rebase` | ADW: rebase the open PR branch (sync-only) | #5319e7 |
| `adw:sensitive-merge` | ADW: shipped green — touches CI-workflow/action files, merge is human-gated | #0052CC |
| `adw:ship` | ADW: ship an existing PR (ship-only) | #5319e7 |
| `adw:sync` | ADW: re-sync the open PR branch (sync-only) | #5319e7 |
| `adw:zte` | ADW: run the full worker pipeline | #5319e7 |

Note: `adw:design-gate` and `adw:design-gate-pending` are used by `adw-zte.yml` (line 558) to find paused design-gate issues. Both are present and correctly configured.

### 3. `ANTHROPIC_API_KEY` repo-level secret
- Confirmed present as a repo-level Actions secret.

### 4. `.mnemom/capability.yaml`
- `merge_strategy: external` — present and correct.
- `required_checks`: `["Python SDK (3.10)", "Python SDK (3.11)", "Python SDK (3.12)", "TypeScript SDK"]` — matches branch-protection contexts exactly. CodeQL intentionally excluded (non-driveable security gate, consistent with aip#87 precedent).
- Verb commands (`lint`, `typecheck`, `test`, `build`) — all present and use `uv run --locked` / `uv sync --locked` correctly.
- `ux_path_globs: []` — correct (no UX surfaces in an SDK library).

## Conclusion

All four onboarding artifacts verified complete with no drift. aip is ready for the MNE-5930 completeness gate on day-0.
