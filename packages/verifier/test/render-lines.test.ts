import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, afterEach } from "vitest";
import { renderLines, renderLinesEnabled, RENDER_LINES_REASONS as R } from "../src/render-lines.js";
import { lintRendering } from "../src/claim-lint.js";
import { statementDigest } from "../src/verify-record.js";
import { BUNDLE_TYP } from "../src/statements.js";
import { shouldRenderEstimate } from "../src/render-estimate.js";
import { TEST_KID, signStatement, testJwks } from "./helpers/sign.js";
import { testPublicKeyHex, signWithTestKey, baseCard } from "./helpers/sharecard-fixtures.js";

const here = dirname(fileURLToPath(import.meta.url));
const rec = (n: string) => JSON.parse(readFileSync(join(here, "fixtures", "record", n), "utf8"));
const card = (n: string) => JSON.parse(readFileSync(join(here, "fixtures", "sharecard", n), "utf8"));
const ON = { enabled: true } as const;

const outcomeStmt = (outcome: string) =>
  signStatement({
    typ: "AAP-Outcome/v1", signing_key_id: TEST_KID, unit_kind: "pull_request",
    pr_record_digest: "a".repeat(64), outcome, window_days: 7,
  });
const cardStmt = (lines: unknown[], extra: Record<string, unknown> = {}) =>
  signStatement({
    typ: "AAP-ShareCard/v1", signing_key_id: TEST_KID, source_digest: "b".repeat(64), lines, ...extra,
  });
const GOOD_LINES = [
  { class: "measured", text: "3 of 4 commits from recorded sessions" },
  { class: "verdict", text: "On goal in 5 of 6 judged turns", coverage: { judged: 6, total: 12 } },
  { class: "outcome", text: "Accepted, no revert in 7 days" },
];

afterEach(() => { delete process.env.AIP_RENDER_LINES; });

describe("flag", () => {
  it("OFF by default: no lines, even for a valid card", async () => {
    const r = await renderLines(rec("golden-share-card.json"), { jwks: await testJwks() });
    expect(r).toEqual({ ok: false, lines: [], reasons: [R.render_lines_disabled] });
    expect(renderLinesEnabled()).toBe(false);
  });
  it("ON via option and via AIP_RENDER_LINES=1", async () => {
    const jwks = await testJwks();
    expect((await renderLines(rec("golden-share-card.json"), { jwks, enabled: true })).ok).toBe(true);
    process.env.AIP_RENDER_LINES = "1";
    expect((await renderLines(rec("golden-share-card.json"), { jwks })).ok).toBe(true);
    process.env.AIP_RENDER_LINES = "0";
    expect((await renderLines(rec("golden-share-card.json"), { jwks })).ok).toBe(false);
  });
  it("is not re-exported from the default index", async () => {
    const idx = await import("../src/index.js");
    expect("renderLines" in idx).toBe(false);
  });
});

