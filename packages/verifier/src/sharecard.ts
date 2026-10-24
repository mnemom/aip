/**
 * AAP-ShareCard/v1 — canonicalizer and offline verifier (MNE-9022).
 *
 * A share card is a signed set of numeric lines, each committing to the hash
 * of the signed statement it was derived from. Signing follows the
 * AAP-TransparencyRoot/v1 pattern (mnemom-api src/transparency/root_publisher.ts):
 * Ed25519 over canonical JSON (sorted keys, no whitespace) of the card MINUS
 * `signature`, with its own pinned `typ`. Renderers must display only the
 * `lines` returned by a successful verification.
 *
 * This module verifies only. It never handles private keys.
 */

import { verifyAsync } from "@noble/ed25519";
import { utf8ToBytes } from "@noble/hashes/utils.js";

import { hexToUint8 } from "./crypto.js";

export const SHARE_CARD_TYP = "AAP-ShareCard/v1";

export type ShareCardLineKind = "count" | "revert";

export interface ShareCardLine {
  id: string;
  kind: ShareCardLineKind;
  label: string;
  value: number;
  statement_hash: string;
}

export interface ShareCardStatementRef {
  typ: string;
  hash: string;
}

export interface ShareCard {
  typ: string;
  card_id: string;
  period: { start: string; end: string };
  issued_at: string;
  signing_key_id: string;
  statements: ShareCardStatementRef[];
  lines: ShareCardLine[];
  /** base64url Ed25519 signature over canonicalJson(card minus signature). */
  signature: string;
}

export interface ShareCardVerification {
  valid: boolean;
  /** Empty unless `valid`. Renderers must show only these. */
  lines: ShareCardLine[];
  errors: string[];
}

/** Keys that identify a repo, branch, PR or commit; never allowed anywhere. */
const IDENTIFYING_KEYS = new Set([
  "repo", "repository", "repo_name", "branch", "branch_name", "ref",
  "pr", "pr_title", "pull_request", "title", "commit", "commit_message",
  "commit_sha", "message", "author", "email", "url", "path",
]);

const CARD_KEYS = ["typ", "card_id", "period", "issued_at", "signing_key_id", "statements", "lines", "signature"];
const PERIOD_KEYS = ["start", "end"];
const STATEMENT_KEYS = ["typ", "hash"];
const LINE_KEYS = ["id", "kind", "label", "value", "statement_hash"];
const HEX64 = /^[0-9a-f]{64}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
/** Opaque identifiers: no "/", no free text. Mirrored in schemas/aap-sharecard.schema.json. */
const OPAQUE_ID = /^[a-z0-9_-]{1,64}$/;
/**
 * TODO(MNE-9022): label -> fixed label ID enum pending format sign-off.
 * Until then labels are restricted to a short, plain-text charset so they
 * cannot carry repo paths, branches, PR refs or URLs.
 */
const LABEL = /^[A-Za-z0-9 .,()+-]{1,40}$/;
const LABEL_MAX = 40;
/** Statement types a v1 card may commit to (the only type in v1 fixtures). */
export const SHARE_CARD_STATEMENT_TYPES: readonly string[] = ["AAP-Statement/v1"];
const SIGNATURE_LEN = 86; // 64 bytes, unpadded base64url
const RFC3339 = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|([+-])(\d{2}):(\d{2}))$/;

function isCalendarDate(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1) return false;
  const dim = [31, y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1]!;
  return d <= dim;
}

function isRfc3339(v: string): boolean {
  const m = RFC3339.exec(v);
  if (!m) return false;
  const [y, mo, d, h, mi, se] = m.slice(1, 7).map(Number) as [number, number, number, number, number, number];
  if (!isCalendarDate(y, mo, d) || h > 23 || mi > 59 || se > 59) return false;
  if (m[7] !== undefined && (Number(m[8]) > 23 || Number(m[9]) > 59)) return false;
  return true;
}

/** Sorted-key, whitespace-free JSON; identical to mnemom-api canonicalJson. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`)
    .join(",")}}`;
}

/** The exact string that is signed: canonical JSON of the card minus `signature`. */
export function shareCardSigningInput(card: Record<string, unknown>): string {
  const { signature: _signature, ...rest } = card;
  return canonicalJson(rest);
}

