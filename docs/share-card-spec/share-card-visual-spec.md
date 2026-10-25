# Signed share card: visual spec (MNE-9118)

Status: defaults for review. Owner: Shraddha. Parent: MNE-9014. Reviewer: Keith (open questions at the end; not contacted).
Checked against: `renderLines` at aip main `e417669` (`packages/verifier/src/render-lines.ts`, flag `AIP_RENDER_LINES=1`) run on the repo fixtures, and the live `/share` page (mnemom-website PR 3042, `client/pages/share/SharePage.tsx`).
Mock of every state, light and dark: [mock.html](./mock.html) (tokens copied from the website `global.css`).

## 1. Problem

A stranger must read a signed card correctly in five seconds. It goes wrong three ways: a number looks like more than it proves, a revert is hidden, or a failed or empty card looks like a normal one. Claim-lint already bans estimates and savings on cards; the visual spec must not reintroduce them (no figure on a card that `renderLines` did not return).

## 2. How we solve it

One rule: the page draws only what `renderLines` returns, in the order returned. It never formats, rounds, reorders or adds a number. Verification failure draws the invalid state and nothing from the card.

**Layout** (one column, 640 px max, `<article>`):
1. Header: "Signed work record", period text, chip "Verified offline" (check icon + words).
2. Lines: one row per line, `text` at 24 px semibold, tabular numerals. A `verdict` line adds a muted 14 px second line from `coverage`.
3. "What this card does not prove": boxed, neutral (not red), fixed page-owned copy, 4 bullets, always shown, not collapsible. Same text on every card.
4. Footer: signing key id, card id, "Verify yourself" link (44 px target).

**Revert prominence.** A line with `revert: true` has the same size as every other line, a 4 px amber left rule, tinted row, and the word "Reverted" with an arrow-back icon above the text. Never colour alone, never smaller or greyer, never behind "show more". On a period card the revert line is first (see open question 3); renderLines already guarantees one is present, including "0 of N".

**Empty.** No lines and no failure: "No recorded work in this period" in place of the lines, the "does not prove" panel stays, no zeros. The "Verified offline" chip appears only when the verifier says verified (open question 5).

**Invalid / tampered.** Red-outlined block, cross icon, "This card could not be verified. Nothing on it can be trusted.", up to 3 plain reasons, key id if known. No lines, no numbers, no period; title "Unverified card - Mnemom". No card in the fragment, or the flag off, is a plain 404, not this state.

**Offline.** Identical to valid: verification and render make no network request. The only remote thing is the "Verify yourself" link.

**Theme.** Follows `prefers-color-scheme`, with a persisted toggle. Components use tokens only. Dark is #18181b surface on #09090b page, text #fafafa (never pure white on pure black).

### Real `renderLines` output on the fixtures (flag on)

| Fixture | Result |
|---|---|
| statement `golden-share-card.json` | `ok`, lines: measured "3 of 4 commits from recorded sessions"; verdict "On goal in 5 of 6 judged turns" coverage `{judged:6,total:12}`; outcome "Accepted, no revert in 7 days" with `revert:true` |
| bundle + 1 reverted + 1 accepted outcome, `period_card` | same 3 lines, plus outcome "1 of 2 changes reverted" `revert:true` (last) |
| numeric `valid.json` | measured "Changes reviewed: 42", "Checks passed: 40" |
| numeric `period-revert.json`, `period_card` | those two, plus outcome "Changes reverted: 2" `revert:true` (last) |
| tampered statement / numeric | `ok:false`, `lines:[]`, reasons `["not_verifiable","0:signature_invalid"]` / `["not_verifiable","signature: verification failed"]` |
| numeric `identifying-repo.json` | `ok:false`, reasons `["identifying_field","lines[0]: identifying field \"repo\" is not allowed"]` |
| period card, no outcomes | `ok:false`, reasons `["period_card_without_outcomes"]` |
| flag off | `ok:false`, reasons `["render_lines_disabled"]` |

### UX before and after

| | Before (live `/share` today, fixture verifier) | After (this spec) |
|---|---|---|
| Lines | Adapter expects `{class, text, coverage: string, kind}`; real output has no `kind`, `coverage` is `{judged,total}` | Page maps real output: revert style from `revert`, coverage line from a fixed page template over the two integers |
| Revert | Styled by `kind === "revert"` (never set by real output) | Styled by `revert === true`, first on a period card |
| Invalid reasons | Page expects codes `bad_signature`...; real reasons are `not_verifiable` + free detail | Fixed mapping table (open question 4) |
| Empty | Chip says "Verified offline" with zero lines | Chip only when verifier says verified |
| Meta | Optional `cardId`, `signingKeyId`, `periodText`; real output returns none | Footer and period hidden until returned; nothing is guessed |

