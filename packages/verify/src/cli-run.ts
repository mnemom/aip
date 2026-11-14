/**
 * Threat model: packages/verify-page/THREAT-MODEL.md
 *
 * The `mnemom-verify` command (`npx @mnemom/verify <bundle>`). This module
 * holds the whole command so tests can drive it in-process; `cli.ts` only
 * wires it to the real process.
 *
 * The library makes no network calls. The command makes at most one: a GET
 * of the JWKS, and only when `--jwks` is not given. With `--jwks` it reads
 * the key set from disk and never calls `fetch`.
 *
 * Exit codes: 0 valid (flags included), 1 invalid, 2 usage, IO or JWKS error.
 */

import { readFile } from "node:fs/promises";

import type { RecordJwks, RecordVerificationResult, StatementVerificationResult } from "./statements.js";
import { verify } from "./verify-record.js";

/** The production cell's published key set (the URL the verify-page snapshot is taken from). */
export const DEFAULT_JWKS_URL = "https://api.mnemom.ai/v1/.well-known/jwks.json";

export const EXIT_VALID = 0;
export const EXIT_INVALID = 1;
export const EXIT_ERROR = 2;

/** Largest bundle or JWKS the command reads. Real bundles reach about 2 MB. */
export const MAX_INPUT_BYTES = 64 * 1024 * 1024;
/** How long the JWKS fetch may take before the command gives up. */
export const FETCH_TIMEOUT_MS = 15_000;

const GIT_SHA_RE = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

export const USAGE = `Usage: mnemom-verify <bundle.json | -> [options]

Verify a Mnemom signed record bundle (or one signed statement) against the
published key set. Use - to read the bundle from stdin.

Options:
  --jwks <file>              Verify against a saved JWKS. Makes no network call.
  --jwks-url <url>           Fetch the JWKS from this https URL instead of
                             ${DEFAULT_JWKS_URL}
  --expected-head-sha <sha>  Fail unless the latest PR record names this head
                             commit (40 or 64 lowercase hex characters).
  --json                     Print the result as JSON.
  -h, --help                 Show this help.

Exit codes: 0 valid (flags included), 1 invalid, 2 usage, IO or JWKS error.
A bundle with no statements is invalid (no_statements): nothing was checked.

This check proves Mnemom signed these statements, that they are unchanged and
that their chain and links hold. It does not prove the code is correct, that
every commit came from a recorded session, that protection caught everything,
or that the goal was met beyond the judged turns.
`;

const SHORT_USAGE = `Usage: mnemom-verify <bundle.json | -> [--jwks <file>] [--jwks-url <url>] [--expected-head-sha <sha>] [--json]
Run mnemom-verify --help for more.
`;

/**
 * Characters a terminal acts on rather than prints: C0 controls (ESC, CR, LF,
 * BS and the rest), DEL, C1 controls (U+009B is a one-character CSI), the
 * Unicode line and paragraph separators, and the bidi controls that reorder
 * what a reader sees. Any of them in a bundle field could redraw the report,
 * for example print a fake `valid` and hide the real verdict.
 */
