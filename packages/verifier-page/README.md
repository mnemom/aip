# AIP record verifier page

A static page that verifies AAP record statements (`AAP-ConductRecord/v1`,
`AAP-PRRecord/v1`, `AAP-Outcome/v1`, `AAP-ShareCard/v1`) and record bundles
with `@mnemom/aip-verifier`, in the browser, with no network call. The
Content-Security-Policy has `connect-src 'none'`, so the page cannot phone
home even by mistake.

The key set box is prefilled with a snapshot of the Mnemom signing keys
published at `https://api.mnemom.ai/v1/.well-known/jwks.json`
(`src/keys.ts`, dated in the file). Paste another JWKS to verify against
other keys.

```sh
npm ci
npm run build          # dist/ is the whole site: index.html, styles.css, app.js
npm test               # Playwright, Chromium, offline, file:// (K4.2)
npm run serve          # look at dist/ at http://localhost:8787/
```

The Playwright test opens `dist/index.html` from `file://` in an offline
context, aborts and counts every non-file request, verifies the golden
bundle and every tampered fixture from `packages/verifier/test/fixtures/record`,
and asserts the request count is zero. `.github/workflows/verifier-page.yml`
runs it on every pull request.

Host it over `https://` (or open it from `localhost` or a local file).
Browsers expose Web Crypto (`crypto.subtle`), which the Ed25519 check
needs, only in a secure context; over plain `http://` the page shows an
error instead of a verdict.
