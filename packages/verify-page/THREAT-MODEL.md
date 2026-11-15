# Threat model: verifier page, share page and `@mnemom/verify`

Surface owner: lane K-L07. Record task T6 (each lane writes a threat model for
its customer-facing surface; K-L09 runs the pentest, criterion K5.8).

## What the surface is

- `packages/verify`: the `@mnemom/verify` library. It checks Ed25519
  signatures on record statements and bundles against a JWKS the caller
  passes in, and makes no network calls.
- `packages/verify` bin, `mnemom-verify` (`npx @mnemom/verify <bundle>`,
  `src/cli.ts`, `src/cli-run.ts`): a command that reads a bundle from a file
  or stdin and calls the library. It makes one network call, a GET of the
  JWKS from `https://api.mnemom.ai/v1/.well-known/jwks.json` (or
  `--jwks-url`), and none with `--jwks <file>`.
- `packages/verify` `AAP-ConductRecord/v2` checks (`src/conduct-summary.ts`,
  spec `specs/aap-conductrecord-v2.md`): a conduct record for a long session
  carries counts, sha256 fold digests and the newest 32 checkpoint citations
  instead of every act and citation. The library checks the summary holds
  together, that each v2 build extends the build before it in the bundle, and,
  with `options.lists` (`mnemom-verify --lists <file>`), that an unsigned
  `AAP-RecordLists/v1` file folds to the signed digests. All offline.
- `packages/verify-page` (paste mode): a static page. The user pastes a
  statement or bundle and a JWKS, and the page shows a verdict.
- `packages/verify-page` (share mode, `VERIFIER_PAGE_MODE=true`): a static
  page. A signed share card arrives in the URL fragment `#card=...`, and the
  page draws only the lines `renderLines` returns for a card that verifies
  against the key set built into the page.

Neither page has a server side. Both are served as static files.

## Assets

1. The meaning of a verdict. A "Verified offline" result must be shown only
   for bytes Mnemom signed. For a summarised conduct record, also: a count is
   shown only when the signed summary holds together, a list is called
   "checked" only when both lists were supplied and fold to the signed
   digests, and an extension the bundle cannot show is "not checked", never
   silently proven.
2. The card's contents. A shared card may name a repo, a PR or a cost.
3. The visitor's browser.

## Trust boundaries

- URL fragment and pasted input: untrusted, attacker-controlled.
- JWKS: trusted only as the key set built into the page (share mode), or as
  the visitor chooses to trust it (paste mode).
- JWKS for the command: trusted as served over TLS by the cell's API host
  (default URL or `--jwks-url`), or as the user chooses to trust a saved file
  (`--jwks`).
- The static host: trusted to serve the built files unmodified.
- A lists file (`--lists`, `options.lists`): untrusted and unsigned. It is
  believed only as far as it folds to the digests of a statement that verified.

## Threats and controls

