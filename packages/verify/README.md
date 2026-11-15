# @mnemom/verify

Offline verifier for Mnemom signed records and AIP integrity certificates. It checks Ed25519 signatures, digest chains and Merkle proofs against keys you supply. The library makes no network calls. The `mnemom-verify` command checks a record bundle from your terminal, with no code to write.

## Install

```sh
npm install @mnemom/verify
```

The package ships ESM and CommonJS builds with TypeScript types. It needs Node.js 18 or later and also runs in browsers and Workers.

## Verify a record bundle from the command line

A pull request with a Mnemom record carries its signed bundle at `.mnemom/records/<pr>.json`. Check it with one command:

```sh
npx @mnemom/verify .mnemom/records/3238.json
```

```text
JWKS: https://api.mnemom.ai/v1/.well-known/jwks.json (fetched)
[0] AAP-ConductRecord/v1  aap-prod-2026-05-23  ok
[1] AAP-PRRecord/v1  aap-prod-2026-05-23  ok  (2 of 2 commits from recorded sessions)
note: this proves Mnemom signed these statements, unchanged, with their chain and links intact.
      It does not prove the code is correct or that every commit came from a recorded session.
valid, with flags: card hash not recorded (x27)
```

The first line names the key set the command used. Then there is one line per statement: its `typ`, its `signing_key_id`, and `ok` or the reasons it failed. A PR record line also shows how many of the pull request's commits came from recorded sessions. A valid result adds a two-line note on what the check does not prove. The verdict is always the last line, so `tail -1` reads it. It is one of:

- `valid`: every statement and every bundle check holds.
- `valid, with flags: <flags>`: valid, with notes that weaken a binding but never change the verdict. Every checkpoint in today's bundles carries `card hash not recorded`. See [Reason codes](#reason-codes) for the flags.
- `invalid: <reasons>`: the reasons, as listed under [Reason codes](#reason-codes). The command adds one reason of its own, `no_statements`, for a bundle whose `statements` array is empty: nothing was checked, so it does not pass. The library `verify()` still returns `valid: true` for such a bundle.

```text
npx @mnemom/verify <bundle.json | -> [--jwks <file>] [--jwks-url <url>] [--expected-head-sha <sha>] [--lists <file>]... [--json]
```

| Option | What it does |
|---|---|
| `<bundle.json>` or `-` | The bundle (or one signed statement) to check. `-` reads it from stdin. |
| `--jwks <file>` | Verify against a JWKS saved on disk. The command makes no network call. |
| `--jwks-url <url>` | Fetch the JWKS from this URL instead of the default. It must be `https` (plain `http` only to localhost). |
| `--expected-head-sha <sha>` | Fail with `head_mismatch` or `head_unbound` unless the latest PR record names this head commit. |
| `--lists <file>` | Check an `AAP-RecordLists/v1` file (one object or an array) against the `AAP-ConductRecord/v2` statements it names. Give it again for more files (pages). See [Summarized records and --lists](#summarized-records-and---lists). Makes no network call. |
| `--json` | Print the result (`valid`, `reasons`, `flags`, `statements`, `verified_at`) as JSON on stdout. It is the library result, except that an empty bundle has `valid: false` and the reason `no_statements`. The JWKS line goes to stderr. |

Exit codes: `0` valid (flags included), `1` invalid, `2` a usage error, a file that cannot be read or is not JSON, or a JWKS fetch that failed.

Bundles of `AAP-ConductRecord/v1` builds can reach about 2 MB, since a v1 build of a long session lists every checkpoint. The command reads the whole file before it checks it. A long session's builds are `AAP-ConductRecord/v2` instead, which stays under 128 KB each.

### Where the keys come from

Mnemom publishes its signing keys as a JWKS at `GET /v1/.well-known/jwks.json` on the cell's API host. For the production cell that is:

```text
https://api.mnemom.ai/v1/.well-known/jwks.json
```

Without `--jwks`, the command fetches that URL, makes no other request and prints the URL it used. For a bundle from another cell, pass that cell's URL with `--jwks-url`.

### Verify offline

To check a bundle with no network at all, install the package and save the key set first, while you are online:

```sh
npm i @mnemom/verify
curl -o jwks.json https://api.mnemom.ai/v1/.well-known/jwks.json
```

Then, offline:

```sh
npx @mnemom/verify .mnemom/records/3238.json --jwks jwks.json
```

With `--jwks` the command reads keys only from that file. `npx` runs the installed copy. Without the install, `npx` downloads the package from npm first.

A key set you saved is only as good as the place you got it from. Fetch it over https from the cell's API host, and fetch it again after a key rotation: a statement signed by a key your file does not hold fails with `key_not_found`.

## What this check does not prove

A `valid` verdict proves that Mnemom signed these statements, that none of them changed after signing, and that the chain between the records and the links between the statements hold.

It does not prove:

- that the code is correct. The record says how the work was done, not whether the result is right.
- that every commit came from a recorded session. Read the "N of M commits from recorded sessions" on the PR record line. A commit outside a recorded session has no conduct record behind it.
- that protection caught everything. A protection verdict covers what the checks saw, nothing more.
- that the goal was met beyond the judged turns. A goal verdict covers the turns that were judged, not the whole session.
- for an `AAP-ConductRecord/v2` record, the earlier checkpoint citations and the single protection acts. The bundle proves the signed counts and digests; only `--lists` proves the lists behind them.

## Verify a record in code

`verify(input, jwks, options?)` takes one signed statement or a record bundle, plus the published JWKS. It returns a result and never throws on bad input.

```ts
import { verify } from "@mnemom/verify"

const jwks = JSON.parse(publishedJwksText) // fetched and pinned by you, not by the verifier
const result = await verify(bundle, jwks)

if (!result.valid) console.error(result.reasons)
for (const f of result.flags) console.warn(`${f.flag}: ${f.subject}`)
```

The result holds:

- `valid`: true only when every statement verifies and every bundle check holds.
- `reasons`: why the input failed. Statement reasons carry the statement index as a prefix, for example `0:signature_invalid`. Bundle reasons have no prefix.
- `flags`: notes that weaken a binding but never change `valid`.
- `statements`: one result per statement, with its `typ`, `digest`, `signing_key_id`, `reasons` and `flags`.
- `verified_at`: when the check ran.

### Statement types

Six signed statement types are accepted, listed in `STATEMENT_TYPES`:

| `typ` | What it records |
|---|---|
| `AAP-ConductRecord/v1` | One build of a recorded session: goal, cost, messages from the person, compactions and checkpoints |
| `AAP-ConductRecord/v2` | The same, for a long session: protection acts as grouped counts and checkpoints as counts plus the newest 32 citations, each list committed by a digest. See [Summarized records and --lists](#summarized-records-and---lists) |
| `AAP-PRRecord/v1` | A pull request: its head commit, the conduct records behind it and how many commits they bind |
| `AAP-Outcome/v1` | What happened to a merged pull request after a fixed window |
| `AAP-ShareCard/v1` | The lines a share card may show, each tied to a signed source |
| `AAP-TransparencyRoot/v1` | A signed transparency log root: `tree_size`, `root_hash` and `published_at` |

Each statement is signed with Ed25519 over its canonical JSON minus `signature`. The key is looked up by `signing_key_id` in the JWKS. A statement that names an `alg` other than `EdDSA` fails before any key lookup, and a key is used only when it is an Ed25519 OKP key declared `EdDSA`.

A bundle is `{ "typ": "AAP-RecordBundle/v1", "statements": [...] }`.

### Check one statement

`verifyStatement(statement, jwks, options)` checks a single statement. It takes two optional checks, with the same reason strings and order as `verifyStatement` in `@mnemom/sdk`:

```ts
import { verifyStatement } from "@mnemom/verify"

const result = await verifyStatement(statement, jwks, {
  expectedTyp: "AAP-TransparencyRoot/v1", // optional
  expectedDigest: "<64 hex digest>", // optional
})
```

- `expectedTyp` refuses a statement of any other type with `typ_mismatch`, before any key lookup. A value outside `STATEMENT_TYPES` fails with `unsupported_expected_typ`.
- `expectedDigest` is compared with the statement digest after the signature check. Any other value fails with `digest_mismatch`.

### Bundle chain and head checks

Inside a bundle the verifier follows each record's `previous_digest` chain. A statement whose link does not hold fails with `chain_broken`. That covers a missing predecessor in the middle of a chain, a predecessor of another type or lineage, a fork, and a statement whose `prev_digest` and `previous_digest` aliases disagree. When the first statement of a chain names a predecessor the bundle does not hold, the verifier reports the flag `lineage truncated` instead, because retention removes old builds.

Pass `expected_head_sha` to bind the input to a pull request head:

```ts
const result = await verify(bundle, jwks, { expected_head_sha: "4085847847e146869092d3948ed7a7136313ff6c" })
```

- `head_mismatch`: the latest verified PR record names another head.
- `head_unbound`: no verified PR record in the input names a head.
- `expected_head_malformed`: the value is not a lowercase hex commit id of 40 or 64 characters. Nothing else is checked.

A bare statement is checked on its own. Chain checks apply only to bundles.

`AAP-ConductRecord/v1` and `/v2` are one chain: a lineage's builds may move from v1 to v2 (and back, after a writer rollback) and the link still holds.

### Summarized records and --lists

A v1 conduct record lists every protection act and every checkpoint citation, so it grows with the session. For a long session Mnemom signs `AAP-ConductRecord/v2` instead (normative spec: [`specs/aap-conductrecord-v2.md`](../../specs/aap-conductrecord-v2.md)). It means the same as v1, except:

- `protection` holds `acts_total`, `by` (at most 64 rows of `{mode, verdict, tool_name, count}`), `tools_folded`, `tool_names_withheld` and `acts_digest`.
- `checkpoints` holds `count`, `bound_count`, `card_hash_count`, `digest`, `tail_from_digest` and `tail`, the newest 32 citations in full.
- `lists_as_of` (`built_at` minus 5 s) is the cut-off for both lists.

Each digest is a sha256 fold over the list in order:

```text
fold(h0, [t1..tn]):  h_i = SHA-256( h_{i-1} || UTF-8(canonicalJson(t_i)) )   (h as 32 raw bytes, result lowercase hex)
checkpoints.digest   = fold(SHA-256("AAP-ConductRecord/v2/checkpoints"), every citation)
protection.acts_digest = fold(SHA-256("AAP-ConductRecord/v2/acts"), every act tuple)
digest               = fold(tail_from_digest, tail)
```

A citation tuple has exactly `checkpoint_id`, `combined_commitment`, `commitment_signature`, `commitment_key_id` and `card_hash` (a v1 citation's shape). An act tuple has exactly `decision_ref`, `mode`, `tool_name`, `tool_withheld` and `verdict`, where `decision_ref = sha256("AAP-DecisionRef/v1\n" + lowercase decision id)`: a bundle never carries a raw decision id. Test vectors: [`schemas/aap-conductrecord-v2.vectors.json`](../../schemas/aap-conductrecord-v2.vectors.json). `fold`, `decisionRef`, `citationFromRow`, `actFromRow`, `groupActCounts` and `groupActs` are exported, and the producer uses the same code.

What the verifier checks:

- On every v2 statement: the statement holds together (`summary_inconsistent` otherwise). Counts add up, the tail is at most 32 citations and folds from `tail_from_digest` to `digest`, `by` has at most 64 rows summing to `acts_total` in strict output order, `lists_as_of <= built_at`. The whole statement is closed: no key outside the format, `previous_digest` present, the v1-shaped blocks held to the producer's no-content allowlist, every line in its fixed v1 wording (one group line per line-bearing `by` row, at most 72 lines), and at most 262 144 bytes of canonical JSON. A summary digest that is not 64 lowercase hex is `digest_malformed`.
- In a bundle: each conduct build next to a v2 build is checked to extend the build before it. When the earlier build's citations end inside the new tail, the new tail must fold to the earlier digest (a v1 after a v2 must start with the v2's citations). Otherwise the verifier flags `checkpoints changed since previous build` or `checkpoints removed since previous build`. When the bundle cannot show it (more citations were added than the tail holds, or the new build was cut off earlier), it flags `extension not checked` with the count of citations it could not see. These are flags, never reasons.
- With `--lists <file>` (repeatable) or `verify(input, jwks, { lists })`: `AAP-RecordLists/v1` objects hold the full lists behind a v2 statement, split across as many objects (pages) and files as needed; objects naming the same statement continue its lists in order. The verifier folds each list incrementally and recomputes every count, the tail, the groups and both digests. Any difference fails the input with the bundle-level reason `summary_list_mismatch`, and `lists_checked` says which part failed and why; a part no object carried is `not_supplied`. The CLI says `lists: checked` only when both parts were supplied and passed.

```ts
import { checkConductLists } from "@mnemom/verify";

// Verifies the statement's signature first: a statement nobody signed proves nothing.
const r = await checkConductLists(statement, pages, jwks);
// { ok: true } only when both lists were supplied and fold to the signed digests.
```

The bundle alone proves Mnemom signed the counts, groups and digests, that the citations shown are the true end of the signed list, and that the arithmetic holds. It does not show the citations before the tail or the single acts; only a lists file proves those. A lists mismatch, or a `changed`/`removed` flag, is not proof of tampering: retention or a deletion, a backfill of a card hash or a commitment, and a row committed more than 5 s late all change a list. A v2 record drops act order, turn numbers and the names of tools folded by the 64-row cap.

### Reason codes

`REASONS` lists every stable reason string:

| Code | Meaning |
|---|---|
| `not_an_object` | The statement is not a JSON object |
| `unknown_typ` | `typ` is not one of the six statement types |
| `unsupported_expected_typ` | `expectedTyp` is not one of the six statement types |
| `typ_mismatch` | The statement is not of the `expectedTyp` type |
| `unsupported_alg` | The statement names an `alg` other than `EdDSA` |
| `signing_key_id_missing` | The statement names no key |
| `signature_missing` | The statement has no signature |
| `signature_malformed` | The signature is not unpadded base64url of 64 bytes |
| `key_not_found` | The JWKS has no key with that id |
| `key_not_ed25519` | The key is not an Ed25519 OKP key declared `EdDSA` |
| `signature_invalid` | The signature does not match the statement |
| `digest_mismatch` | The statement digest is not `expectedDigest` |
| `bundle_not_an_object` | The input is not a JSON object |
| `bundle_unknown_typ` | The bundle `typ` is not `AAP-RecordBundle/v1` |
| `bundle_statements_missing` | The bundle has no `statements` array |
| `digest_malformed` | A linked digest, or a v2 summary digest, is not 64 lowercase hex characters |
| `linked_statement_wrong_typ` | A link points at a statement of the wrong type |
| `card_line_class_not_allowed` | A card line has a class other than measured, outcome or verdict |
| `card_verdict_without_coverage` | A verdict line carries no coverage |
| `chain_broken` | The record chain does not hold inside the bundle |
| `head_mismatch` | The latest PR record names another head |
| `head_unbound` | No PR record names a head |
| `expected_head_malformed` | `expected_head_sha` is not a valid commit id |
| `summary_inconsistent` | An `AAP-ConductRecord/v2` summary does not hold together |
| `summary_list_mismatch` | A lists file does not fold to the digests of the v2 statement it names (bundle-level, only with `lists`) |

`FLAGS` lists the flags: `card hash not recorded`, `card not bound`, `linked statement not in bundle`, `lineage truncated`, `summarized`, `checkpoints removed since previous build`, `checkpoints changed since previous build` and `extension not checked`. On a v2 statement a flag carries `count`, how many items it covers (for example 13 citations not in the bundle in full); the CLI adds the counts up.

## Verify an integrity certificate

`verifyCertificate(certificate, options)` checks an AIP integrity certificate against a trusted Ed25519 public key.

```ts
import { verifyCertificate } from "@mnemom/verify"

const result = await verifyCertificate(certificate, {
  publicKey: "<hex public key>",
  merkleRoot: "<hex root>", // optional
})
```

It checks the signature and the chain hash. It checks the Merkle inclusion proof when the certificate carries one and you pass `merkleRoot`.

`merkleRoot` is a bare string, so take it from a signed root. Verify the `AAP-TransparencyRoot/v1` statement first, then pass its `root_hash`:

```ts
const root = await verifyStatement(signedRoot, jwks, { expectedTyp: "AAP-TransparencyRoot/v1" })
if (!root.valid) throw new Error(root.reasons.join(", "))

const result = await verifyCertificate(certificate, {
  publicKey: "<hex public key>",
  merkleRoot: signedRoot.root_hash,
})
```

The certificate check also covers the verdict derivation journal when the certificate carries that proof. Each check is reported under `result.checks`, and a check that did not run is `null`.

## Render card lines (opt in)

The `@mnemom/verify/render-lines` subpath turns verified input into the lines a share card or period card may show. It is off by default and returns `render_lines_disabled` with no lines until you pass `enabled: true` or set `AIP_RENDER_LINES=1`.

```ts
import { renderLines } from "@mnemom/verify/render-lines"

const out = await renderLines(bundle, { jwks, surface: "share_card", enabled: true })
if (out.ok) for (const line of out.lines) console.log(line.text)
```

Every line comes from a statement that verified. Only measured, outcome and verdict lines with coverage come out. Any problem empties `lines` and `reasons` says why.

## Guarantees

- No network in the library. `verify`, `verifyStatement` and `verifyCertificate` make no network calls. You supply the JWKS or public key.
- One request from the command, at most. `mnemom-verify` makes one GET, for the JWKS, and none when you pass `--jwks`.
- No child processes. Nothing is spawned.
- No private keys. The package only verifies and holds no signing key.
- One bin. The package installs one command, `mnemom-verify`.

## License

Apache-2.0
