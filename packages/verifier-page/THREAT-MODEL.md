# Threat model: verifier page, share page and `@mnemom/aip-verifier`

Surface owner: lane K-L07. Record task T6 (each lane writes a threat model for
its customer-facing surface; K-L09 runs the pentest, criterion K5.8).

## What the surface is

- `packages/verifier`: the `@mnemom/aip-verifier` library. It checks Ed25519
  signatures on record statements and bundles against a JWKS the caller
  passes in, and makes no network calls.
- `packages/verifier-page` (paste mode): a static page. The user pastes a
  statement or bundle and a JWKS, and the page shows a verdict.
- `packages/verifier-page` (share mode, `VERIFIER_PAGE_MODE=true`): a static
  page. A signed share card arrives in the URL fragment `#card=...`, and the
  page draws only the lines `renderLines` returns for a card that verifies
  against the key set built into the page.

Neither page has a server side. Both are served as static files.

## Assets

1. The meaning of a verdict. A "Verified offline" result must be shown only
   for bytes Mnemom signed.
2. The card's contents. A shared card may name a repo, a PR or a cost.
3. The visitor's browser.

## Trust boundaries

- URL fragment and pasted input: untrusted, attacker-controlled.
- JWKS: trusted only as the key set built into the page (share mode), or as
  the visitor chooses to trust it (paste mode).
- The static host: trusted to serve the built files unmodified.

## Threats and controls

| # | Threat (STRIDE) | Control | Test |
|---|---|---|---|
| 1 | Spoofing: forged card shown as verified | Ed25519 check over canonical JSON; `alg` must be exactly `EdDSA` before any key lookup; `kid` must be in the key set | verifier tests, tampered fixtures in `packages/verifier/test/fixtures/record` |
| 2 | Tampering: one field of a signed card altered | Signature over the whole canonical body minus `signature`; any change fails | tampered-fixture Playwright cases (K4.2) |
| 3 | Tampering: an attacker-supplied JWKS in share mode | Share mode ignores any key set but the one built into the page | share-page browser test |
| 4 | Information disclosure: card contents leak to a server | Card is in the fragment, which browsers do not send; CSP `connect-src 'none'`; page makes zero requests | Playwright counts non-file requests and asserts zero (K4.2) |
| 5 | Information disclosure: link-preview crawler reads the card | `og:image` / `twitter:image` are a generic image; crawlers do not run the fragment | README "Share page" |
| 6 | Elevation: script injection through card text | Text is written with `textContent` only; CSP `script-src 'self'`, no inline script, `base-uri 'none'`, `form-action 'none'` | claim-lint and share-card tests (K4.3) |
| 7 | Denial of service: huge fragment hangs the tab | Fragment above the size cap is refused before decoding (`src/share.ts`) | share-page test |
| 8 | Repudiation: a claim of a class the card may not carry (a money estimate, a trust claim) | claim-lint refuses the line before rendering; `renderLines` draws only lint-clean lines | `claim-lint.test.ts`, `render-estimate.test.ts` (K4.3, K4.4) |
| 9 | Supply chain: a malicious verifier build | Release tarball built in CI and attested with GitHub build provenance (`gh attestation verify`); npm publish via OIDC trusted publishing with provenance, no stored token (A-K-009, A-K-012) | Publish workflow; K5.4 gate |
| 10 | Stale keys: the built-in key snapshot misses a rotated key | Snapshot dated in `src/keys.ts`; a card signed by an unknown `kid` fails closed, never "verified" | verifier tests |

## Out of scope here

- Key custody and signing (mnemom-api).
- The static host's TLS and headers beyond the in-page CSP (hosting lane).
  Web Crypto needs a secure context, so plain `http://` shows an error.

## Pentest ask (K5.8)

On the test-cell host: forged and tampered cards in the fragment, oversized
fragments, script in every text field, a share link with an attacker JWKS, and
a request count with devtools open.
