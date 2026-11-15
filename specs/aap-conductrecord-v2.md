# AAP-ConductRecord/v2: bounded conduct statement (normative)

Status: final, 2026-11-14. Build approved 2026-11-15. Verifier: `@mnemom/verify` 0.8.0 (`packages/verify/src/conduct-summary.ts`). Test vectors: [`schemas/aap-conductrecord-v2.vectors.json`](../schemas/aap-conductrecord-v2.vectors.json). Schemas: [`schemas/aap-conductrecord-v2.schema.json`](../schemas/aap-conductrecord-v2.schema.json), [`schemas/aap-recordlists-v1.schema.json`](../schemas/aap-recordlists-v1.schema.json).

`AAP-ConductRecord/v1` carries every protection act and every checkpoint citation of a lineage, so one statement grows with the session (1.5 to 2.6 MB on us-2 today) and a long session gets no record at all. v2 folds both lists into sha256 hash chains that Postgres computes with a constant-memory aggregate, and keeps the newest 32 citations in full. Its size is bounded at any session length.

Design summary:

- **One snapshot cut-off**, `lists_as_of` (`built_at` minus 5 s), for both lists.
- **Both lists are committed by a digest**, each a fold with its own seed. Grouped act counts and checkpoint counts can be recomputed from the lists, so they are not trust-me numbers.
- **An offline check that a build extends the one before it**, from `tail_from_digest`. It only raises flags.
- **`COLLATE "C"` pins the fold order.**
- **A lists file** (`AAP-RecordLists/v1`) plus `mnemom-verify --lists` / `verify(..., { lists })`, so a third party can recompute every count offline.

Not in this version: a Merkle tree, per-leaf inclusion proofs, per-group roots, a tail of acts. The fold leaves room for a later Merkle field or a v3.

## 1. Scope and invariants

- `AAP-ConductRecord/v2` is a detached-signature statement about one conversation lineage. It means the same as v1, with two exceptions:
  - **Protection acts:** a total, grouped counts and an acts digest, in place of the list.
  - **Checkpoint citations:** counts, a digest and the newest 32 or fewer citations in full, in place of the full list.

  Every other field is built exactly as v1 builds it.
- v1 is untouched: its bytes, builder path, verifier path, stored builds and bundles. No v1 rule changes.
- **No-content rule.** v2 adds only:
  - integers;
  - lowercase hex digests;
  - one timestamp;
  - enums;
  - tool names matching `TOOL_NAME_RE`;
  - the v1 citation shape.

  It carries no prompts, no tool inputs or outputs and no free text. The producer runs `assertNoContent` on every v2 statement before signing. The verifier closes the whole statement, not only the summary blocks (§11.1): no top-level key outside §3, the v1-shaped blocks held to the producer's no-content allowlist, every line closed to its v1 wording, and a byte ceiling. A producer regression that puts content, or the old v1 lists, under any key fails verification.
- Signature, digest, kid, `alg` and canonicalisation are unchanged from v1:
  - the signature is Ed25519 (strict RFC 8032, `zip215:false`) over `canonicalJson(statement − signature)`;
  - the digest is lowercase hex sha256 of those bytes;
  - `canonicalJson` sorts object keys recursively, writes no whitespace, keeps arrays in order and writes primitives with `JSON.stringify`. It is byte-identical in aip `canonical.ts` and api `canonicalJson`.

## 2. When the producer emits v2 (api only; not enforced by the verifier)

The thresholds are code constants in `src/record/builder.ts`, not env vars. For lineage L in org O, evaluate in this order:

1. **Prerequisite tripwires.** If either fails, stay on v1 with today's behaviour, including `too_large`:
   - (a) the pinned `@mnemom/verify` `STATEMENT_TYPES` includes `"AAP-ConductRecord/v2"` (runtime check, like `RECORD_VERIFIER_CHECKS_CHAIN_AND_HEAD`);
   - (b) `record_conduct_list_counts` does not answer 404 (the migration is applied).
2. **Sticky.** If the lineage's chain head in `record_builds` is v2, emit v2.
3. **Count gate.** Call `record_conduct_list_counts(O, L, lists_as_of)` once, before any row is read. If it returns more than `V1_MAX_CHECKPOINTS = 2000` checkpoints or more than `V1_MAX_ACTS = 10000` acts, emit v2.
4. **Build v1 as today.**
   - If `canonicalJson(v1)` is over `V1_MAX_BYTES = 1 048 576` UTF-8 bytes, discard it and emit v2.
   - If any v1 read throws `RecordReadExceededError`, emit v2 instead of `too_large`.
5. **Otherwise** emit v1, byte-identical to today.

`V2_MAX_BYTES = 131 072`. The builder never signs a v2 statement over that (§10).

**Cut-off after a predecessor.** `lists_as_of` is `built_at − 5000 ms`, raised to the predecessor's cut-off when that is later: a v1 predecessor's `built_at` (v1 reads with no cut-off), a v2 predecessor's `lists_as_of`. It never exceeds `built_at`. This stops an honest build made within 5 s of its predecessor (the un-debounced billing-final rebuild, a GET refresh, replica clock skew) from lacking the predecessor's newest rows. The verifier does not trust it: a successor whose cut-off is still earlier gets `extension not checked` (§11.3).

## 3. Fields

"As v1" means v1's name, type and `NO_CONTENT_ALLOWLIST` shape, constructed identically.

