import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { renderLines, RENDER_LINES_REASONS as R } from "../src/render-lines.js";
import type { RenderedLine } from "../src/render-lines.js";
import { lintRendering, LINT_RULES } from "../src/claim-lint.js";
import { verify } from "../src/verify-record.js";
import { TEST_KID, signStatement, testJwks } from "./helpers/sign.js";

/**
 * Revert test for the claim-table restriction in `renderLines` (I6): a card shows
 * only lines backed by a signed claim, in a card class the claim table allows.
 *
 * `renderUnrestricted` is a renderer variant with that restriction removed: it
 * copies whatever lines it is handed, with no class allowlist and no re-lint.
 * The tests prove (1) the variant does emit a line no signed claim backs, (2)
 * claim-lint rejects that line, and (3) the real renderer refuses it. If someone
 * deletes the restriction from `renderLines`, (3) fails.
 */

const here = dirname(fileURLToPath(import.meta.url));
const golden = () => JSON.parse(readFileSync(join(here, "fixtures", "record", "golden-share-card.json"), "utf8"));
const ON = { enabled: true } as const;

/** The restriction removed: no class check, no lint. Never exported from src. */
function renderUnrestricted(lines: RenderedLine[]) {
  return { ok: lines.length > 0, lines, reasons: [] as string[] };
}

const UNBACKED: RenderedLine[] = [
  { class: "estimate" as never, text: "Saved about 40% of tokens" },
  { class: "benchmark" as never, text: "Faster than the median team" },
];

describe("I6 revert: a renderer without the claim-table restriction is caught", () => {
  it("the unrestricted variant emits lines that no signed claim backs", async () => {
    const jwks = await testJwks();
    const signed = await renderLines(golden(), { ...ON, jwks });
    expect(signed.ok).toBe(true);
    const out = renderUnrestricted([...signed.lines, ...UNBACKED]);
    expect(out.ok).toBe(true);
    const backed = new Set(signed.lines.map((l) => l.text));
    const unbacked = out.lines.filter((l) => !backed.has(l.text));
    expect(unbacked.map((l) => l.text)).toEqual(UNBACKED.map((l) => l.text));
  });

  it.each(["share_card", "period_card"] as const)("claim-lint rejects the unbacked lines on %s", (surface) => {
    for (const line of UNBACKED) {
      const lint = lintRendering({ surface, lines: [line] });
      expect(lint.ok).toBe(false);
      expect(lint.violations.map((v) => v.rule)).toContain(LINT_RULES.card_class_not_allowed);
    }
  });

  it("the verifier rejects a signed card that carries an unbacked class", async () => {
    const jwks = await testJwks();
    const c = await signStatement({
      typ: "AAP-ShareCard/v1", signing_key_id: TEST_KID, source_digest: "b".repeat(64),
      lines: [{ class: "estimate", text: "Saved about 40% of tokens" }],
    });
    expect((await verify(c, jwks)).valid).toBe(false);
    const r = await renderLines(c, { ...ON, jwks });
    expect(r.ok).toBe(false);
    expect(r.lines).toEqual([]);
  });

  it("the real renderer refuses a line outside the allowed classes even when the statement is validly signed", async () => {
    const jwks = await testJwks();
    const c = await signStatement({
      typ: "AAP-ShareCard/v1", signing_key_id: TEST_KID, source_digest: "b".repeat(64),
      lines: [
        { class: "measured", text: "3 of 4 commits from recorded sessions" },
        { class: "estimate", text: "Saved about 40% of tokens" },
      ],
    });
    const r = await renderLines(c, { ...ON, jwks });
    expect(r.ok).toBe(false);
    expect(r.lines).toEqual([]);
    expect(r.reasons.length).toBeGreaterThan(0);
    expect(r.reasons).not.toContain(R.render_lines_disabled);
  });

  it("the real renderer never emits a line outside the signed set, and its output lints clean", async () => {
    const jwks = await testJwks();
    const input = golden();
    const signedTexts = new Set(
      (input.lines as { text: string }[]).map((l) => l.text),
    );
    const r = await renderLines(input, { ...ON, jwks });
    expect(r.ok).toBe(true);
    for (const l of r.lines) expect(signedTexts.has(l.text)).toBe(true);
    expect(lintRendering({ surface: "share_card", lines: r.lines }).ok).toBe(true);
  });
  it("a validly signed line that passes verify but breaks the claim table is still refused by the renderer (lint is the second lock)", async () => {
    const jwks = await testJwks();
    const c = await signStatement({
      typ: "AAP-ShareCard/v1", signing_key_id: TEST_KID, source_digest: "b".repeat(64),
      lines: [{ class: "measured", text: "All changes are safe" }],
    });
    // The variant prints it; the restricted renderer must not.
    expect(renderUnrestricted([{ class: "measured", text: "All changes are safe" }]).ok).toBe(true);
    expect(lintRendering({ surface: "share_card", lines: [{ class: "measured", text: "All changes are safe" }] }).ok).toBe(false);
    const r = await renderLines(c, { ...ON, jwks });
    expect(r.ok).toBe(false);
    expect(r.lines).toEqual([]);
  });
});
