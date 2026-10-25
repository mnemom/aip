/**
 * Card line renderer (MNE-9026, criterion K4.3/K4.4, design C5-R6).
 *
 * `renderLines` turns signed input into the lines a share card or period card
 * may show, and nothing else. Every line is derived from a statement that
 * verified against the published key: there is no parameter that accepts a
 * typed number, a string or an estimate. Only measured, outcome and
 * verdict-with-coverage lines come out. Fail closed: on any problem `lines` is
 * empty, so a renderer that prints `result.lines` prints nothing.
 *
 * FLAG-GATED. This module is NOT re-exported from the package index. It is
 * reachable only via the `@mnemom/aip-verifier/render-lines` subpath, and even
 * there it returns `render_lines_disabled` (no lines) unless the caller passes
 * `opts.enabled: true` or the environment sets `AIP_RENDER_LINES=1`. Default
 * behavior and the existing published API are unchanged.
 *
 * Accepted inputs (`opts` says which key verifies them):
 *   1. A record bundle or a single `AAP-ShareCard/v1` record statement
 *      (`{class, text, coverage}` lines), verified with `opts.jwks` through the
 *      existing `verify`. A period card additionally needs signed
 *      `AAP-Outcome/v1` statements in the bundle: its revert line is derived
 *      from them, never typed.
 *   2. The MNE-9022 numeric card (`card_id`, `{id, kind, label, value}` lines),
 *      verified with `opts.publicKey` through the existing `verifyShareCard`.
 *
 * Every rendered line is re-checked with `lintRendering` on the chosen
 * surface; any violation makes the whole render fail.
 */

import { lintRendering } from "./claim-lint.js";
import type { LintViolation } from "./claim-lint.js";
import { shouldRenderEstimate } from "./render-estimate.js";
import { validateShareCardShape, verifyShareCard } from "./sharecard.js";
import { verify } from "./verify-record.js";
import type { RecordJwks } from "./statements.js";

/**
 * One line the CLI (or any consumer) may print, verbatim. Contract:
 * - `class` is exactly one of `measured`, `outcome`, `verdict`. No estimate,
 *   benchmark or savings class can be produced.
 * - `text` is display text, already claim-lint clean. Print it as is; never
 *   append a figure, tool name, repo, org or person.
 * - `coverage` is present on every `verdict` line ("judged of total") and
 *   absent on the other classes.
 * - `revert` is true on the line that reports reverts. A period card always
 *   contains at least one such line.
 * Structurally assignable to claim-lint's `RenderedLine`.
 */
export interface RenderedLine {
  class: "measured" | "outcome" | "verdict";
  text: string;
  coverage?: { judged: number; total: number };
  revert?: true;
}

export type RenderSurface = "share_card" | "period_card";

export interface RenderLinesOptions {
  /** Which card is being drawn. Default `share_card`. */
  surface?: RenderSurface;
  /** Explicit flag. Also on when `AIP_RENDER_LINES=1`. */
  enabled?: boolean;
  /** Published JWKS, to verify record statements. */
  jwks?: RecordJwks;
  /** Trusted Ed25519 public key (hex or bytes), to verify a numeric card. */
  publicKey?: string | Uint8Array;
}

export const RENDER_LINES_REASONS = {
  render_lines_disabled: "render_lines_disabled",
  unknown_surface: "unknown_surface",
  not_verifiable: "not_verifiable",
  missing_key: "missing_key",
  no_share_card_statement: "no_share_card_statement",
  identifying_field: "identifying_field",
  line_class_not_allowed: "line_class_not_allowed",
  line_malformed: "line_malformed",
  no_lines: "no_lines",
  period_card_without_outcomes: "period_card_without_outcomes",
  period_card_without_revert_line: "period_card_without_revert_line",
  estimate_not_renderable: "estimate_not_renderable",
  lint_failed: "lint_failed",
} as const;

export interface RenderLinesResult {
  ok: boolean;
  /** Empty unless `ok`. */
  lines: RenderedLine[];
  /** Stable reason strings; prefixed detail follows a colon. */
  reasons: string[];
  /** claim-lint violations when `lint_failed`. */
  violations?: LintViolation[];
}

const R = RENDER_LINES_REASONS;

/** Flag read; safe where `process` does not exist (Workers, browsers). */
export function renderLinesEnabled(opts?: RenderLinesOptions): boolean {
  if (opts?.enabled === true) return true;
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
  return env?.AIP_RENDER_LINES === "1";
}

const fail = (reasons: string[], violations?: LintViolation[]): RenderLinesResult => ({
  ok: false,
  lines: [],
  reasons,
  ...(violations ? { violations } : {}),
});

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Keys a record share card statement may carry. Anything else (repo, org,
 * person, goal text, tool name, estimate, ...) fails the render, even though
 * the statement is signed: a signature proves origin, not that a field is safe
 * to show.
 */
const STATEMENT_KEYS = new Set([
  "typ", "signing_key_id", "signature", "alg", "built_at", "previous_digest",
  "commitment_key_id", "unit_kind", "source_digest", "lines",
]);
const STATEMENT_LINE_KEYS = new Set(["class", "text", "coverage"]);
const COVERAGE_KEYS = new Set(["judged", "total"]);

function unknownKeys(o: Record<string, unknown>, allowed: Set<string>, where: string): string[] {
  return Object.keys(o).filter((k) => !allowed.has(k)).map((k) => `${R.identifying_field}:${where}.${k}`);
}

/** Fixed, signed-outcome vocabulary: the outcome statement's `outcome` field never prints raw. */
function outcomeKind(s: Record<string, unknown>): "reverted" | "accepted" | null {
  if (typeof s.outcome !== "string") return null;
  if (s.outcome === "accepted_no_revert") return "accepted";
  if (s.outcome === "reverted") return "reverted";
  return null;
}

