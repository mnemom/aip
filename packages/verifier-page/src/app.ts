/**
 * Threat model: packages/verifier-page/THREAT-MODEL.md
 *
 * Verifier page. Paste or drop a signed statement or a record bundle, and
 * the page verifies it with @mnemom/aip-verifier against the key set in the
 * second box. Everything runs in the browser; the page makes no requests.
 */
import { verify, FLAGS, REASONS } from "@mnemom/aip-verifier";
import type { RecordVerificationResult } from "@mnemom/aip-verifier";

import { PUBLISHED_JWKS, PUBLISHED_JWKS_TAKEN_ON } from "./keys.js";

interface RecordJwksLike {
  keys: Array<Record<string, unknown>>;
}

/** Human-readable text for each reason the verifier can return. */
const REASON_TEXT: Record<string, string> = {
  [REASONS.not_an_object]: "The statement is not a JSON object.",
  [REASONS.unknown_typ]: "The statement's typ is not one the verifier knows.",
  [REASONS.unsupported_alg]: "The signature algorithm is not EdDSA.",
  [REASONS.signing_key_id_missing]: "The statement names no signing key.",
  [REASONS.signature_missing]: "The statement carries no signature.",
  [REASONS.signature_malformed]: "The signature is not valid base64url.",
  [REASONS.key_not_found]: "The signing key is not in the key set.",
  [REASONS.key_not_ed25519]: "The named key is not an Ed25519 key.",
  [REASONS.signature_invalid]: "The signature does not match the statement. The statement was altered after signing, or signed by another key.",
  [REASONS.bundle_not_an_object]: "The input is not a JSON object.",
  [REASONS.bundle_unknown_typ]: "The input's typ is neither a statement nor a record bundle.",
  [REASONS.bundle_statements_missing]: "The bundle has no statements array.",
  [REASONS.digest_malformed]: "A digest is not 64 lowercase hex characters.",
  [REASONS.linked_statement_wrong_typ]: "A digest points at a statement of the wrong type.",
  [REASONS.card_line_class_not_allowed]: "The share card carries a line class a card may not show.",
  [REASONS.card_verdict_without_coverage]: "The share card states a verdict its source does not cover.",
};

const FLAG_TEXT: Record<string, string> = {
  [FLAGS.card_hash_not_recorded]: "A checkpoint recorded no card hash.",
  [FLAGS.card_not_bound]: "A checkpoint carries no signed card commitment.",
  [FLAGS.linked_statement_not_in_bundle]: "A digest names a statement outside this bundle.",
};

function $<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el as T;
}