function bytesToBase64url(b: Uint8Array): string {
  let bin = "";
  for (const x of b) bin += String.fromCharCode(x);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Strict decode: exactly 86 chars that re-encode to the identical string (no malleable trailing bits). */
function base64urlToBytes(s: string): Uint8Array {
  if (s.length !== SIGNATURE_LEN || !/^[A-Za-z0-9_-]+$/.test(s)) throw new Error("bad base64url");
  const padded = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice(0, (4 - (s.length % 4)) % 4);
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  if (out.length !== 64 || bytesToBase64url(out) !== s) throw new Error("non-canonical base64url");
  return out;
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function exactKeys(obj: Record<string, unknown>, allowed: string[], where: string, errors: string[]): void {
  for (const k of Object.keys(obj)) {
    if (IDENTIFYING_KEYS.has(k.toLowerCase())) errors.push(`${where}: identifying field "${k}" is not allowed`);
    else if (!allowed.includes(k)) errors.push(`${where}: unknown field "${k}"`);
  }
  for (const k of allowed) if (!(k in obj)) errors.push(`${where}: missing field "${k}"`);
}

/** Structural validation (no signature check). Returns error strings. */
export function validateShareCardShape(card: unknown): string[] {
  const errors: string[] = [];
  if (!isObj(card)) return ["card: not an object"];
  exactKeys(card, CARD_KEYS, "card", errors);
  if (card.typ !== SHARE_CARD_TYP) errors.push(`card: typ must be ${SHARE_CARD_TYP}`);
  if (typeof card.card_id !== "string" || !OPAQUE_ID.test(card.card_id)) errors.push("card: card_id must be an opaque id matching ^[a-z0-9_-]{1,64}$");
  if (typeof card.issued_at !== "string" || !isRfc3339(card.issued_at)) errors.push("card: issued_at must be an RFC 3339 date-time");
  if (typeof card.signing_key_id !== "string" || !card.signing_key_id) errors.push("card: signing_key_id must be a non-empty string");
  if (typeof card.signature !== "string") errors.push("card: signature must be a string");
  else {
    try {
      base64urlToBytes(card.signature);
    } catch {
      errors.push("card: signature must be a canonical 86-char unpadded base64url Ed25519 signature");
    }
  }

  if (!isObj(card.period)) errors.push("period: not an object");
  else {
    exactKeys(card.period, PERIOD_KEYS, "period", errors);
    for (const k of PERIOD_KEYS) {
      const v = card.period[k];
      if (typeof v !== "string" || !DATE.test(v) || !isCalendarDate(Number(v.slice(0, 4)), Number(v.slice(5, 7)), Number(v.slice(8, 10)))) {
        errors.push(`period.${k}: must be a real calendar date YYYY-MM-DD`);
      }
    }
    const { start, end } = card.period;
    if (typeof start === "string" && typeof end === "string" && DATE.test(start) && DATE.test(end) && start > end) {
      errors.push("period: start must be <= end");
    }
  }

  const hashes = new Set<string>();
  const referenced = new Set<string>();
  const lineIds = new Set<string>();
  if (!Array.isArray(card.statements) || card.statements.length === 0) errors.push("statements: must be a non-empty array");
  else
    card.statements.forEach((s, i) => {
      if (!isObj(s)) return void errors.push(`statements[${i}]: not an object`);
      exactKeys(s, STATEMENT_KEYS, `statements[${i}]`, errors);
      if (typeof s.typ !== "string" || !SHARE_CARD_STATEMENT_TYPES.includes(s.typ)) {
        errors.push(`statements[${i}].typ: must be one of ${SHARE_CARD_STATEMENT_TYPES.join(", ")}`);
      }
      if (typeof s.hash !== "string" || !HEX64.test(s.hash)) errors.push(`statements[${i}].hash: must be 64 lowercase hex`);
      else hashes.add(s.hash);
    });

  if (!Array.isArray(card.lines) || card.lines.length === 0) errors.push("lines: must be a non-empty array");
  else
    card.lines.forEach((l, i) => {
      if (!isObj(l)) return void errors.push(`lines[${i}]: not an object`);
      exactKeys(l, LINE_KEYS, `lines[${i}]`, errors);
      if (typeof l.id !== "string" || !OPAQUE_ID.test(l.id)) errors.push(`lines[${i}].id: must be an opaque id matching ^[a-z0-9_-]{1,64}$`);
      else if (lineIds.has(l.id)) errors.push(`lines[${i}].id: duplicate line id "${l.id}"`);
      else lineIds.add(l.id);
      if (l.kind !== "count" && l.kind !== "revert") errors.push(`lines[${i}].kind: must be "count" or "revert"`);
      if (typeof l.label !== "string" || !l.label || l.label.length > LABEL_MAX || /[/#]|:\/\/|www\./i.test(l.label) || !LABEL.test(l.label)) {
        errors.push(`lines[${i}].label: must be short plain text (max ${LABEL_MAX}), no "/", "#" or URLs`);
      }
      if (typeof l.value !== "number" || !Number.isSafeInteger(l.value) || l.value < 0) errors.push(`lines[${i}].value: must be a non-negative integer`);
      if (typeof l.statement_hash !== "string" || !HEX64.test(l.statement_hash)) errors.push(`lines[${i}].statement_hash: must be 64 lowercase hex`);
      else if (!hashes.has(l.statement_hash)) errors.push(`lines[${i}].statement_hash: not committed in statements`);
      else referenced.add(l.statement_hash);
    });
  for (const h of hashes) if (!referenced.has(h)) errors.push(`statements: ${h} is not referenced by any line`);
  return errors;
}

/**
 * Verify a share card offline against a trusted Ed25519 public key.
 * Fails closed: on any error `lines` is empty so nothing can be rendered.
 */
export async function verifyShareCard(
  card: unknown,
  options: { publicKey: string | Uint8Array },
): Promise<ShareCardVerification> {
  const fail = (errors: string[]): ShareCardVerification => ({ valid: false, lines: [], errors });
  const shapeErrors = validateShareCardShape(card);
  if (shapeErrors.length > 0) return fail(shapeErrors);
  const c = card as ShareCard;
  let ok = false;
  try {
    const pk = typeof options.publicKey === "string" ? hexToUint8(options.publicKey) : options.publicKey;
    ok = await verifyAsync(base64urlToBytes(c.signature), utf8ToBytes(shareCardSigningInput(c as unknown as Record<string, unknown>)), pk, { zip215: false });
  } catch {
    ok = false;
  }
  if (!ok) return fail(["signature: verification failed"]);
  return { valid: true, lines: c.lines.map((l) => ({ ...l })), errors: [] };
}
