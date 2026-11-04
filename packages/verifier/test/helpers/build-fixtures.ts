/**
 * Builds the golden and tampered record fixtures under test/fixtures/record.
 *
 * Ed25519 signing is deterministic, so the build is reproducible byte for
 * byte. `test/record-fixtures.test.ts` rebuilds them on every run and fails
 * when the committed files drift; `npm run fixtures` rewrites them after a
 * deliberate shape change. The files are committed: the SDK parity test
 * (K4.5), the verifier page (K4.2) and the record-path scenario's verify
 * step (K1.3) all read them.
 *
 * Every tampered fixture names the reason it must fail with, so a change
 * that makes it pass, or fail for a different reason, breaks the suite.
 */

import { statementDigest } from "../../src/verify-record.js";
import { BUNDLE_TYP, REASONS } from "../../src/statements.js";
import { TEST_KID, signStatement, testJwks } from "./sign.js";

export interface TamperedCase {
  name: string;
  /** The exact `reasons` entry `verify` must return. */
  reason: string;
  input: unknown;
  /** Passed to `verify` as `options.expected_head_sha` when present (K1.20). */
  expected_head_sha?: string;
}

const ISSUED = "2026-10-23T18:00:00.000Z";
const H = (c: string) => c.repeat(64);

/** Fixture file stem to its JSON value. */
export async function buildFixtures(): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  const conduct1 = await signStatement({
    typ: "AAP-ConductRecord/v1",
    signing_key_id: TEST_KID,
    built_at: ISSUED,
    previous_digest: null,
    unit_kind: "pull_request",
    lineage_key: "conv_" + "a".repeat(32),
    goal: { mode: "sealed", contract_sha256: H("1"), canon_node_id: "node_" + "b".repeat(16), seal_version: 1 },
    cost: { model_cost_millimu: 412000, mu_millimu: 16480, mu_rate_bps: 400, currency_fixed_at: ISSUED },
    messages_from_person: { count: 3, classifier: "claude-code" },
    compactions: 1,
    checkpoints: [
      {
        checkpoint_id: "cp_bound",
        card_hash: H("c"),
        combined_commitment: H("d"),
        commitment_signature: "e".repeat(86),
        commitment_key_id: "aap-prod-2026-05-23",
      },
      { checkpoint_id: "cp_no_card_hash", card_hash: null, combined_commitment: H("d"), commitment_signature: "e".repeat(86), commitment_key_id: "aap-prod-2026-05-23" },
      { checkpoint_id: "cp_unbound", card_hash: H("c"), combined_commitment: null, commitment_signature: null, commitment_key_id: null },
    ],
  });

  const conduct2 = await signStatement({
    ...conduct1,
    previous_digest: statementDigest(conduct1),
    built_at: "2026-10-23T18:30:00.000Z",
    cost: { model_cost_millimu: 530000, mu_millimu: 21200, mu_rate_bps: 400, currency_fixed_at: ISSUED },
    checkpoints: conduct1.checkpoints.slice(0, 1),
  });

  const pr = await signStatement({
    typ: "AAP-PRRecord/v1",
    signing_key_id: TEST_KID,
    built_at: "2026-10-23T19:00:00.000Z",
    previous_digest: null,
    unit_kind: "pull_request",
    conduct_digests: [statementDigest(conduct2)],
    head_sha: "f".repeat(40),
    commits: { bound: 3, total: 4 },
    cost: { model_cost_millimu: 530000, mu_millimu: 21200, mu_rate_bps: 400 },
  });

  const outcome = await signStatement({
    typ: "AAP-Outcome/v1",
    signing_key_id: TEST_KID,
    built_at: "2026-10-30T19:00:00.000Z",
    unit_kind: "pull_request",
    pr_record_digest: statementDigest(pr),
    merge_sha: "0".repeat(40),
    outcome: "accepted_no_revert",
    window_days: 7,
  });

  const card = await signStatement({
    typ: "AAP-ShareCard/v1",
    signing_key_id: TEST_KID,
    built_at: "2026-10-30T20:00:00.000Z",
    source_digest: statementDigest(pr),
    lines: [
      { class: "measured", text: "3 of 4 commits from recorded sessions" },
      { class: "verdict", text: "On goal in 5 of 6 judged turns", coverage: { judged: 6, total: 12 } },
      { class: "outcome", text: "Accepted, no revert in 7 days" },
    ],
  });

  const bundle = { typ: BUNDLE_TYP, statements: [conduct1, conduct2, pr, outcome, card] };

  const tamperedCost = { ...conduct1, cost: { ...conduct1.cost, mu_millimu: 1 } };
  const wrongAlg = { ...conduct1, alg: "HS256" };
  const unknownKey = { ...conduct1, signing_key_id: "aap-not-published" };
  const badSig = { ...conduct1, signature: "A".repeat(86) };
  const malformedSig = { ...conduct1, signature: "not base64url!!" };
  const noSig = { ...conduct1 } as Record<string, unknown>;
  delete noSig.signature;
  const unknownTyp = await signStatement({ ...conduct1, typ: "AAP-Transparencyroot/v1" });
  const cardEstimate = await signStatement({
    ...card,
    lines: [...card.lines, { class: "estimate", text: "Saved about $12" }],
  });
  const cardVerdictNoCoverage = await signStatement({
    ...card,
    lines: [{ class: "verdict", text: "On goal" }],
  });
  const wrongLinkBundle = {
    typ: BUNDLE_TYP,
    statements: [
      conduct1,
      await signStatement({ ...pr, conduct_digests: [statementDigest(outcome)] }),
      outcome,
    ],
  };

  // K1.20: the previous_digest chain and the head binding.
  const conduct2OtherLineage = await signStatement({ ...conduct2, lineage_key: "conv_" + "9".repeat(32) });
  const conduct2Fork = await signStatement({ ...conduct2, built_at: "2026-10-23T18:31:00.000Z" });
  const conduct1Again = await signStatement({ ...conduct1, built_at: "2026-10-23T18:45:00.000Z" });
  // A gap inside the bundle. A missing predecessor on the first statement of a
  // chain is retention (lineage_truncated), so the gap sits after conduct1.
  const conduct3 = await signStatement({
    ...conduct2,
    previous_digest: statementDigest(conduct2),
    built_at: "2026-10-23T18:40:00.000Z",
  });
  const chainMissing = { typ: BUNDLE_TYP, statements: [conduct1, conduct3, pr] };
  const chainReordered = { typ: BUNDLE_TYP, statements: [conduct2, conduct1, pr] };
  const chainOtherLineage = { typ: BUNDLE_TYP, statements: [conduct1, conduct2OtherLineage] };
  const chainFork = { typ: BUNDLE_TYP, statements: [conduct1, conduct2, conduct2Fork] };
  const chainTwoGenesis = { typ: BUNDLE_TYP, statements: [conduct1, conduct2, conduct1Again] };
  const HEAD = "f".repeat(40);

  const tampered: TamperedCase[] = [
    { name: "tampered-cost", reason: `0:${REASONS.signature_invalid}`, input: tamperedCost },
    { name: "wrong-alg", reason: `0:${REASONS.unsupported_alg}`, input: wrongAlg },
    { name: "unknown-key", reason: `0:${REASONS.key_not_found}`, input: unknownKey },
    { name: "bad-signature", reason: `0:${REASONS.signature_invalid}`, input: badSig },
    { name: "malformed-signature", reason: `0:${REASONS.signature_malformed}`, input: malformedSig },
    { name: "missing-signature", reason: `0:${REASONS.signature_missing}`, input: noSig },
    { name: "unknown-typ", reason: `0:${REASONS.unknown_typ}`, input: unknownTyp },
    { name: "card-estimate-line", reason: `0:${REASONS.card_line_class_not_allowed}`, input: cardEstimate },
    { name: "card-verdict-no-coverage", reason: `0:${REASONS.card_verdict_without_coverage}`, input: cardVerdictNoCoverage },
    { name: "bundle-wrong-link", reason: `1:${REASONS.linked_statement_wrong_typ}`, input: wrongLinkBundle },
    { name: "chain-predecessor-missing", reason: `1:${REASONS.chain_broken}`, input: chainMissing },
    { name: "chain-reordered", reason: `0:${REASONS.chain_broken}`, input: chainReordered },
    { name: "chain-other-lineage", reason: `1:${REASONS.chain_broken}`, input: chainOtherLineage },
    { name: "chain-fork", reason: `2:${REASONS.chain_broken}`, input: chainFork },
    { name: "chain-second-genesis", reason: `2:${REASONS.chain_broken}`, input: chainTwoGenesis },
    { name: "head-mismatch", reason: REASONS.head_mismatch, input: bundle, expected_head_sha: "a".repeat(40) },
    { name: "head-unbound", reason: REASONS.head_unbound, input: { typ: BUNDLE_TYP, statements: [conduct1, conduct2] }, expected_head_sha: HEAD },
  ];

  const write = (name: string, value: unknown) => {
    out[name] = value;
  };

  write("jwks", await testJwks());
  write("golden-bundle", bundle);
  for (const [name, s] of Object.entries({ conduct: conduct2, "pr-record": pr, outcome, "share-card": card })) {
    write(`golden-${name}`, s);
  }
  write("tampered", tampered);
  // Expected verdicts, so a reader in another language can check parity.
  write("golden-verdicts", {
    bundle: { valid: true, flags: [
      { flag: "card hash not recorded", subject: "cp_no_card_hash" },
      { flag: "card not bound", subject: "cp_unbound" },
    ] },
    digests: {
      conduct1: statementDigest(conduct1),
      conduct2: statementDigest(conduct2),
      pr: statementDigest(pr),
      outcome: statementDigest(outcome),
      card: statementDigest(card),
    },
  });
  return out;
}