function parseJson(text: string): { value?: unknown; error?: string } {
  if (!text.trim()) return { error: "empty" };
  try {
    return { value: JSON.parse(text) };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

function isJwks(value: unknown): value is RecordJwksLike {
  return typeof value === "object" && value !== null && Array.isArray((value as { keys?: unknown }).keys);
}

function el(tag: string, className: string | null, text?: string): HTMLElement {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Reasons at the bundle level look like "0:signature_invalid"; split them. */
function splitReason(reason: string): { index: number | null; code: string } {
  const m = /^(\d+):(.+)$/.exec(reason);
  return m ? { index: Number(m[1]), code: m[2] as string } : { index: null, code: reason };
}

function render(result: RecordVerificationResult, inputTyp: string | null): void {
  const out = $("result");
  out.replaceChildren();
  out.dataset.valid = String(result.valid);

  const headline = el("p", `verdict ${result.valid ? "verdict-valid" : "verdict-invalid"}`);
  headline.id = "verdict";
  headline.textContent = result.valid ? "Verified" : "Not verified";
  out.append(headline);

  const meta = el("dl", "meta");
  const add = (k: string, v: string) => {
    meta.append(el("dt", null, k), el("dd", null, v));
  };
  add("Input", inputTyp ?? "unknown");
  add("Statements", String(result.statements.length));
  add("Checked at", result.verified_at);
  out.append(meta);

  if (result.reasons.length) {
    const h = el("h3", null, "Reasons");
    const ul = el("ul", "reasons");
    ul.id = "reasons";
    for (const r of result.reasons) {
      const { index, code } = splitReason(r);
      const li = el("li", null);
      li.dataset.reason = code;
      const where = index === null ? "" : `statement ${index}: `;
      li.append(el("code", null, r), document.createTextNode(` ${where}${REASON_TEXT[code] ?? ""}`.trimEnd()));
      ul.append(li);
    }
    out.append(h, ul);
  }

  if (result.flags.length) {
    const h = el("h3", null, "Flags");
    const ul = el("ul", "flags");
    ul.id = "flags";
    for (const f of result.flags) {
      const li = el("li", null);
      li.dataset.flag = f.flag;
      li.append(el("code", null, f.flag), document.createTextNode(` ${FLAG_TEXT[f.flag] ?? ""} (${f.subject})`));
      ul.append(li);
    }
    out.append(h, ul);
  }

  const table = el("table", "statements");
  table.id = "statements";
  const head = el("tr", null);
  for (const col of ["#", "typ", "signing key", "digest", "result"]) head.append(el("th", null, col));
  table.append(head);
  result.statements.forEach((s, i) => {
    const tr = el("tr", s.valid ? "ok" : "bad");
    tr.dataset.index = String(i);
    tr.append(
      el("td", null, String(i)),
      el("td", null, s.typ ?? "?"),
      el("td", null, s.signing_key_id ?? "?"),
      el("td", "digest", s.digest ?? "?"),
      el("td", null, s.valid ? "valid" : s.reasons.join(", ")),
    );
    table.append(tr);
  });
  out.append(table);
}

function showError(message: string): void {
  const out = $("result");
  out.replaceChildren();
  out.dataset.valid = "error";
  const p = el("p", "verdict verdict-error", message);
  p.id = "verdict";
  out.append(p);
}

async function run(): Promise<void> {
  // The Ed25519 check needs crypto.subtle, which browsers expose only in
  // secure contexts (https, localhost, file://). Without it the verifier's
  // check throws and every valid statement would read signature_invalid.
  if (!globalThis.crypto?.subtle) {
    showError(
      "This browser exposes no Web Crypto (crypto.subtle) to this page, so signatures cannot be checked. Open the page from https://, localhost, or a local file: browsers allow Web Crypto only in a secure context.",
    );
    return;
  }

  const inputText = $<HTMLTextAreaElement>("input").value;
  const jwksText = $<HTMLTextAreaElement>("jwks").value;

  const jwks = parseJson(jwksText);
  if (jwks.error || !isJwks(jwks.value)) {
    showError(`The key set is not a JWKS document with a keys array${jwks.error ? ` (${jwks.error})` : ""}.`);
    return;
  }
  const input = parseJson(inputText);
  if (input.error === "empty") {
    showError("Paste a statement or a record bundle first.");
    return;
  }
  if (input.error) {
    showError(`The input is not valid JSON (${input.error}).`);
    return;
  }

  const typ =
    typeof input.value === "object" && input.value !== null && typeof (input.value as { typ?: unknown }).typ === "string"
      ? ((input.value as { typ: string }).typ)
      : null;
  // The verifier takes parsed JSON and a JWKS; it never throws and never
  // touches the network.
  const result = await verify(input.value, jwks.value as Parameters<typeof verify>[1]);
  render(result, typ);
}

function wire(): void {
  const jwksBox = $<HTMLTextAreaElement>("jwks");
  jwksBox.value = JSON.stringify(PUBLISHED_JWKS, null, 2);
  $("keys-note").textContent = `Prefilled with the Mnemom signing keys published at api.mnemom.ai, snapshot of ${PUBLISHED_JWKS_TAKEN_ON} (kid ${PUBLISHED_JWKS.keys.map((k) => k.kid).join(", ")}). Replace it to verify against other keys.`;

  $("verify").addEventListener("click", () => void run());

  const input = $<HTMLTextAreaElement>("input");
  const drop = $("drop");
  const stop = (e: Event) => {
    e.preventDefault();
    e.stopPropagation();
  };
  for (const name of ["dragenter", "dragover"]) {
    drop.addEventListener(name, (e) => {
      stop(e);
      drop.classList.add("over");
    });
  }
  drop.addEventListener("dragleave", (e) => {
    stop(e);
    drop.classList.remove("over");
  });
  drop.addEventListener("drop", (e) => {
    stop(e);
    drop.classList.remove("over");
    const file = (e as DragEvent).dataTransfer?.files?.[0];
    if (!file) return;
    void file.text().then((text) => {
      input.value = text;
      return run();
    });
  });
  $<HTMLInputElement>("file").addEventListener("change", (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    void file.text().then((text) => {
      input.value = text;
      return run();
    });
  });
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", wire);
else wire();

export { run, render };