## 3. Additional requirements

**Accessibility (WCAG 2.2 AA).** Contrast computed from the website tokens (script reproducible with the hex values below):

| Pair | Light | Dark | Need |
|---|---|---|---|
| text on surface | 19.90 | 16.97 | 4.5 |
| muted on surface | 7.73 | 6.91 | 4.5 |
| muted on does-not-prove box | 7.03 | 5.81 | 4.5 |
| "Reverted" label on revert row | 8.60 | 9.99 | 4.5 |
| text on revert row | 18.26 | 13.80 | 4.5 |
| revert rule vs surface | 3.19 | 8.25 | 3 |
| check icon / chip border vs surface | 5.47 | 9.52 | 3 |
| invalid icon / border vs surface | 6.47 | 7.68 | 3 |

Light: surface #ffffff, text #09090b, muted #52525b, rule #d97706, label #7c2d12 on #fcf4eb, ok #0f766e, bad #b91c1c. Dark: surface #18181b, text #fafafa, muted #a1a1aa, rule #f59e0b, label #fcd34d on #332819, ok #2dd4bf, bad #fb8a8a. The card border (#e4e4e7 on #fafafa, 1.22) is decorative: every piece of content is text or a 3:1 element, so no information depends on it.

Also: status never colour-only (icon + word on verified, reverted, invalid). Landmarks `<main>`, `<article aria-labelledby>`; lines are a labelled list; chip is `role="status"`, invalid block `role="alert"`. Tab order equals visual order, 2 px focus ring, 44 px targets. No animation. 200% zoom and 320 px width without horizontal scroll. Preview image alt text restates the lines or says "Unverified card".

**No estimates.** No figure outside `renderLines` text and `coverage` integers. The coverage template is fixed words around two integers returned by the verifier, with no arithmetic or percentage.

**Tests.** Snapshot per state (valid, period with revert, empty, invalid) in both themes, plus an axe check; the live page already has Playwright coverage in `e2e/share-page`.

## 4. Open questions for Keith

Fields the spec needs that `renderLines` does not provide or gets wrong. Defaults in brackets are what the page does until answered.

1. **Coverage as text.** `coverage` is `{judged,total}`, the page wants a string. [Page draws "6 of 12 turns judged" from a fixed template.] OK, or return text?
2. **No `kind`.** Real lines carry `class` and optional `revert`, not `measured|outcome|verdict|revert` as in MNE-9014. [Page uses `revert`.] Confirm `revert` is the contract.
3. **Revert placement.** Derived "N of M changes reverted" is appended last, with no link to the line it relates to. Spec wants it first on a period card. [Page does not reorder, so it shows last.] Emit it first?
4. **Reason codes.** Reasons are `not_verifiable` plus free detail (`0:signature_invalid`, `signature: verification failed`). Page copy keys on stable codes (`bad_signature`, `bad_shape`, `wrong_typ`, `identifying_field`, `unknown_key`). [Unknown strings show the generic line.] Need stable codes.
5. **Verified signal and empty.** `no_lines` returns `ok:false`, same as a failure, though it is reached only after verification on the statement path. Spec wants "verified, empty" distinct. [Empty state without the chip.] Return an explicit `verified: boolean`?
6. **Meta.** Footer and header need `signing_key_id`, `card_id` (numeric card only), period. Statements carry `signing_key_id` and `built_at`; none are returned. [Hidden.] Return them as pre-rendered text, including the timezone of the period.
7. **False revert flag (defect).** `golden-share-card.json` line "Accepted, no revert in 7 days" gets `revert:true` because the test is `/\brevert(s|ed)?\b/` on text. The page would draw the amber "Reverted" treatment on a clean outcome. Derive the flag from the signed outcome, not the text.
8. **Surface.** The caller picks `share_card` or `period_card`; the page cannot tell which from a card. Is there a field, or does the link carry it?
9. **Does-not-prove copy.** Kept page-owned and fixed. Confirm claim-lint expects nothing like it on the card.

Keith's AC (no needed field missing) is not confirmed: items 1 to 9 are the list to confirm.
