/**
 * Share page (C5-R8). The signed card arrives in the URL fragment,
 * `#card=<base64url of the JSON>`. Browsers never send a fragment to a
 * server, and the CSP (`connect-src 'none'`) stops the page sending it
 * anywhere itself. The card is verified here with `renderLines` against the
 * key set baked into this build, and the page draws only the lines
 * `renderLines` returns: no number, label or field is read from the card
 * directly. On any failure it draws the failure message and no card text.
 */
import { renderLines } from "@mnemom/aip-verifier/render-lines";
import type { RenderedLine } from "@mnemom/aip-verifier/render-lines";

import { PUBLISHED_JWKS } from "./keys.js";

/** A fragment card larger than this is refused before it is decoded. */
const MAX_FRAGMENT_CHARS = 64 * 1024;

type Jwks = NonNullable<Parameters<typeof renderLines>[1]>["jwks"];

function $(id: string): HTMLElement {
  const node = document.getElementById(id);
  if (!node) throw new Error(`missing #${id}`);
  return node;
}

/** Decode `#card=<base64url>`; `null` when there is no card or it is not JSON. */
export function cardFromFragment(hash: string): { card?: unknown; error?: "none" | "malformed" } {
  const m = /^#card=([A-Za-z0-9_-]+)$/.exec(hash);
  if (!m) return { error: hash === "" || hash === "#" ? "none" : "malformed" };
  const b64 = m[1] as string;
  if (b64.length > MAX_FRAGMENT_CHARS) return { error: "malformed" };
  try {
    const bin = atob(b64.replace(/-/g, "+").replace(/_/g, "/"));
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return { card: JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) };
  } catch {
    return { error: "malformed" };
  }
}

function show(id: string, on: boolean): void {
  $(id).hidden = !on;
}

function message(text: string, neutral = false): void {
  const node = $("message");
  node.textContent = text;
  node.className = neutral ? "neutral" : "";
  show("message", true);
}

function drawLines(lines: RenderedLine[]): void {
  const list = $("card-lines");
  list.replaceChildren();
  for (const line of lines) {
    const li = document.createElement("li");
    li.dataset.class = line.class;
    if (line.revert === true) {
      li.classList.add("revert");
      const tag = document.createElement("span");
      tag.className = "tag";
      tag.textContent = "Reverted";
      li.append(tag);
    }
    li.append(document.createTextNode(line.text));
    if (line.coverage) {
      const cov = document.createElement("span");
      cov.className = "coverage";
      cov.textContent = `${line.coverage.judged} of ${line.coverage.total} judged`;
      li.append(cov);
    }
    list.append(li);
  }
  show("card-lines", true);
}

function reset(): void {
  show("status", false);
  show("card-lines", false);
  show("message", false);
  $("card-lines").replaceChildren();
  document.title = "Signed work record - Mnemom";
}

export async function run(): Promise<void> {
  reset();
  const { card, error } = cardFromFragment(location.hash);
  if (error === "none") return message("This link has no card in it.", true);
  if (error) return message("This card could not be read. Nothing on it can be trusted.");

  if (!globalThis.crypto?.subtle) {
    return message("This browser exposes no Web Crypto to this page, so the signature cannot be checked. Open the link over https.");
  }

  const jwks = (__TEST_JWKS__ ?? PUBLISHED_JWKS) as unknown as Jwks;
  const result = await renderLines(card, { enabled: true, surface: "share_card", jwks });
  if (!result.ok) {
    // Stable reason codes only (the part before any colon); never card text.
    // Bundle reasons read "0:signature_invalid"; drop the statement index.
    const codes = result.reasons
      .map((r) => r.replace(/^\d+:/, "").split(":")[0])
      .filter((c): c is string => !!c && /^[a-z_]+$/.test(c))
      .slice(0, 3);
    document.title = "Unverified card - Mnemom";
    message(`This card could not be verified. Nothing on it can be trusted. (${codes.join(", ")})`);
    return;
  }
  const status = $("status");
  status.textContent = "Verified offline";
  show("status", true);
  drawLines(result.lines);
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => void run());
else void run();
window.addEventListener("hashchange", () => void run());