function finish(surface: RenderSurface, lines: RenderedLine[]): RenderLinesResult {
  if (lines.length === 0) return fail([R.no_lines]);
  if (surface === "period_card" && !lines.some((l) => l.revert === true)) {
    return fail([R.period_card_without_revert_line]);
  }
  // Lint the exact text a consumer will print; the `revert` marker is ours, not a lint field.
  const lintLines = lines.map(({ revert: _revert, ...l }) => l);
  const lint = lintRendering({ surface, lines: lintLines });
  if (!lint.ok) return fail([R.lint_failed], lint.violations);
  return { ok: true, lines, reasons: [] };
}

async function renderFromStatements(input: Record<string, unknown>, surface: RenderSurface, jwks: RecordJwks): Promise<RenderLinesResult> {
  const v = await verify(input, jwks);
  if (!v.valid) return fail([R.not_verifiable, ...v.reasons]);

  const statements = (Array.isArray(input.statements) ? input.statements : [input]) as Record<string, unknown>[];
  const cards = statements.filter((s) => isObj(s) && s.typ === "AAP-ShareCard/v1");
  if (cards.length === 0) return fail([R.no_share_card_statement]);

  const errors: string[] = [];
  const lines: RenderedLine[] = [];
  cards.forEach((card, ci) => {
    errors.push(...unknownKeys(card, STATEMENT_KEYS, `card${ci}`));
    const raw = Array.isArray(card.lines) ? (card.lines as unknown[]) : [];
    raw.forEach((l, i) => {
      const where = `card${ci}.lines[${i}]`;
      if (!isObj(l)) return void errors.push(`${R.line_malformed}:${where}`);
      errors.push(...unknownKeys(l, STATEMENT_LINE_KEYS, where));
      if (l.class !== "measured" && l.class !== "outcome" && l.class !== "verdict") {
        return void errors.push(`${R.line_class_not_allowed}:${where}`);
      }
      if (typeof l.text !== "string" || l.text.length === 0) return void errors.push(`${R.line_malformed}:${where}`);
      const out: RenderedLine = { class: l.class, text: l.text };
      if (l.class === "verdict") {
        const c = l.coverage;
        if (!isObj(c)) return void errors.push(`${R.line_malformed}:${where}.coverage`);
        errors.push(...unknownKeys(c, COVERAGE_KEYS, `${where}.coverage`));
        out.coverage = { judged: c.judged as number, total: c.total as number };
      } else if (l.coverage !== undefined && l.coverage !== null) {
        errors.push(`${R.identifying_field}:${where}.coverage`);
      }
      // `revert` is never inferred from display text ("Accepted, no revert in 7 days" is a clean outcome);
      // it is set only on the line derived from signed AAP-Outcome/v1 values below, or a numeric `revert` kind.
      lines.push(out);
    });
  });

  if (surface === "period_card") {
    const outcomes = statements.filter((s) => isObj(s) && s.typ === "AAP-Outcome/v1");
    if (outcomes.length === 0) errors.push(R.period_card_without_outcomes);
    else {
      const kinds = outcomes.map(outcomeKind);
      if (kinds.includes(null)) errors.push(`${R.line_malformed}:outcome`);
      else {
        const reverted = kinds.filter((k) => k === "reverted").length;
        // Always present on a period card, including "0 of N": silence about reverts is not allowed.
        lines.push({ class: "outcome", text: `${reverted} of ${kinds.length} changes reverted`, revert: true });
      }
    }
  }
  if (errors.length > 0) return fail(errors);
  return finish(surface, lines);
}

async function renderFromNumericCard(card: unknown, surface: RenderSurface, publicKey: string | Uint8Array): Promise<RenderLinesResult> {
  // Shape first: identifying fields get their own named reason.
  const shape = validateShareCardShape(card);
  if (shape.length > 0) {
    const ident = shape.some((e) => /identifying field/.test(e));
    return fail([ident ? R.identifying_field : R.not_verifiable, ...shape]);
  }
  const v = await verifyShareCard(card, { publicKey });
  if (!v.valid) return fail([R.not_verifiable, ...v.errors]);
  const lines: RenderedLine[] = v.lines.map((l) =>
    l.kind === "revert"
      ? { class: "outcome", text: `${l.label}: ${l.value}`, revert: true }
      : { class: "measured", text: `${l.label}: ${l.value}` },
  );
  return finish(surface, lines);
}

/**
 * Derive the lines to show for a card from signed input. See the module doc
 * for accepted inputs and the flag. Never throws.
 */
export async function renderLines(input: unknown, opts: RenderLinesOptions = {}): Promise<RenderLinesResult> {
  try {
    if (!renderLinesEnabled(opts)) return fail([R.render_lines_disabled]);
    const surface = opts.surface ?? "share_card";
    if (surface !== "share_card" && surface !== "period_card") return fail([R.unknown_surface]);
    if (!isObj(input)) return fail([R.not_verifiable]);
    // An estimate has no input path: reject one handed in alongside, then render nothing from it.
    if ("estimate" in input || "savings" in input) {
      const d = shouldRenderEstimate(input.estimate ?? input.savings, surface);
      return fail([R.estimate_not_renderable, ...d.reasons]);
    }
    if ("card_id" in input) {
      if (opts.publicKey === undefined) return fail([R.missing_key]);
      return await renderFromNumericCard(input, surface, opts.publicKey);
    }
    if (!opts.jwks) return fail([R.missing_key]);
    return await renderFromStatements(input, surface, opts.jwks);
  } catch {
    return fail([R.not_verifiable]);
  }
}