describe("renders only signed lines", () => {
  it("golden card statement: three lines, claim-lint clean, exact shape", async () => {
    const r = await renderLines(rec("golden-share-card.json"), { ...ON, jwks: await testJwks() });
    expect(r.ok).toBe(true);
    expect(r.lines.map((l) => l.class)).toEqual(["measured", "verdict", "outcome"]);
    expect(r.lines[1]!.coverage).toEqual({ judged: 6, total: 12 });
    expect(lintRendering({ surface: "share_card", lines: r.lines }).ok).toBe(true);
  });
  it("a clean outcome line mentioning 'revert' is not marked as a revert (text is never parsed)", async () => {
    const jwks = await testJwks();
    for (const surface of ["share_card"] as const) {
      const r = await renderLines(rec("golden-share-card.json"), { ...ON, jwks, surface });
      expect(r.ok).toBe(true);
      expect(r.lines.find((l) => l.text === "Accepted, no revert in 7 days")?.revert).toBeUndefined();
      expect(r.lines.some((l) => l.revert)).toBe(false);
    }
    // Flag off: nothing at all.
    expect((await renderLines(rec("golden-share-card.json"), { jwks })).lines).toEqual([]);
  });
  it("only signed outcome values mark the revert line, in both outcomes", async () => {
    const jwks = await testJwks();
    const c = await cardStmt(GOOD_LINES);
    for (const [outs, text] of [[["reverted"], "1 of 1 changes reverted"], [["accepted_no_revert"], "0 of 1 changes reverted"]] as const) {
      const r = await renderLines({ typ: BUNDLE_TYP, statements: [c, ...(await Promise.all(outs.map(outcomeStmt)))] }, { ...ON, jwks, surface: "period_card" });
      expect(r.ok).toBe(true);
      expect(r.lines.filter((l) => l.revert).map((l) => l.text)).toEqual([text]);
      expect(r.lines.find((l) => l.text === "Accepted, no revert in 7 days")?.revert).toBeUndefined();
    }
  });
  it("a bundle renders the card statement's lines", async () => {
    const r = await renderLines(rec("golden-bundle.json"), { ...ON, jwks: await testJwks() });
    expect(r.ok).toBe(true);
    expect(r.lines).toHaveLength(3);
  });
  it("tampered line text fails closed with no lines", async () => {
    const c = rec("golden-share-card.json");
    c.lines[0].text = "400 of 4 commits from recorded sessions";
    const r = await renderLines(c, { ...ON, jwks: await testJwks() });
    expect(r.ok).toBe(false);
    expect(r.lines).toEqual([]);
    expect(r.reasons[0]).toBe(R.not_verifiable);
  });
  it("missing key fails closed", async () => {
    expect((await renderLines(rec("golden-share-card.json"), ON)).reasons).toEqual([R.missing_key]);
  });
});

describe("render-estimate: an estimate cannot be rendered", () => {
  it("an estimate line on a signed card is refused by verify (nothing rendered)", async () => {
    const jwks = await testJwks();
    const c = await cardStmt([...GOOD_LINES, { class: "estimate", text: "Saved about $12" }]);
    const r = await renderLines(c, { ...ON, jwks });
    expect(r.ok).toBe(false);
    expect(r.lines).toEqual([]);
  });
  it("estimate-worded text in an allowed class fails lint", async () => {
    const jwks = await testJwks();
    const c = await cardStmt([{ class: "measured", text: "Estimated savings 38% cheaper" }]);
    const r = await renderLines(c, { ...ON, jwks });
    expect(r.ok).toBe(false);
    expect(r.reasons).toEqual([R.lint_failed]);
    expect(r.lines).toEqual([]);
  });
  it("an estimate passed alongside, even a qualifying one, never renders on a card", async () => {
    const qualifying = { method: "lower_bound", counting_floor_tokens: 200_000, net_of_mu: true, reports_loss: true, net_lower_bound: 4.2 };
    for (const surface of ["share_card", "period_card"] as const) {
      expect(shouldRenderEstimate(qualifying, surface).render).toBe(false);
      const r = await renderLines({ ...rec("golden-share-card.json"), estimate: qualifying }, { ...ON, jwks: await testJwks(), surface });
      expect(r.ok).toBe(false);
      expect(r.reasons[0]).toBe(R.estimate_not_renderable);
      expect(r.lines).toEqual([]);
    }
  });
  it("numeric card label carrying estimate words fails", async () => {
    const c = baseCard();
    (c.lines as { label: string }[])[0]!.label = "Savings estimate";
    const r = await renderLines(await signWithTestKey(c), { ...ON, publicKey: await testPublicKeyHex() });
    expect(r.ok).toBe(false);
    expect(r.lines).toEqual([]);
  });
});