const UNSAFE_CHARS_RE = /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g;
/** The same set without C0, which `JSON.stringify` escapes itself (and uses raw for its own line breaks). */
const UNSAFE_JSON_CHARS_RE = /[\u007f-\u009f\u061c\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g;

const escapeChar = (c: string): string => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`;

/**
 * `text` with every character a terminal would act on written as a visible
 * `\uXXXX` escape, so it prints on one line and changes nothing around it.
 * Everything the command prints that it did not write itself (bundle fields,
 * paths, URLs, parser and IO error text) goes through this.
 */
export function terminalSafe(text: string): string {
  return text.replace(UNSAFE_CHARS_RE, escapeChar);
}

/**
 * `JSON.stringify` already escapes C0 controls; this also escapes the DEL, C1,
 * separator and bidi characters it leaves raw. The output parses to the same value.
 */
function terminalSafeJson(value: unknown): string {
  return JSON.stringify(value, null, 2).replace(UNSAFE_JSON_CHARS_RE, escapeChar);
}

/** The process surface the command uses; tests pass their own. */
export interface CliIo {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  /** The whole of stdin, read only when the bundle argument is `-`. */
  readStdin: () => Promise<string>;
  readFile: (path: string) => Promise<string>;
  fetch: (url: string, init: { signal: AbortSignal; headers: Record<string, string> }) => Promise<FetchResponseLike>;
}

/** The part of a fetch Response the command reads. */
export interface FetchResponseLike {
  ok: boolean;
  status: number;
  text: () => Promise<string>;
}

export interface CliArgs {
  bundle: string;
  jwks?: string;
  jwksUrl?: string;
  expectedHeadSha?: string;
  json: boolean;
}

export class UsageError extends Error {}

/** Parse argv (without `node` and the script). Returns "help" for -h/--help. */
export function parseCliArgs(argv: readonly string[]): CliArgs | "help" {
  const out: Partial<CliArgs> & { json: boolean } = { json: false };
  const positionals: string[] = [];
  const valueFlags: Record<string, "jwks" | "jwksUrl" | "expectedHeadSha"> = {
    "--jwks": "jwks",
    "--jwks-url": "jwksUrl",
    "--expected-head-sha": "expectedHeadSha",
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "-h" || arg === "--help") return "help";
    if (arg === "--json") {
      out.json = true;
      continue;
    }
    if (arg === "--") {
      positionals.push(...argv.slice(i + 1));
      break;
    }
    const eq = arg.indexOf("=");
    const name = arg.startsWith("--") && eq > 0 ? arg.slice(0, eq) : arg;
    const key = valueFlags[name];
    if (key) {
      let value: string | undefined;
      if (name !== arg) value = arg.slice(eq + 1);
      else value = argv[++i];
      if (value === undefined || value === "") throw new UsageError(`${name} needs a value`);
      if (out[key] !== undefined) throw new UsageError(`${name} given twice`);
      out[key] = value;
      continue;
    }
    if (arg.startsWith("-") && arg !== "-") throw new UsageError(`unknown option ${arg}`);
    positionals.push(arg);
  }
  if (positionals.length === 0) throw new UsageError("no bundle given (a file path, or - for stdin)");
  if (positionals.length > 1) throw new UsageError(`one bundle at a time, got ${positionals.length}`);
  if (out.jwks !== undefined && out.jwksUrl !== undefined) {
    throw new UsageError("--jwks and --jwks-url cannot be used together");
  }
  if (out.jwksUrl !== undefined) checkJwksUrl(out.jwksUrl);
  if (out.expectedHeadSha !== undefined && !GIT_SHA_RE.test(out.expectedHeadSha)) {
    throw new UsageError("--expected-head-sha must be a lowercase hex commit id of 40 or 64 characters");
  }
  return { ...out, bundle: positionals[0]! };
}

/** A JWKS URL must be https, except plain http to this machine (for a local cell). */
function checkJwksUrl(raw: string): void {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UsageError(`--jwks-url is not a URL: ${raw}`);
  }
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
  if (url.protocol === "https:" || (url.protocol === "http:" && local)) return;
  throw new UsageError(`--jwks-url must be https (plain http only to localhost): ${raw}`);
}

class InputError extends Error {}

/** An error's message, with its cause when there is one (fetch says only "fetch failed"). */
function errorText(e: unknown): string {
  if (!(e instanceof Error)) return String(e);
  const cause = (e as Error & { cause?: unknown }).cause;
  if (cause instanceof Error) return `${e.message} (${(cause as Error & { code?: string }).code ?? cause.message})`;
  return e.message;
}

function parseJson(text: string, what: string): unknown {
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new InputError(`${what} is not JSON: ${(e as Error).message}`);
  }
}

function checkSize(text: string, what: string): void {
  if (text.length > MAX_INPUT_BYTES) throw new InputError(`${what} is larger than ${MAX_INPUT_BYTES} bytes`);
}

function asJwks(value: unknown, what: string): RecordJwks {
  if (!value || typeof value !== "object" || !Array.isArray((value as { keys?: unknown }).keys)) {
    throw new InputError(`${what} is not a JWKS (no "keys" array)`);
  }
  return value as RecordJwks;
}

async function readBundle(args: CliArgs, io: CliIo): Promise<unknown> {
  const what = args.bundle === "-" ? "stdin" : args.bundle;
  let text: string;
  try {
    text = args.bundle === "-" ? await io.readStdin() : await io.readFile(args.bundle);
  } catch (e) {
    throw new InputError(`cannot read ${what}: ${(e as Error).message}`);
  }
  checkSize(text, what);
  return parseJson(text, what);
}

async function loadJwks(args: CliArgs, io: CliIo): Promise<{ jwks: RecordJwks; source: string }> {
  if (args.jwks !== undefined) {
    let text: string;
    try {
      text = await io.readFile(args.jwks);
    } catch (e) {
      throw new InputError(`cannot read JWKS ${args.jwks}: ${(e as Error).message}`);
    }
    checkSize(text, args.jwks);
    return { jwks: asJwks(parseJson(text, `JWKS ${args.jwks}`), `JWKS ${args.jwks}`), source: `${args.jwks} (offline, no network call)` };
  }
  const url = args.jwksUrl ?? DEFAULT_JWKS_URL;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let text: string;
  try {
    const res = await io.fetch(url, { signal: controller.signal, headers: { accept: "application/json" } });
    if (!res.ok) throw new InputError(`JWKS fetch from ${url} failed: HTTP ${res.status}`);
    text = await res.text();
  } catch (e) {
    if (e instanceof InputError) throw e;
    const why = controller.signal.aborted ? `no answer within ${FETCH_TIMEOUT_MS / 1000}s` : errorText(e);
    throw new InputError(`JWKS fetch from ${url} failed: ${why}`);
  } finally {
    clearTimeout(timer);
  }
  checkSize(text, url);
  return { jwks: asJwks(parseJson(text, `JWKS from ${url}`), `JWKS from ${url}`), source: `${url} (fetched)` };
}

/** The reasons for statement `i`: its own, plus bundle checks reported against it (chain, links). */
function statementReasons(result: RecordVerificationResult, i: number): string[] {
  const prefix = `${i}:`;
  return result.reasons.filter((r) => r.startsWith(prefix)).map((r) => r.slice(prefix.length));
}

/**
 * "N of M commits from recorded sessions" for a verified PR record, else null.
 * `commits` is a list of `{ sha, bound }` (mnemom-api today) or a count
 * `{ bound, total }`; anything else prints nothing.
 */
export function commitsLine(raw: unknown, s: StatementVerificationResult): string | null {
  if (!s.valid || s.typ !== "AAP-PRRecord/v1" || !raw || typeof raw !== "object") return null;
  const commits = (raw as { commits?: unknown }).commits;
  let bound: number;
  let total: number;
  if (Array.isArray(commits)) {
    bound = commits.filter((c) => c && typeof c === "object" && (c as { bound?: unknown }).bound === true).length;
    total = commits.length;
  } else if (commits && typeof commits === "object") {
    const c = commits as { bound?: unknown; total?: unknown };
    if (!Number.isInteger(c.bound) || !Number.isInteger(c.total)) return null;
    bound = c.bound as number;
    total = c.total as number;
  } else {
    return null;
  }
  return `${bound} of ${total} commits from recorded sessions`;
}

function rawStatements(input: unknown): unknown[] {
  if (!input || typeof input !== "object") return [];
  const s = (input as { statements?: unknown }).statements;
  return Array.isArray(s) ? s : [input];
}

/** The flags, each named once, with a count when it repeats. */
export function flagSummary(result: RecordVerificationResult): string {
  const counts = new Map<string, number>();
  for (const f of result.flags) counts.set(f.flag, (counts.get(f.flag) ?? 0) + 1);
  return [...counts].map(([flag, n]) => (n > 1 ? `${flag} (x${n})` : flag)).join(", ");
}

/** The verdict line: `valid`, `valid, with flags: ...` or `invalid: ...`. */
export function verdictLine(result: RecordVerificationResult): string {
  if (!result.valid) return `invalid: ${terminalSafe(result.reasons.join(", "))}`;
  return result.flags.length === 0 ? "valid" : `valid, with flags: ${terminalSafe(flagSummary(result))}`;
}

/**
 * The human-readable report: one line per statement, then the verdict line.
 * `typ` and `signing_key_id` come from the bundle as given, even when the
 * statement fails, so they are printed through `terminalSafe`: a forged field
 * cannot add a line, move the cursor or hide the verdict.
 */
export function renderReport(input: unknown, result: RecordVerificationResult): string[] {
  const raws = rawStatements(input);
  const lines = result.statements.map((s, i) => {
    const reasons = statementReasons(result, i);
    const status = reasons.length === 0 ? "ok" : reasons.join(", ");
    const commits = commitsLine(raws[i], s);
    const typ = s.typ === null ? "(no typ)" : terminalSafe(s.typ);
    const kid = s.signing_key_id === null ? "(no signing_key_id)" : terminalSafe(s.signing_key_id);
    return `[${i}] ${typ}  ${kid}  ${terminalSafe(status)}${commits ? `  (${commits})` : ""}`;
  });
  lines.push(verdictLine(result));
  return lines;
}

/** The command's own reason for a bundle that holds no statement. */
export const NO_STATEMENTS = "no_statements";

/**
 * A bundle with an empty `statements` array passes the library check, since
 * nothing in it fails. The command refuses it: the bundle comes from the PR
 * branch, so whoever wrote the branch controls it, and a pass with nothing
 * checked would let `npx @mnemom/verify <bundle> && ...` go through on no
 * evidence. The library result is left as it is; only the command's verdict,
 * exit code and `--json` output carry `no_statements`.
 */
export function requireStatements(result: RecordVerificationResult): RecordVerificationResult {
  if (!result.valid || result.statements.length > 0) return result;
  return { ...result, valid: false, reasons: [...result.reasons, NO_STATEMENTS] };
}

/** Run the command. Returns the exit code; never throws. */
export async function runCli(argv: readonly string[], io: CliIo): Promise<number> {
  let args: CliArgs;
  try {
    const parsed = parseCliArgs(argv);
    if (parsed === "help") {
      io.stdout(USAGE);
      return EXIT_VALID;
    }
    args = parsed;
  } catch (e) {
    io.stderr(`mnemom-verify: ${terminalSafe((e as Error).message)}\n${SHORT_USAGE}`);
    return EXIT_ERROR;
  }

  let input: unknown;
  let jwks: RecordJwks;
  let source: string;
  try {
    input = await readBundle(args, io);
    ({ jwks, source } = await loadJwks(args, io));
  } catch (e) {
    // The message can name the bundle path and quote bundle bytes (JSON.parse does).
    io.stderr(`mnemom-verify: ${terminalSafe((e as Error).message)}\n`);
    return EXIT_ERROR;
  }

  const options = args.expectedHeadSha === undefined ? {} : { expected_head_sha: args.expectedHeadSha };
  const result = requireStatements(await verify(input, jwks, options));
  const code = result.valid ? EXIT_VALID : EXIT_INVALID;

  if (args.json) {
    io.stderr(`JWKS: ${terminalSafe(source)}\n`);
    io.stdout(`${terminalSafeJson(result)}\n`);
    return code;
  }
  const report = renderReport(input, result);
  const verdict = report.pop()!;
  const out = [`JWKS: ${terminalSafe(source)}`, ...report];
  if (result.valid) {
    out.push(
      "note: this proves Mnemom signed these statements, unchanged, with their chain and links intact.",
      "      It does not prove the code is correct or that every commit came from a recorded session.",
    );
  }
  // The verdict is always the last line, so `tail -1` reads it.
  out.push(verdict);
  io.stdout(`${out.join("\n")}\n`);
  return code;
}

/** The real process: files from disk, stdin, global fetch. */
export function processIo(): CliIo {
  return {
    stdout: (t) => void process.stdout.write(t),
    stderr: (t) => void process.stderr.write(t),
    readFile: (p) => readFile(p, "utf8"),
    readStdin: async () => {
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of process.stdin) {
        const b = typeof chunk === "string" ? Buffer.from(chunk) : (chunk as Buffer);
        size += b.length;
        if (size > MAX_INPUT_BYTES) throw new Error(`stdin is larger than ${MAX_INPUT_BYTES} bytes`);
        chunks.push(b);
      }
      return Buffer.concat(chunks).toString("utf8");
    },
    fetch: (url, init) => globalThis.fetch(url, init),
  };
}
