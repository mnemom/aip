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

## Share page (`VERIFIER_PAGE_MODE`)

Built with `VERIFIER_PAGE_MODE=true` (exactly that string; any other value
builds the paste verifier above), the page is a share page instead. The
signed card is in the URL fragment, `#card=<base64url JSON>`; browsers never
send a fragment to a server and the CSP blocks the page from sending it
anywhere. The page verifies it with `renderLines` against the key set built
into the page and draws only the lines `renderLines` returns. A card that
fails shows an error and none of the card's text. `og:image` and `twitter:image` are the generic
`preview.png` (source `preview.svg`): no numbers. Crawlers need an absolute URL,
so the build writes one: `SHARE_OG_IMAGE_URL` (https, no query/fragment;
default `https://www.mnemom.ai/share/preview.png`). A link preview crawler
never sees the fragment, so it could not show the card anyway.

```sh
npm run build:share   # dist-share/, with the fixture key set, for the tests only
```

`VERIFIER_PAGE_TEST_JWKS` swaps in a test key set; never set it for a build
you deploy (CI checks `dist/` for the test key).