| field | type and bounds |
|---|---|
| `typ` | exactly `"AAP-ConductRecord/v2"` |
| `unit_kind` | exactly `"conversation"` |
| `org_id`, `lineage_key`, `signing_key_id` | as v1 (`ID_RE ^[A-Za-z0-9_.:/+=@-]{1,256}$`) |
| `built_at` | `^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$` (UTC, ms), as v1 |
| `lists_as_of` | NEW. Same regex as `built_at`. The producer sets `built_at` − 5000 ms; the only verified rule is `lists_as_of <= built_at` (string comparison is valid in this fixed format). Both lists contain exactly the rows with `created_at <= lists_as_of`. |
| `previous_digest` | required: 64 lowercase hex, or null for genesis. It may name a v1 or a v2 build of the same lineage (§9). A v2 without the key is not a chain member, so the verifier refuses it. |
| `cost`, `goal`, `people`, `runner?`, `door2?` | as v1, byte for byte. door2 keeps its caps: ≤50 reseals, ≤50 siblings, ≤50 `per_wake`. The verifier holds each block to the producer's `NO_CONTENT_ALLOWLIST` (§11.1). |
| `protection` | an object with exactly the five keys below |
| `protection.acts_total` | safe integer ≥ 0 |
| `protection.acts_digest` | 64 lowercase hex: `fold(ACTS_SEED, all act tuples)` (§5) |
| `protection.by` | array of 0..64 rows, each exactly `{mode, verdict, tool_name, count}`. `mode` ∈ off, observe, nudge, enforce. `verdict` ∈ pass, warn, nudge, quarantine, block. `tool_name` matches `TOOL_NAME_RE` or is null. `count` is a safe integer ≥ 1. Order and folding are in §7. |
| `protection.tools_folded` | safe integer ≥ 0: acts whose shown tool name was folded away by the 64-row cap |
| `protection.tool_names_withheld` | safe integer ≥ 0: acts whose stored tool name failed `TOOL_NAME_RE` (tuple `tool_withheld: true`) |
| `checkpoints` | an object with exactly the six keys below |
| `checkpoints.count` | safe integer ≥ 0 |
| `checkpoints.bound_count` | 0..count: tuples with `combined_commitment` and `commitment_signature` both non-null |
| `checkpoints.card_hash_count` | 0..count: tuples with `card_hash` non-null |
| `checkpoints.digest` | 64 lowercase hex: `fold(CKPT_SEED, all count tuples)` |
| `checkpoints.tail_from_digest` | 64 lowercase hex: the fold over the first `count − tail.length` tuples |
| `checkpoints.tail` | 0..32 citation tuples (§4): the LAST `tail.length` tuples in fold order. `tail.length = min(count, 32)` unless the byte guard shortened it. |
| `lines` | as v1, except that the per-act protection lines become per-group lines (§8). At most 72 entries (`V2_LINES_MAX`: 8 fixed lines and 64 group lines), each exactly `{class, key, text}`. |
| `alg?` | `"EdDSA"`, as v1 |
| `signature` | base64url Ed25519, as v1 |

No other top-level key is allowed. The verifier's set is exactly `typ, unit_kind, org_id, lineage_key, signing_key_id, built_at, lists_as_of, previous_digest, goal, cost, people, runner, door2, protection, checkpoints, lines, alg, signature`, with `runner`, `door2`, `alg` and `signature` optional (`signature` is required by the signature step, so the producer can run the shape check before signing).

**Allowlist changes** (`NO_CONTENT_ALLOWLIST`, api):

- the `typ` regex becomes `^AAP-ConductRecord\/v[12]$` (v1 output is unchanged);
- new keys:
  - `lists_as_of`: ISO_MS;
  - `acts_total`, `tools_folded`, `tool_names_withheld`, `count`, `bound_count`, `card_hash_count`: number;
  - `acts_digest`, `digest`, `tail_from_digest`: SHA256_HEX;
  - `by`, `tail`: array.

## 4. Tuples and normalisation (byte-exact)

### Checkpoint tuple

There is one tuple per `integrity_checkpoints` row with `lineage_key = L`, inner-joined to `agents` on `agent_id` with `agents.org_id = O`, and `created_at <= lists_as_of`.

**Fold order:** `ORDER BY "timestamp" ASC, checkpoint_id COLLATE "C" ASC`.

**Normalisation.** The SQL `record_ckpt_tuple` and the JS reference must agree byte for byte.

- `checkpoint_id` must match `ID_RE`. If it does not, the SQL raises and the build fails. Ids are server-minted `ic-<uuid>`.
- The citation is **bound** when both hold:
  - `input_commitment` matches `^[A-Za-z0-9_=-]{1,512}$`;
  - `issuer_signature` matches `^[A-Za-z0-9+/_=-]{1,512}$`.
- `combined_commitment` is `input_commitment` if bound, else null.
- `commitment_signature` is `issuer_signature` if bound, else null.
- `commitment_key_id` is `signing_key_id` if bound and it matches `ID_RE`, else null.
- `card_hash` is the stored value if it matches `^[0-9a-f]{64}$`, else null.

**SQL form of the patterns.** Postgres regex quantifiers stop at 255, so `{1,256}` and `{1,512}` raise `invalid repetition count(s)`, and `{1,255}` would disagree with the JS reference at 256 to 512 characters. SQL writes each bounded pattern as a class plus a length test, which is the same rule:

| JS (`conduct-summary.ts`) | SQL |
|---|---|
| `ID_RE ^[A-Za-z0-9_.:/+=@-]{1,256}$` | `x ~ '^[A-Za-z0-9_.:/+=@-]+$' AND length(x) BETWEEN 1 AND 256` |
| `^[A-Za-z0-9_=-]{1,512}$` | `x ~ '^[A-Za-z0-9_=-]+$' AND length(x) BETWEEN 1 AND 512` |
| `^[A-Za-z0-9+/_=-]{1,512}$` | `x ~ '^[A-Za-z0-9+/_=-]+$' AND length(x) BETWEEN 1 AND 512` |
| `TOOL_NAME_RE ^[A-Za-z0-9_.:-]{1,128}$` | `x ~ '^[A-Za-z0-9_.:-]+$' AND length(x) BETWEEN 1 AND 128` |
| `^[0-9a-f]{64}$` | `x ~ '^[0-9a-f]{64}$'` |

The JS reference is `citationFromRow` and `actFromRow` (exported by `@mnemom/verify`). The `row_normalisation` section of the vectors file pins raw rows to their tuples, including the 255, 256, 257, 512 and 513 character boundaries, a signature that fails its pattern (unbound), a bound row whose key id fails `ID_RE` (key id null), an uppercase or short card hash (null) and a withheld tool name; the api's pgTAP tests read the same section.

For every row that v1 accepts, this tuple equals v1's `toCitation` object. That equality is what makes the v1→v2 extension check (§11.3) work.

Every non-null value is drawn from ASCII without `"` or `\`, so `canonicalJson(tuple)` is exactly:

```
{"card_hash":V,"checkpoint_id":"ID","combined_commitment":V,"commitment_key_id":V,"commitment_signature":V}
```

`V` is `null` or `"value"`.

### Act tuple

There is one tuple per `safe_house_decisions` row with `lineage_key = L`, joined to `agents` with `org_id = O`, and `created_at <= lists_as_of`.

**Fold order:** `ORDER BY turn_index ASC, created_at ASC, id ASC` (v1's order; `id` is a uuid, compared bytewise).

**Normalisation:**

- `decision_ref` = lowercase hex of `sha256( UTF-8( "AAP-DecisionRef/v1\n" || lower(id::text) ) )`, where `\n` is one line feed byte. In SQL write the prefix as `E'AAP-DecisionRef/v1\n'` or `'AAP-DecisionRef/v1' || chr(10)`: a plain `'AAP-DecisionRef/v1\n'` literal keeps a backslash and an `n` and gives another ref. The raw id never enters a statement, because decision certificates are public.
- `mode` and `verdict` are the stored values. They are CHECK-enforced; a value outside the enum raises.
- If `tool_name` is null: `tool_name = null`, `tool_withheld = false`.
- If it matches `TOOL_NAME_RE` (`^[A-Za-z0-9_.:-]{1,128}$`): the value, `tool_withheld = false`.
- Otherwise: `tool_name = null`, `tool_withheld = true`.

`canonicalJson` is exactly:

```
{"decision_ref":"HEX64","mode":"M","tool_name":V,"tool_withheld":B,"verdict":"R"}
```

`B` is `true` or `false`.

## 5. Digest algorithm (byte-exact)

```
CKPT_SEED = SHA-256( ASCII "AAP-ConductRecord/v2/checkpoints" )
          = f785dba4fd7921589a92cfc78cb1a76b3b86f906fd81b013437f7440a5577a45
ACTS_SEED = SHA-256( ASCII "AAP-ConductRecord/v2/acts" )
          = 636e3beabb000b277895117585ba15c71fe2642db841003e3df015e5a78d9fc9
fold(h0, [t1..tn]):  h_i = SHA-256( h_{i-1} || UTF-8(canonicalJson(t_i)) )   -- h is 32 raw bytes, || is byte concatenation
                     result = lowercase_hex(h_n);  fold(h0, []) = hex(h0)
digest           = fold(CKPT_SEED, t_1..t_count)
tail_from_digest = fold(CKPT_SEED, t_1..t_{count−k}),   k = tail.length
                   so digest = fold(tail_from_digest, tail)
