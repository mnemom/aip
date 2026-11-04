# @mnemom/verify

Offline verifier for Mnemom signed records and AIP integrity certificates. It checks Ed25519 signatures, digest chains and Merkle proofs against keys you supply. It makes no network calls.

## Install

```sh
npm install @mnemom/verify
```

The package ships ESM and CommonJS builds with TypeScript types. It needs Node.js 18 or later and also runs in browsers and Workers.

## Verify a record

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

Five signed statement types are accepted, listed in `STATEMENT_TYPES`:

| `typ` | What it records |
|---|---|
| `AAP-ConductRecord/v1` | One build of a recorded session: goal, cost, messages from the person, compactions and checkpoints |
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

### Reason codes

`REASONS` lists every stable reason string:

| Code | Meaning |
|---|---|
| `not_an_object` | The statement is not a JSON object |
| `unknown_typ` | `typ` is not one of the five statement types |
| `unsupported_expected_typ` | `expectedTyp` is not one of the five statement types |
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
| `digest_malformed` | A linked digest is not 64 lowercase hex characters |
| `linked_statement_wrong_typ` | A link points at a statement of the wrong type |
| `card_line_class_not_allowed` | A card line has a class other than measured, outcome or verdict |
| `card_verdict_without_coverage` | A verdict line carries no coverage |
| `chain_broken` | The record chain does not hold inside the bundle |
| `head_mismatch` | The latest PR record names another head |
| `head_unbound` | No PR record names a head |
| `expected_head_malformed` | `expected_head_sha` is not a valid commit id |

`FLAGS` lists the flags: `card hash not recorded`, `card not bound`, `linked statement not in bundle` and `lineage truncated`.

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
 It checks the verdict derivation journal when the certificate carries that proof. Each check is reported under `result.checks`, and a check that did not run is `null`.

## Render card lines (opt in)

The `@mnemom/verify/render-lines` subpath turns verified input into the lines a share card or period card may show. It is off by default and returns `render_lines_disabled` with no lines until you pass `enabled: true` or set `AIP_RENDER_LINES=1`.

```ts
import { renderLines } from "@mnemom/verify/render-lines"

const out = await renderLines(bundle, { jwks, surface: "share_card", enabled: true })
if (out.ok) for (const line of out.lines) console.log(line.text)
```

Every line comes from a statement that verified. Only measured, outcome and verdict lines with coverage come out. Any problem empties `lines` and `reasons` says why.

## Guarantees

- No network. The verifier makes no network calls. You supply the JWKS or public key.
- No child processes. Nothing is spawned.
- No private keys. The package only verifies and holds no signing key.
- No bin. The package installs no command.

## License

Apache-2.0
