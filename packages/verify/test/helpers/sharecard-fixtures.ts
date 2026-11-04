// TEST KEYS ONLY. This seed is public and has no relation to any real key.
import { getPublicKeyAsync, signAsync } from "@noble/ed25519";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import { SHARE_CARD_TYP, shareCardSigningInput } from "../../src/sharecard.js";

export const TEST_SEED = new Uint8Array(32).fill(0x2a);
export const TEST_KEY_ID = "test-sharecard-key-1";
export const TRANSPARENCY_ROOT_TYP = "AAP-TransparencyRoot/v1";

export async function testPublicKeyHex(): Promise<string> {
  return bytesToHex(await getPublicKeyAsync(TEST_SEED));
}

export function b64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Sign any object (minus `signature`) with the test key, as the issuer would. */
export async function signWithTestKey(obj: Record<string, unknown>): Promise<Record<string, unknown>> {
  const sig = await signAsync(utf8ToBytes(shareCardSigningInput(obj)), TEST_SEED);
  const { signature: _s, ...rest } = obj;
  return { ...rest, signature: b64url(sig) };
}

const H1 = "1".repeat(64);
const H2 = "2".repeat(64);
const H3 = "3".repeat(64);

export function baseCard(): Record<string, unknown> {
  return {
    typ: SHARE_CARD_TYP,
    card_id: "card-valid-0001",
    period: { start: "2026-10-01", end: "2026-10-07" },
    issued_at: "2026-10-08T00:00:00.000Z",
    signing_key_id: TEST_KEY_ID,
    statements: [
      { typ: "AAP-ConductRecord/v1", hash: H1 },
      { typ: "AAP-PRRecord/v1", hash: H2 },
    ],
    lines: [
      { id: "l1", kind: "count", label: "Changes reviewed", value: 42, statement_hash: H1 },
      { id: "l2", kind: "count", label: "Checks passed", value: 40, statement_hash: H2 },
    ],
  };
}

export function periodCardBase(): Record<string, unknown> {
  const c = baseCard();
  c.card_id = "card-period-0001";
  (c.statements as unknown[]).push({ typ: "AAP-Outcome/v1", hash: H3 });
  (c.lines as unknown[]).push({ id: "l3", kind: "revert", label: "Changes reverted", value: 2, statement_hash: H3 });
  return c;
}

export async function buildFixtures(): Promise<Record<string, unknown>> {
  const valid = await signWithTestKey(baseCard());
  const tampered = structuredClone(valid) as { lines: { value: number }[] };
  tampered.lines[0]!.value = 4200; // edited number, original signature
  const period = await signWithTestKey(periodCardBase());
  const identifying: Record<string, unknown> = {};
  for (const [name, key, val] of [
    ["repo", "repo", "mnemom/secret-repo"],
    ["branch", "branch", "feat/internal-thing"],
    ["pr_title", "pr_title", "Fix customer X outage"],
    ["commit_message", "commit_message", "wip: patch for customer X"],
  ] as const) {
    const c = baseCard();
    c.card_id = `card-identifying-${name}`;
    (c.lines as Record<string, unknown>[])[0]![key] = val;
    identifying[name] = await signWithTestKey(c); // validly signed: must still fail
  }
  return { valid, tampered, period, identifying };
}