acts_digest      = fold(ACTS_SEED, a_1..a_acts_total)
```

**Vectors** (committed in `schemas/aap-conductrecord-v2.vectors.json`, shared by the aip tests, the SDK tests, the api tests and pgTAP; each value was checked by two independent implementations, TypeScript and Python):

Checkpoint tuples:

- `t1 = {checkpoint_id:"ic-00000000-0000-4000-8000-000000000001", combined_commitment:"YWJj", commitment_signature:"c2ln", commitment_key_id:"key-001", card_hash:"a"×64}`
- `t2 = {checkpoint_id:"ic-00000000-0000-4000-8000-000000000002", the other four null}`
- `t3 = {checkpoint_id:"ic-00000000-0000-4000-8000-000000000003", combined_commitment:"ZGVm", commitment_signature:"c2ln", commitment_key_id:"key-001", card_hash:null}`

| fold | result |
|---|---|
| `fold(CKPT_SEED,[t1])` | `671303fab4db2d8aa733d92564d080a8486c02d374dbfdb8318296f1d8b5f4a6` |
| `fold(CKPT_SEED,[t1,t2,t3])` | `2d38faed1001ad9359a4700129e419255175858f0d57716ff84a4f648e59ed32` |
| `fold(fold(CKPT_SEED,[t1]),[t2,t3])` | `2d38faed1001ad9359a4700129e419255175858f0d57716ff84a4f648e59ed32` (the same) |

Decision refs:

| id | `decision_ref` |
|---|---|
| `00000000-0000-4000-8000-000000000001` | `6699a3dfa4f36d42c83041bf2631208c431b6acef26617ec7cc694d63132a200` |
| `00000000-0000-4000-8000-000000000002` | `e4dd51cca034337eca15c8e5bb09706f59de3524fc395442c9897426735ccd85` |
| `3f2a9c1e-b7d4-4e6f-a0c8-5d1e9b2f7a6c` and its uppercase form | the same ref (the id is lowercased); value in the vectors file |

Act tuples:

- `a1 = {decision_ref:ref1, mode:"enforce", tool_name:"Bash", tool_withheld:false, verdict:"block"}`
- `a2 = {decision_ref:ref2, mode:"observe", tool_name:null, tool_withheld:false, verdict:"pass"}`

| fold | result |
|---|---|
| `fold(ACTS_SEED,[a1,a2])` | `b3fca034e59964185d75141b39c11f9133b31c48712baa932e9306c25ac98439` |

The value computed before the `tool_withheld` key was added (`22cc797a…e088`) is not normative. The vectors file also carries a withheld-name tuple `a3` and its fold.

**Postgres implementation:**

- `record_fold_step(state bytea, tuple text) RETURNS bytea` = `sha256(state || convert_to(tuple,'UTF8'))`, IMMUTABLE PARALLEL SAFE, **not STRICT**: it RAISEs on a NULL tuple. With STRICT and a non-null INITCOND, Postgres would skip a NULL input silently, so a tuple function that returned NULL for one row (`||` over a nullable column not coalesced) would leave the row out of `digest` while still counting it, and every lists check would fail. pgTAP covers a NULL-column row and the decision_ref vector.
- Two aggregates over it:
  - `record_ckpt_fold(text)` with `INITCOND = '\xf785…7a45'`;
  - `record_act_fold(text)` with `INITCOND = '\x636e…9fc9'`.
- Zero rows return INITCOND, which is the seed.
- Called as `record_ckpt_fold(record_ckpt_tuple(...) ORDER BY "timestamp", checkpoint_id COLLATE "C")`.
- Memory is O(1) apart from the sort; the input is served by `idx_ckpt_lineage_ts`.

## 6. Summary SQL (api migration: next free number, plan reserves 671; additive, NEVER-AUTO, with `.down.sql` and pgTAP)

All functions are STABLE (fold, step and tuple functions IMMUTABLE), SECURITY INVOKER, and EXECUTE is granted to `service_role` only. Every function filters on `created_at <= p_as_of` and scopes through `agents.org_id = p_org`.

- `record_ckpt_tuple(...) text`, `record_act_tuple(...) text`: §4 as SQL string concatenation.
- `record_conduct_list_counts(p_org, p_lineage, p_as_of)` returns `{checkpoints, acts}`.
- `record_checkpoint_summary(p_org, p_lineage, p_as_of, p_tail int)` returns jsonb `{count, bound_count, card_hash_count, prefix_digest, tail}`.
  - It runs as one statement, so it sees one snapshot.
  - `prefix_digest` is the fold over the first `count − least(count, p_tail)` tuples.
  - `tail` holds the rest as tuple objects.
  - The api computes `digest = fold(prefix_digest, tail)` in JS, with the verifier's own `fold` (exported by `@mnemom/verify`).
- `record_act_summary(p_org, p_lineage, p_as_of)` returns `{acts_total, acts_digest, tool_names_withheld, counts}`, where `counts` is a plain `GROUP BY mode, verdict, tool_name` (the tuple's, so null when withheld) with a count per key: at most 4 × 5 × (distinct tool names) rows, never one per act. It does no ranking, capping or ordering. The producer passes `counts` and `tool_names_withheld` to `groupActCounts` (§7), so there is one implementation of the grouping.
- `record_checkpoint_list_page(p_org, p_lineage, p_as_of, p_after_ts, p_after_id, p_limit)` returns tuples in fold order, keyset paged.
- `record_act_list_page(p_org, p_lineage, p_as_of, p_after_turn, p_after_created, p_after_id, p_limit)` returns tuples plus `decision_id`, in fold order.
- `record_builds_typ_check` widens to include `'AAP-ConductRecord/v2'`: `ADD CONSTRAINT … NOT VALID`, then `VALIDATE CONSTRAINT` as a separate statement.
- The migration 602 unique index `(org_id, lineage_key, previous_digest)` is unchanged. It carries no typ, which is what lets v1 and v2 share one chain.
- Before writing the functions, confirm that `integrity_checkpoints.created_at` and `safe_house_decisions.created_at` exist and are NOT NULL.

## 7. Protection grouping (deterministic; recomputable from the act list)

Implemented once as `groupActCounts(counts, withheld)` in `@mnemom/verify`, over `{mode, verdict, tool_name, count}` rows (repeats add up); `groupActs(acts)` is the same over one count per act. The producer imports `groupActCounts` and feeds it the §6 `GROUP BY` counts, so no act list is loaded. The `grouping` section of the vectors file pins the order, the overflow and the tie-breaks.

- **Key.** Each act maps to `(mode, verdict, t)`, where `t` is the tuple's `tool_name` (already null when withheld).
- **Ranks:**
  - mode rank: `off < observe < nudge < enforce`;
  - verdict rank: `pass < warn < nudge < quarantine < block`.
- **64 or fewer distinct keys:** one row per key, and `tools_folded = 0`.
- **More than 64 distinct keys:**
  1. Rank the keys with a non-null `t` by:
     1. line-bearing first (`protectionVerb(mode, verdict)` non-null, that is `mode ≠ off AND verdict ≠ pass`);
     2. count descending;
     3. mode rank;
     4. verdict rank;
     5. `t` ascending by code point (`COLLATE "C"`).
  2. Keep the first 44.
  3. Merge every other act into the row `(mode, verdict, null)`. There are at most 20 such rows, so at most 64 in all.
  4. `tools_folded` = the number of acts with a non-null `t` that were merged.
- **Output order:** mode rank, then verdict rank, then `tool_name` (null first, then ascending by code point).
- **Invariants:**
  - `Σ by[].count = acts_total`;
  - `tools_folded + tool_names_withheld ≤ acts_total`;
  - `acts_total = 0` ⇔ `by = []` and `acts_digest = hex(ACTS_SEED)`;
  - rows strictly increase in output order, so no key repeats;
  - `tools_folded + tool_names_withheld ≤` the count in null-tool rows (both kinds of act sit there);
  - `tools_folded > 0` ⇔ folding happened, so exactly 44 named rows remain.

  The verifier checks the last three from the statement alone (§11.1), so an order or uniqueness bug fails at verify time, not only under `--lists`.

## 8. Lines

Lines are in v1 order:

1. cost;
2. goal mode;
3. Canon node;
4. goal verdict;
5. `protection.mode` "not checked", when `by` is empty or every row has mode `off`;
6. one line per `by[i]` whose `protectionVerb(mode, verdict)` is non-null:
   - key `protection.group.<i>`;
   - class `verdict`;
   - text exactly what v1 `protectionActLine` gives for that mode, verdict and tool: the tool is named only after "stopped", and only when `tool_name` is non-null;
7. people messages;
8. compactions.

**Closed lines (verified, §11.1).** Each fixed key appears at most once, with its class and exactly the v1 wording (mnemom-api `claims.ts` `WORDS`):

| key | class | text |
|---|---|---|
| `cost.model` | measured | `model cost <mmu> mmu` |
| `cost.mu` | measured | `µ <mmu> mmu`, `≈ <mmu> mmu (pending)` or `not charged` |
| `goal.mode` | measured | `not checked`, `implicit goal` or `sealed contract` |
| `goal.node` | measured | `Canon node pending` or `Canon node mn-<6 lowercase alphanumerics>` |
| `goal.verdict` | verdict | `<n> of <n> judged turns on goal, <n> of <n> turns judged` |
| `protection.mode` | measured | `not checked` |
| `people.messages` | measured | `<n> messages from a person` or `messages from a person: unclassified` |
| `context.compactions` | measured | `<n> compactions` |

`protection.group.<i>` appears exactly once for each line-bearing `by[i]` (i < `by.length`) and for no other row, class `verdict`, text `groupLineText(by[i])`. Every text also matches `LINE_TEXT_RE`. No other key is allowed.

The count is never in the text; it lives in `by[i].count`. The claim-lint rules (`verb_mismatch`, forbidden words, the A-S-001 provisional-µ rule) therefore hold unchanged. In the verifier, `fieldForLineKey` maps `protection.group.<i>` to `protection`, and `attachLineContext(lines, goal, { by })` reads the line's mode, verdict and tool from `by[i]`.

## 9. Chain and link rules across typs

- **Chain family.** The chain key is `(chainFamily(typ), lineage_key)`.
  - `chainFamily(v1) = chainFamily(v2) = "AAP-ConductRecord"`.
  - Every other typ is its own family.
  - v1→v1, v1→v2, v2→v2 and v2→v1 links are all chain-valid.
  - The existing K1.20 rules apply within the family unchanged:
    - the predecessor appears earlier in the bundle;
    - one successor per predecessor (a fork is `chain_broken`);
    - one root (a second genesis is `chain_broken`);
    - `lineage truncated` for a missing first predecessor.
- **v2→v1** is valid, with no reason and no flag. The producer is sticky (§2) and emits it only after a writer rollback. A later v1 carries strictly more detail.
- **Link targets:**
  - `conduct_digests` → {v1, v2};
  - `source_digest` → {Conduct v1, Conduct v2, PRRecord/v1, Outcome/v1};
  - `pr_record_digest` is unchanged.
- **Share cards.** `AAP-ShareCard` `statements[].typ` may be v2 (`SHARE_CARD_STATEMENT_TYPES`, `schemas/aap-sharecard.schema.json`).

## 10. Size bound

**Worst case at the caps** (canonical JSON, UTF-8 bytes; KiB = 1024 B):

| part | size |
|---|---|
| base | ≈2.5 KiB |
| door2 | ≈47 KiB |
| `by`, 64 rows | 13 440 B (13.1 KiB) |
| group lines, 64 | 12 416 B (12.1 KiB) |
| tail, 32 citations at maximal lengths (1 709 B each) | 54 720 B (53.4 KiB) |
| **total** | **≈128 KiB, about 131 000 B** |

That total is at `V2_MAX_BYTES` (131 072 B), so at every cap at once the byte guard below shortens the tail to 16. At real id and signature lengths the worst case is about 90 KiB; a typical v2 statement is 10–20 KiB. The golden fixture (45 citations, 9 acts) is 12 420 B canonical.

**Byte guard (producer).** If `canonicalJson(v2)` is over `V2_MAX_BYTES`:

1. Shrink the tail locally: `k → floor(k/2)`, set `tail_from_digest ← fold(tail_from_digest, the dropped head of the tail)`, and rebuild. No new read is needed.
2. If the statement is still over at k = 0, throw.

**What the verifier enforces.** The format caps (tail ≤ 32, `by` ≤ 64 rows, lines ≤ 72) and the closed shapes are part of the statement and fail as `summary_inconsistent` (§11.1). On top, a hard byte ceiling: `V2_CEILING_BYTES = 2 × V2_MAX_BYTES = 262 144`. A v2 statement whose canonical JSON (signature included) is over it is `summary_inconsistent`, whatever it holds. No statement the producer signs comes near it, so the ceiling only catches a statement that could not come from a correct producer.

## 11. Verifier behaviour (`@mnemom/verify` 0.8.0)

### 11.1 Per-statement checks (offline, never throw)

These run after the existing steps: shape, typ allowlist, alg, kid, signature, key, Ed25519, `expectedDigest`, digest-field checks and the alias rule. For `typ === "AAP-ConductRecord/v2"` (`conductSummaryReasons`), at most two reasons, in this order:

**`digest_malformed`** (deduplicated against the existing digest-field check) when `protection` is an object and `protection.acts_digest` is not `^[0-9a-f]{64}$`, or `checkpoints` is an object and `checkpoints.digest` or `checkpoints.tail_from_digest` is not.

**`summary_inconsistent`** (one reason, pushed once) when any of the following holds.

Statement shape:

- a top-level key outside the §3 set, or a required key missing (`typ`, `unit_kind`, `org_id`, `lineage_key`, `signing_key_id`, `built_at`, `lists_as_of`, `previous_digest`, `goal`, `cost`, `people`, `protection`, `checkpoints`, `lines`);
- `unit_kind` is not `"conversation"`; `lineage_key` or `org_id` does not match `ID_RE`; `previous_digest` is neither a string nor null (its hex form is the existing digest-field check);
- `goal`, `cost`, `people` (and `runner`, `door2` when present) is not an object held to mnemom-api's `NO_CONTENT_ALLOWLIST`: every key listed, every string of its key's shape, every number a safe integer ≥ 0, null only as a field value, nesting at most 8 deep;
- `lines` is not an array of at most 72 entries, each exactly `{class, key, text}`, closed as §8 says: a fixed key at most once with its class and v1 wording, `protection.group.<i>` exactly once per line-bearing `by[i]` and for no other index, every text matching `LINE_TEXT_RE`;
- the statement's canonical JSON is over `V2_CEILING_BYTES` (262 144) UTF-8 bytes.

Timestamps:

- `built_at` or `lists_as_of` does not match the ms regex;
- `lists_as_of > built_at`.

Protection:

- `protection` is not an object with exactly the keys `acts_total`, `acts_digest`, `by`, `tools_folded`, `tool_names_withheld`;
- `acts_total`, `tools_folded` or `tool_names_withheld` is not a safe integer ≥ 0;
- `by` is not an array, has more than 64 rows, or any row is not an object with exactly `mode`, `verdict`, `tool_name`, `count`, with `mode` and `verdict` in the enums, `tool_name` matching `TOOL_NAME_RE` or null, and `count` a safe integer ≥ 1;
- `Σ count ≠ acts_total`;
- the rows are not strictly increasing in §7 output order (out of order, or a key repeated);
- `tools_folded + tool_names_withheld` is more than the count in null-tool rows (so either one needs a null row);
- `tools_folded > 0` and the named rows are not exactly 44;
- `acts_total = 0` and `acts_digest ≠ hex(ACTS_SEED)`, or `acts_total > 0` and `acts_digest = hex(ACTS_SEED)`.

Checkpoints:

- `checkpoints` is not an object with exactly the keys `count`, `bound_count`, `card_hash_count`, `digest`, `tail_from_digest`, `tail`;
- `count`, `bound_count` or `card_hash_count` is not a safe integer ≥ 0;
- `bound_count > count`, or `card_hash_count > count`;
- `tail` is not an array, has more than 32 entries, or `tail.length > count`;
- a tail entry is not a citation tuple: exactly the five citation keys, `checkpoint_id` matching `ID_RE`, `combined_commitment` and `commitment_signature` both null or both matching their §4 patterns, `commitment_key_id` null or `ID_RE` (null when unbound), `card_hash` null or 64 lowercase hex;
- the tail's bound entries number more than `bound_count`, or its unbound entries more than `count − bound_count`;
- the same holds for `card_hash` against `card_hash_count`;
- `count = 0` and `digest ≠ hex(CKPT_SEED)`, or `count > 0` and `digest = hex(CKPT_SEED)`;
- `tail.length === count` and `tail_from_digest ≠ hex(CKPT_SEED)`, or `tail.length < count` and `tail_from_digest = hex(CKPT_SEED)`;
- `fold(tail_from_digest, tail) ≠ digest`.

The seed rules close a gap the fold alone leaves: when the tail is the whole list, `count` is otherwise not bound by any digest. Together the closed shapes make the statement unable to carry content or an unbounded list under any key (§1), and the `by` order rules leave one signed `by` for a given set of acts.

### 11.2 Flags (never change `valid`; emitted only on a v2 statement with no reasons)

`StatementFlag` gains an optional `count?: number`. In this order:

| flag | subject | count | when |
|---|---|---|---|
| `summarized` (new) | the statement digest | `checkpoints.count − tail.length` | always on v2: acts are grouped, and citations before the tail are committed only by digest |
| `card hash not recorded` | `checkpoints.digest` | `count − card_hash_count` | when > 0 |
| `card not bound` | `checkpoints.digest` | `count − bound_count` | when > 0 |

Per-citation v1 flags are not emitted for tail entries, so nothing is counted twice. v1 flags are unchanged and carry no `count`.

### 11.3 Bundle-level extension check (offline)

This runs for each in-bundle chain link A → B of the conduct family (`B.previous_digest = digest(A)`, same lineage), where A and B are both valid, the link is not `chain_broken`, and at least one of A and B is v2 (`extensionFlags`). A v1 → v1 link gets nothing, as before v2. Flags only, never a reason.

**Inputs from A:**

| A | `nA` | `dA` | cut-off `cA` |
|---|---|---|---|
| v1 | `A.checkpoints.length` | `fold(CKPT_SEED, A.checkpoints)`, each entry canonicalJson'd as given | `A.built_at` (v1 reads with no cut-off) |
| v2 | `A.checkpoints.count` | `A.checkpoints.digest` | `A.lists_as_of` |

**B is v2.** `mB = B.count − B.tail.length`. In this order:

| condition | result |
|---|---|
| `B.lists_as_of < cA` | flag `extension not checked` (subject = B digest, no count): B may honestly lack A's newest rows |
| `B.count < nA` | flag `checkpoints removed since previous build` (count = `nA − B.count`) |
| `nA < mB` | flag `extension not checked` (count = `mB − nA`, the citations between A's end and B's tail): unknown, not wrong |
| `fold(B.tail_from_digest, B.tail[0 : nA − mB]) ≠ dA` | flag `checkpoints changed since previous build` |
| otherwise | nothing: the extension is proven |

**B is v1 after a v2 A** (a writer rollback, §9). B lists every citation, so: `B.checkpoints.length < nA` gives `checkpoints removed since previous build` (count = the difference), and `fold(CKPT_SEED, B.checkpoints[0 : nA]) ≠ dA` gives `checkpoints changed since previous build`. Otherwise the extension is proven.

So a reader can always tell "proven" (no flag) from "unknown" (`extension not checked`) from "different" (`changed`/`removed`). A build that adds more than 32 citations cannot be proven from the bundle; a lists file for B settles it (§11.4). Acts get no extension check.

### 11.4 Lists check (offline, opt-in)

**Input format.** Unsigned `AAP-RecordLists/v1` objects:

```
{typ:"AAP-RecordLists/v1", statement_digest, lists_as_of, checkpoints?: CheckpointTuple[], acts?: (ActTuple & {decision_id?: string})[]}
```

Each object carries at least one of `checkpoints` and `acts`. Objects that name the same statement are **pages**: their lists continue each other in the order given, so a list of any length can be split across objects and files. The objects are trusted only through the signed digests.

**Incremental check.** `ConductListsCheck` folds pages as they arrive: the running fold state, the counts, the last `tail.length` citations and one counter per distinct `(mode, verdict, tool_name)`. Memory does not grow with the list. The result equals checking the joined list at once.

**Header (`part: "statement"`), per object, in this order:**

- the object is not an `AAP-RecordLists/v1` object with string `statement_digest` and `lists_as_of` and at least one list → `list_malformed`;
- `statement_digest` names no statement in the input → `statement_not_found`;
- that statement failed verification (signature or §11.1) → `statement_invalid`;
- the statement is not v2 → `not_conduct_v2`;
- `lists_as_of ≠ statement.lists_as_of` → `as_of_mismatch`.

**Checkpoints list** (all pages joined):

1. Every entry must be a citation tuple (§11.1), else `list_malformed`.
2. Recompute and compare, in this order:
   - `count` (`count_mismatch`);
   - `bound_count` and `card_hash_count` (`binding_count_mismatch`);
   - the last `tail.length` entries are canonically equal to `tail` (`tail_mismatch`);
   - `fold(CKPT_SEED, list)` equals `digest` (`digest_mismatch`).

**Acts list** (all pages joined):

1. Every entry must be an act tuple, optionally with `decision_id`, else `list_malformed`.
2. If `decision_id` is present, its §4 `decision_ref` must equal the tuple's (`decision_ref_mismatch`).
3. Strip `decision_id` and recompute:
   - `acts_total` (`count_mismatch`);
   - `fold(ACTS_SEED, tuples)` equals `acts_digest` (`digest_mismatch`);
   - `by`, `tools_folded` and `tool_names_withheld` per §7 (`groupActCounts` over the counters), with `canonicalJson(by)` equal (`groups_mismatch`).

**Wiring:**

- `verify(input, jwks, {lists})` takes one object, an array or an async iterable of objects. CLI `--lists <file>` may be given several times; each file holds one object or an array and is read only when the check reaches it, and the size limit applies per file.
- Any mismatch adds the bundle-level reason `summary_list_mismatch` (unprefixed). It means "this list is not what Mnemom signed", not "Mnemom lied" (§14).
- The result gains `lists_checked: {statement_digest, part, ok, mismatch?, not_supplied?}[]`: one entry per header failure, and for each statement a lists object reached, one entry per part. A part no object carried is `{ok:false, not_supplied:true}` with no mismatch: not proven, and not a reason. Without `lists`, the result has no `lists_checked`.
- The CLI status line for a valid v2 statement reads `N checkpoints (T in bundle), A acts in G groups, lists: <status>`. The status is `checked` only when both parts were supplied and passed, `mismatch` when any check failed, `not supplied` when no object named the statement, and otherwise per part, for example `checkpoints checked, acts not supplied`. `flagSummary` adds up each flag's `count`.

**Export:** `checkConductLists(statement, lists, jwks) → Promise<{ok:true} | {ok:false, part, mismatch} | {ok:false, part, not_supplied:true}>`. It verifies the statement against `jwks` first: a statement that does not verify is `statement_invalid` whatever the lists say, because anyone can build a statement and lists that agree. `ok:true` only when both lists were supplied and fold to the signed digests.

### 11.5 SDK parity

mnemom-platform `shared/sdk` `verifyStatement`:

- adds the typ to `DETACHED_STATEMENT_TYPS` (`STATEMENT_TYP.ConductRecordV2`);
- reproduces `digest_malformed` and `summary_inconsistent` (§11.1, all of it: the closed statement shape, the no-content blocks, the closed lines, the `by` order rules and the byte ceiling) with WebCrypto, in the same order, first failing reason only, as today;
- has no flags, no extension check and no lists check.

The parity release reads `schemas/aap-conductrecord-v2.vectors.json` and the committed v2 fixtures (`golden-conduct-v2.json`, the v2 cases in `tampered.json`).

## 12. Lists route (api; documented `x-internal` until the verifier gains a fetch mode)

`GET /v1/orgs/{org_id}/record/lists?statement_digest=<hex64>&part=checkpoints|acts&after=<opaque cursor>&limit=1..10000`

The route resolves the stored v2 build by `statement_digest` (org-scoped) and reads its `lineage_key` and `lists_as_of`; the caller never supplies a cut-off.

**Response:** `{lists: {typ:"AAP-RecordLists/v1", statement_digest, lists_as_of, <part>: [...]}, next: cursor|null}`.

- `lists` is a lists object (§11.4) as it is: save each page's `lists` and pass every page to `mnemom-verify --lists` (repeatable) or `verify(..., {lists: pages})`, in order. No reshaping, so a saved page is never `list_malformed`.
- Items are §4 tuples in fold order with `created_at <= lists_as_of`. Act items also carry `decision_id`.

**Access and limits:**

- **Gate:** the same dark gate as `/record/conduct` (`isRecordBuilderServing`); otherwise the unknown-route 404.
- **Who may read:** the same roles `/record/conduct` admits, or an org API key for its own org.
- **Budget:** its own hourly budget (`RECORD_LISTS_CAP_HOURLY`, per org, charged one unit per page), not the K3.6 read budget that `/record/conduct` and `/record/totals` share, so an export never starves the org's other record reads. At 10 000 rows a page, a lineage with 1M checkpoints and 1M acts is 200 pages.
- **Data:** it reads only through the §6 page functions; no row is ever loaded beyond the page.
- **Retention during an export.** Rows deleted between pages make the joined list differ from the signed digests (`summary_list_mismatch`, an innocent cause, §14). Export soon after the build.

## 13. Rollout (order is mandatory)

1. **aip.** Release `@mnemom/verify` 0.8.0 (tag `verify-v0.8.0`). Publish the mnemom-platform `@mnemom/sdk` parity change.
2. **api, readers only.** Bump the pin 0.6.3 → 0.8.0, absorbing the 0.7.0 changes in `app-bundle-verify.ts`. Apply the migration. Make every reader accept both typs. Nothing emits v2 yet.
3. **api, writer.** Ship the §2 gate, `buildConductStatementV2` and the lists route.

**Rollback.** Revert step 3 only:

- readers keep reading v2 heads;
- the reverted writer chains v1 after v2, which §9 allows;
- over-cap lineages return to `too_large`.

Never revert the readers while v2 heads exist: a typ-filtered head read would miss the head, and the 602 slot is already taken.

Verifiers older than 0.8.0, and the SDK before parity, report v2 as `unknown_typ`. Only lineages that get no record or bundle today are affected.

## 14. What v2 deliberately does not prove

- **The bundle alone** proves:
  - that Mnemom signed these counts, groups and digests;
  - that the tail is the true end of the committed citation sequence;
  - that the arithmetic holds;
  - optionally, that a build extends its predecessor.

  It does not show the citations before the tail or the individual acts. Those are proven only by recomputing them from a lists file (§11.4).
- **A lists mismatch or a `changed`/`removed` flag is not proof of tampering.** There are innocent causes:
  - retention or GDPR deletion of rows;
  - a `card_hash` or commitment backfill;
  - a row committed more than 5 s after its `created_at`;
  - a late row with an earlier timestamp (the fold is ordered by `"timestamp"` to match v1, but cut by `created_at`, so such a row lands inside the fold, not at its end).
- **An `extension not checked` flag is not a failure.** It says the bundle alone cannot show whether a build extends the one before it.
- **Not proven, as in v1:**
  - that every act or checkpoint of the session was stored;
  - that protection caught everything;
  - the goal verdict beyond the judged turns;
  - any checkpoint's or decision's own verdict. That needs `/v1/checkpoints/{id}/certificate`, or `/v1/decisions/{id}/certificate` via the `decision_id` behind a `decision_ref`.
- **Detail v2 drops:**
  - per-act order across groups, turn indexes, and act identity in the bundle;
  - the names of tools folded by the cap or withheld for shape.
- **Counts are not compared between builds**, beyond the citation extension flags.

## 15. Remaining risks

- **DB CPU.** Each v2 build re-folds every row: about 0.3–0.5 s per 100k rows per list, several seconds at 1M, with no incremental cache (a late row with an earlier timestamp invalidates a stored prefix state). Mitigations: `RECORD_DELTA_RATE_CAP`, the build debounce, one statement per summary. Follow-up if needed: a cached `(as_of, prefix state)` per lineage that falls back to a full fold when a row arrives before the cached point.
- **A single citation outside the tail cannot be proven** without the whole list. A hash chain has no inclusion proof.
- **Product sign-off**: acts lose order, turn and in-bundle identity, and folded tool names are lost.
- **Thresholds** (2000 checkpoints, 10000 acts, 1 MiB) are producer constants the verifier does not enforce, so they can be retuned without a verifier release.
- **Remaining unbounded reads** (`readTurnRows`, `readLineageTotals`) still page rows under the 100k cap until plan items A, F and H land.