describe("period card always shows the revert line", () => {
  it("statements: revert line derived from signed outcomes, including 0 of N", async () => {
    const jwks = await testJwks();
    const c = await cardStmt(GOOD_LINES);
    for (const [outs, text] of [[["reverted", "accepted_no_revert"], "1 of 2 changes reverted"], [["accepted_no_revert"], "0 of 1 changes reverted"]] as const) {
      const bundle = { typ: BUNDLE_TYP, statements: [c, ...(await Promise.all(outs.map(outcomeStmt)))] };
      const r = await renderLines(bundle, { ...ON, jwks, surface: "period_card" });
      expect(r.ok).toBe(true);
      expect(r.lines.some((l) => l.revert === true && l.text === text)).toBe(true);
      expect(lintRendering({ surface: "period_card", lines: r.lines }).ok).toBe(true);
    }
  });
  it("period card with no signed outcomes fails closed rather than omit the revert line", async () => {
    const r = await renderLines(rec("golden-share-card.json"), { ...ON, jwks: await testJwks(), surface: "period_card" });
    expect(r.ok).toBe(false);
    expect(r.reasons).toContain(R.period_card_without_outcomes);
  });
  it("numeric period card with revert line renders it; one without fails", async () => {
    const pk = await testPublicKeyHex();
    const r = await renderLines(card("period-revert.json"), { ...ON, publicKey: pk, surface: "period_card" });
    expect(r.ok).toBe(true);
    expect(r.lines.filter((l) => l.revert)).toEqual([{ class: "outcome", text: "Changes reverted: 2", revert: true }]);
    expect(lintRendering({ surface: "period_card", lines: r.lines }).ok).toBe(true);
    const none = await renderLines(card("valid.json"), { ...ON, publicKey: pk, surface: "period_card" });
    expect(none.ok).toBe(false);
    expect(none.reasons).toEqual([R.period_card_without_revert_line]);
  });
  it("numeric share card renders and lints clean", async () => {
    const r = await renderLines(card("valid.json"), { ...ON, publicKey: await testPublicKeyHex() });
    expect(r.ok).toBe(true);
    expect(r.lines.map((l) => l.text)).toEqual(["Changes reviewed: 42", "Checks passed: 40"]);
  });
});

describe("identifying fields fail", () => {
  it.each(["repo", "branch", "pr_title", "commit_message"])("numeric card with %s (validly signed)", async (n) => {
    const r = await renderLines(card(`identifying-${n}.json`), { ...ON, publicKey: await testPublicKeyHex() });
    expect(r.ok).toBe(false);
    expect(r.lines).toEqual([]);
    expect(r.reasons[0]).toBe(R.identifying_field);
  });
  it.each([["repo", "mnemom/secret"], ["org", "acme"], ["person", "Jo"], ["tool_name", "Bash"], ["goal_text", "ship X"]])(
    "signed statement line with %s", async (k, v) => {
      const c = await cardStmt([{ class: "measured", text: "3 commits recorded", [k]: v }]);
      const r = await renderLines(c, { ...ON, jwks: await testJwks() });
      expect(r.ok).toBe(false);
      expect(r.lines).toEqual([]);
      expect(r.reasons[0]).toContain(R.identifying_field);
    });
  it("signed statement with an identifying top-level field", async () => {
    const c = await cardStmt(GOOD_LINES, { repo: "mnemom/secret-repo" });
    const r = await renderLines(c, { ...ON, jwks: await testJwks() });
    expect(r.ok).toBe(false);
    expect(r.reasons[0]).toContain(R.identifying_field);
  });
});

describe("misc", () => {
  it("unknown surface and non-object input fail closed", async () => {
    expect((await renderLines(rec("golden-share-card.json"), { ...ON, jwks: await testJwks(), surface: "record_page" as never })).reasons).toEqual([R.unknown_surface]);
    expect((await renderLines(null, ON)).ok).toBe(false);
  });
  it("digest helper still links (sanity that fixtures are unchanged)", () => {
    expect(statementDigest(rec("golden-share-card.json"))).toMatch(/^[0-9a-f]{64}$/);
  });
});