| # | Threat (STRIDE) | Control | Test |
|---|---|---|---|
| 1 | Spoofing: forged card shown as verified | Ed25519 check over canonical JSON, under strict RFC 8032 rules (`zip215: false`) so a small-order public key does not verify every message. A statement `alg`, when present, must be exactly `EdDSA` before any key lookup (`verify-record.ts` `verifyStatement`); a statement may omit `alg`. The key must be declared `alg: EdDSA`, `kty: OKP`, `crv: Ed25519` (`selectKey`), and its `kid` must be in the key set | verifier tests, tampered fixtures in `packages/verify/test/fixtures/record`, small-order forgery cases in `verify-record.test.ts` and `verify.test.ts` |
| 2 | Tampering: one field of a signed card altered | Signature over the whole canonical body minus `signature`; any change fails | tampered-fixture Playwright cases (K4.2) |
| 3 | Tampering: an attacker-supplied JWKS in share mode | `share.html` has no key input; share mode verifies only against the key set built into the page | No browser test. CI guard in `.github/workflows/verify-page.yml` (deployable build carries no fixture key, and is not the share page). Gap: pentest item |
| 4 | Information disclosure: card contents leak to a server | Card is in the fragment, which browsers do not send; CSP `connect-src 'none'`; page makes zero requests | Playwright counts non-file requests and asserts zero (K4.2) |
| 5 | Information disclosure: link-preview crawler reads the card | `og:image` / `twitter:image` are a generic image; crawlers do not run the fragment | `test/share-page.spec.ts` "the preview image is generic" |
| 6 | Elevation: script injection through card text | Text is written with `textContent` only (`src/share.ts`); CSP `script-src 'self'`, no inline script, `base-uri 'none'`, `form-action 'none'` | No test puts markup in a card field. CI greps `connect-src 'none'` only (`verify-page.yml`); `script-src`, `base-uri` and `form-action` are unchecked. Gap: pentest item |
| 7 | Denial of service: huge fragment hangs the tab | Fragment above the 64 KiB cap is refused before decoding (`src/share.ts`) | No test sends an oversized fragment. Gap: pentest item |
| 8 | Repudiation: a claim of a class the card may not carry (a money estimate, a trust claim) | claim-lint refuses the line before rendering; `renderLines` draws only lint-clean lines | `claim-lint.test.ts`, `render-estimate.test.ts` (K4.3, K4.4) |
| 9 | Supply chain: a malicious verifier build | Release tarball built in CI and attested with GitHub build provenance (`gh attestation verify`); npm publish via OIDC trusted publishing with provenance (A-K-009, A-K-012). The only non-OIDC version is the deprecated placeholder 0.6.2-bootstrap.0, published by hand to create the package. 0.6.2 and later publish only through `publish.yml` in the `production` environment, which needs a reviewer | Publish workflow; K5.4 gate |
| 10 | Stale keys: the built-in key snapshot misses a rotated key | Snapshot dated in `src/keys.ts`; a card signed by an unknown `kid` fails closed, never "verified" | verifier tests |
| 11 | Spoofing and information disclosure: the command's JWKS fetch. A network attacker serves their own key set so a forged bundle verifies, or learns that the user is verifying | One GET, of the JWKS only, never of the bundle: the default URL is `https://api.mnemom.ai/v1/.well-known/jwks.json`, a `--jwks-url` must be `https` (plain `http` only to localhost), and the command prints the URL it used. `--jwks <file>` makes no network call, for an air-gapped check against a key set saved beforehand. A fetch that fails, times out (15 s) or returns something other than a key set exits 2, never "valid" | `test/cli.test.ts`: `--jwks` with global `fetch` stubbed to throw, the default URL, `--jwks-url` scheme checks, fetch failures exit 2 |
| 12 | Spoofing: a forged bundle redraws the command's report. `typ` and `signing_key_id` reach the report as the bundle gives them, even when the statement fails, so control characters there (ESC sequences, a newline, a C1 CSI, a bidi override) could print a fake `valid` line and conceal the real reason and verdict | Everything the command prints that it did not write itself goes through `terminalSafe` (`src/cli-run.ts`): C0 controls, DEL, C1 controls, U+2028/U+2029 and the bidi controls become visible `\uXXXX` text. That covers bundle fields, the bundle and JWKS paths, the JWKS URL, and IO and `JSON.parse` error text (which quotes bundle bytes). `--json` output also escapes the DEL, C1, separator and bidi characters `JSON.stringify` leaves raw. Each statement stays one line and the verdict line is the last line printed, after the statements and after the note a valid result adds, so `tail -1` reads it | `test/cli.test.ts` "bundle text cannot drive the terminal": a kid with ESC and `\n` still gives one line per statement ending in `invalid:`, in-process and through `dist/cli.js`; "mnemom-verify: valid bundles" checks the verdict comes after the note on a valid result |
| 13 | Repudiation and tampering: a summarised conduct record (`AAP-ConductRecord/v2`) whose counts are trust-me numbers. A signed statement claims 45 checkpoints and 9 acts, but the bundle holds only the newest 32 citations, so a reader cannot see the rest | Counts are committed, not just stated: `checkpoints.digest` and `protection.acts_digest` are sha256 folds over every citation and act tuple, and `digest = fold(tail_from_digest, tail)` is recomputed for every v2 statement, so the citations shown are the true end of the signed list. `conductSummaryReasons` fails the statement (`summary_inconsistent`) when counts, bound and card-hash counts, the tail, the 32 and 64 entry caps, the seed rules or `lists_as_of <= built_at` disagree. Anything outside the tail is proven only by `--lists`/`options.lists`, which recomputes every count, the tail, the groups and both digests from the full lists (`summary_list_mismatch` on any difference). The flag `summarized` says, with a count, how much of the record is digest-only. A lists check proves only the parts it was given: a part no lists object carried is `not_supplied`, and the CLI prints `lists: checked` only when both parts were supplied and fold to the signed digests (else per part, e.g. `checkpoints checked, acts not supplied`). `checkConductLists` verifies the statement's signature first, so a fabricated statement with lists that agree with it is `statement_invalid`. Lists can be split across pages and files and are folded incrementally, so a list of any length can be checked. Between builds, `extension not checked` (with a count) marks an extension the bundle cannot show, so "unknown" never reads as "proven" | `test/conduct-summary.test.ts`, `test/conduct-record-v2.test.ts` "checkConductLists proves counts only for a statement that verifies", `test/cli.test.ts` "--lists with one part" and "--lists given several times", v2 cases in `tampered.json` and `golden-lists-v2.json`, the v2 Playwright case in `test/verify-page.spec.ts` |
| 14 | Information disclosure: content or identifiers ride in the new v2 fields. The no-content rule (no prompts, tool inputs or outputs, free text) and public decision certificates | The whole statement is closed, not only `protection` and `checkpoints`: the top-level keys are exactly the format's (`previous_digest` and `lineage_key` required), `goal`, `cost`, `people`, `runner` and `door2` are held to the producer's no-content allowlist, every line is a fixed key in its v1 wording or one `protection.group.<i>` per line-bearing `by` row (at most 72), and canonical JSON over 262 144 bytes fails. The summary blocks are exact key sets, integers, lowercase hex digests, enums, tool names matching `^[A-Za-z0-9_.:-]{1,128}$`, citation fields matching their ID and base64 shapes. An extra key anywhere, a free-text value or an old v1 list under another key fails the statement (`summary_inconsistent`). Acts are cited by `decision_ref = sha256("AAP-DecisionRef/v1\n" + id)`, never the raw decision id, so a bundle committed to a repo cannot be joined to a public decision certificate without the org's lists file | `test/conduct-summary.test.ts` "tuple shapes", "closes the statement", "closes the lines" and the byte-ceiling case; tampered `v2-content-in-citation`, `v2-content-as-tool-name`, `v2-extra-top-level-key`, `v2-old-lists-under-another-key`, `v2-content-in-goal`, `v2-free-text-line`, `v2-group-line-out-of-range`, `v2-no-previous-digest` |
| 15 | Spoofing: a lists file is read as an accusation. A recompute mismatch, or a `checkpoints changed/removed since previous build` flag, is presented as proof Mnemom lied | The reason and flags say "not the list that was signed" only; the CLI help, README and spec §14 name the innocent causes (retention, deletion, backfill, a row committed late). The extension check emits flags, never a reason, and a lists mismatch is a reason only because the caller asked for the check | `test/conduct-summary.test.ts` "extensionFlags", `test/cli.test.ts` "help explains what a summarised record does and does not prove" |

## Out of scope here

- Key custody and signing (mnemom-api).
- The static host's TLS and headers beyond the in-page CSP (hosting lane).
  Web Crypto needs a secure context, so plain `http://` shows an error.

## Pentest ask (K5.8)

On the test-cell host: forged and tampered cards in the fragment, oversized
fragments, script in every text field, a share link with an attacker JWKS, and
a request count with devtools open.
