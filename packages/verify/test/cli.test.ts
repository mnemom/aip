/**
 * The `mnemom-verify` bin (`npx @mnemom/verify <bundle>`): output, exit
 * codes, stdin, the default JWKS URL, and no network call with --jwks.
 *
 * Most cases drive runCli in-process. The last block runs the built
 * dist/cli.js as a child process (the CI verify job builds before it tests).
 */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_JWKS_URL,
  EXIT_ERROR,
  EXIT_INVALID,
  EXIT_VALID,
  FETCH_TIMEOUT_MS,
  MAX_INPUT_BYTES,
  NO_STATEMENTS,
  commitsLine,
  parseCliArgs,
  processIo,
  runCli,
  terminalSafe,
  verdictLine,
  type CliIo,
  type FetchResponseLike,
} from "../src/cli-run.js";
import { FLAGS, type RecordJwks, type RecordVerificationResult, type StatementVerificationResult } from "../src/statements.js";
import { verify } from "../src/verify-record.js";
import type { TamperedCase } from "./helpers/build-fixtures.js";
import { TEST_KID, testJwk } from "./helpers/sign.js";

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURES = resolve(here, "fixtures/record");
const fixturePath = (name: string) => resolve(FIXTURES, `${name}.json`);
const fixtureText = (name: string) => readFileSync(fixturePath(name), "utf8");
const JWKS_PATH = fixturePath("jwks");
const BUNDLE_PATH = fixturePath("golden-bundle");
const GOLDEN_HEAD = "ffffffffffffffffffffffffffffffffffffffff";
// Any 32-byte seed that is not the fixture key. Derived, so no key-shaped literal sits in the repo.
const OTHER_PRIVATE_KEY_HEX = createHash("sha256").update("mnemom-verify cli test: a key that did not sign the bundle").digest("hex");

const tmp = mkdtempSync(join(tmpdir(), "mnemom-verify-cli-"));
function writeTmp(name: string, value: unknown): string {
  const p = join(tmp, name);
  writeFileSync(p, typeof value === "string" ? value : JSON.stringify(value));
  return p;
}

interface Run {
  code: number;
  stdout: string;
  stderr: string;
  fetchCalls: string[];
}

/** Run the command with files from disk and a fetch that serves `served` (or throws). */
async function run(
  argv: string[],
  opts: { stdin?: string; fetch?: (url: string) => Promise<FetchResponseLike> } = {},
): Promise<Run> {
  let stdout = "";
  let stderr = "";
  const fetchCalls: string[] = [];
  const io: CliIo = {
    ...processIo(),
    stdout: (t) => {
      stdout += t;
    },
    stderr: (t) => {
      stderr += t;
    },
    readStdin: async () => {
      if (opts.stdin === undefined) throw new Error("no stdin in this test");
      return opts.stdin;
    },
    fetch: async (url) => {
      fetchCalls.push(url);
      if (!opts.fetch) throw new Error("network call in a test that allows none");
      return opts.fetch(url);
    },
  };
  const code = await runCli(argv, io);
  return { code, stdout, stderr, fetchCalls };
}

const serve =
  (body: string, status = 200) =>
  async (): Promise<FetchResponseLike> => ({ ok: status >= 200 && status < 300, status, text: async () => body });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("mnemom-verify: valid bundles", () => {
  it("prints one line per statement, then `valid, with flags`, and exits 0", async () => {
    const r = await run([BUNDLE_PATH, "--jwks", JWKS_PATH]);
    expect(r.code).toBe(EXIT_VALID);
    const lines = r.stdout.trim().split("\n");
    expect(lines[0]).toBe(`JWKS: ${JWKS_PATH} (offline, no network call)`);
    expect(lines.slice(1, 6)).toEqual([
      `[0] AAP-ConductRecord/v1  ${TEST_KID}  ok`,
      `[1] AAP-ConductRecord/v1  ${TEST_KID}  ok`,
      `[2] AAP-PRRecord/v1  ${TEST_KID}  ok  (3 of 4 commits from recorded sessions)`,
      `[3] AAP-Outcome/v1  ${TEST_KID}  ok`,
      `[4] AAP-ShareCard/v1  ${TEST_KID}  ok`,
    ]);
    expect(lines[6]).toMatch(/^note: this proves Mnemom signed these statements/);
    expect(lines[7]).toMatch(/It does not prove the code is correct/);
    // The verdict is the last line, after the note, so `tail -1` reads it.
    expect(lines[8]).toBe("valid, with flags: card hash not recorded, card not bound");
    expect(lines).toHaveLength(9);
    expect(r.stderr).toBe("");
  });

  it("prints a bare `valid` for a statement with no flags", async () => {
    const r = await run([fixturePath("golden-outcome"), "--jwks", JWKS_PATH]);
    expect(r.code).toBe(EXIT_VALID);
    expect(r.stdout).toContain(`[0] AAP-Outcome/v1  ${TEST_KID}  ok\nnote: `);
    expect(r.stdout.endsWith("recorded session.\nvalid\n")).toBe(true);
  });

  it("names a repeated flag once, with its count", () => {
    const result = {
      valid: true,
      reasons: [],
      statements: [],
      verified_at: "",
      flags: [
        { flag: FLAGS.card_hash_not_recorded, subject: "cp_1" },
        { flag: FLAGS.card_hash_not_recorded, subject: "cp_2" },
        { flag: FLAGS.lineage_truncated, subject: "d" },
      ],
    } as RecordVerificationResult;
    expect(verdictLine(result)).toBe("valid, with flags: card hash not recorded (x2), lineage truncated");
    expect(verdictLine({ ...result, flags: [] })).toBe("valid");
    expect(verdictLine({ ...result, valid: false, reasons: ["0:signature_invalid", "head_unbound"] })).toBe(
      "invalid: 0:signature_invalid, head_unbound",
    );
  });

  it("binds to --expected-head-sha: the right head passes, another fails with head_mismatch", async () => {
    expect((await run([BUNDLE_PATH, "--jwks", JWKS_PATH, "--expected-head-sha", GOLDEN_HEAD])).code).toBe(EXIT_VALID);
    const r = await run([BUNDLE_PATH, "--jwks", JWKS_PATH, "--expected-head-sha", "a".repeat(40)]);
    expect(r.code).toBe(EXIT_INVALID);
    expect(r.stdout.trim().split("\n").pop()).toBe("invalid: head_mismatch");
  });

  it("--json prints the library result on stdout and the JWKS source on stderr", async () => {
    const r = await run([BUNDLE_PATH, "--jwks", JWKS_PATH, "--json"]);
    expect(r.code).toBe(EXIT_VALID);
    const res = JSON.parse(r.stdout) as { valid: boolean; statements: StatementVerificationResult[]; verified_at: string };
    expect(res.valid).toBe(true);
    expect(res.statements).toHaveLength(5);
    expect(typeof res.verified_at).toBe("string");
    expect(r.stderr).toBe(`JWKS: ${JWKS_PATH} (offline, no network call)\n`);
  });
});

describe("mnemom-verify: invalid input exits 1 with the reason", () => {
  const cases = JSON.parse(fixtureText("tampered")) as TamperedCase[];

  it.each(cases.map((c) => [c.name, c] as const))("%s", async (_name, c) => {
    const p = writeTmp(`${c.name}.json`, c.input);
    const argv = [p, "--jwks", JWKS_PATH];
    if (c.expected_head_sha) argv.push("--expected-head-sha", c.expected_head_sha);
    const r = await run(argv);
    expect(r.code, r.stdout).toBe(EXIT_INVALID);
    const lines = r.stdout.trim().split("\n");
    const verdict = lines.pop()!;
    expect(verdict.startsWith("invalid: ")).toBe(true);
    expect(verdict.slice("invalid: ".length).split(", ")).toContain(c.reason);
    // A statement-level reason also shows on that statement's line.
    const m = /^(\d+):(.+)$/.exec(c.reason);
    if (m) expect(lines.find((l) => l.startsWith(`[${m[1]}] `))).toContain(m[2]);
  });

  it("a key set holding another key under the same kid: signature_invalid on every statement", async () => {
    const wrong: RecordJwks = { keys: [await testJwk(TEST_KID, OTHER_PRIVATE_KEY_HEX)] };
    const r = await run([BUNDLE_PATH, "--jwks", writeTmp("wrong-key.json", wrong)]);
    expect(r.code).toBe(EXIT_INVALID);
    expect(r.stdout).toContain(`[0] AAP-ConductRecord/v1  ${TEST_KID}  signature_invalid`);
    expect(r.stdout.trim().split("\n").pop()).toBe(
      "invalid: 0:signature_invalid, 1:signature_invalid, 2:signature_invalid, 3:signature_invalid, 4:signature_invalid",
    );
    expect(r.stdout).not.toContain("does not prove");
  });

  it("a key set without the signing kid: key_not_found", async () => {
    const other: RecordJwks = { keys: [await testJwk("aap-some-other-key", OTHER_PRIVATE_KEY_HEX)] };
    const r = await run([fixturePath("golden-pr-record"), "--jwks", writeTmp("other-kid.json", other)]);
    expect(r.code).toBe(EXIT_INVALID);
    expect(r.stdout).toContain("invalid: 0:key_not_found");
  });

  it("JSON that is not an object: bundle_not_an_object", async () => {
    const r = await run([writeTmp("array.json", "[1,2]"), "--jwks", JWKS_PATH]);
    expect(r.code).toBe(EXIT_INVALID);
    expect(r.stdout.trim().split("\n").pop()).toBe("invalid: bundle_not_an_object");
  });

  /**
   * The bundle sits in the PR branch, so its author controls it. An empty
   * `statements` array must not pass `npx @mnemom/verify <bundle> && ...`
   * with nothing checked, nor print the "Mnemom signed these statements" note.
   */
  describe("a bundle with no statements: no_statements", () => {
    const typ = (JSON.parse(fixtureText("golden-bundle")) as { typ: string }).typ;
    const empty = () => writeTmp("empty-bundle.json", { typ, statements: [] });

    it("the library still calls it valid; the command does not", async () => {
      const jwks = JSON.parse(fixtureText("jwks")) as RecordJwks;
      const lib = await verify({ typ, statements: [] }, jwks);
      expect(lib.valid).toBe(true);
      expect(lib.statements).toHaveLength(0);
    });

    it("exits 1 with `invalid: no_statements` and prints no note", async () => {
      const r = await run([empty(), "--jwks", JWKS_PATH]);
      expect(r.code).toBe(EXIT_INVALID);
      expect(r.stdout).toBe(`JWKS: ${JWKS_PATH} (offline, no network call)\ninvalid: ${NO_STATEMENTS}\n`);
      expect(r.stdout).not.toContain("note:");
    });

    it("--json exits 1 with valid false and the reason", async () => {
      const r = await run([empty(), "--jwks", JWKS_PATH, "--json"]);
      expect(r.code).toBe(EXIT_INVALID);
      const res = JSON.parse(r.stdout) as RecordVerificationResult;
      expect(res.valid).toBe(false);
      expect(res.reasons).toEqual([NO_STATEMENTS]);
      expect(res.statements).toEqual([]);
    });

    it("on stdin too; with --expected-head-sha the library reason head_unbound stands alone", async () => {
      const r = await run(["-", "--jwks", JWKS_PATH], { stdin: JSON.stringify({ typ, statements: [] }) });
      expect(r.code).toBe(EXIT_INVALID);
      expect(r.stdout.trim().split("\n").pop()).toBe(`invalid: ${NO_STATEMENTS}`);
      const h = await run([empty(), "--jwks", JWKS_PATH, "--expected-head-sha", GOLDEN_HEAD]);
      expect(h.code).toBe(EXIT_INVALID);
      expect(h.stdout.trim().split("\n").pop()).toBe("invalid: head_unbound");
    });
  });
});

/**
 * A forged bundle field must not redraw the report. The kid below prints a
 * green "ok", starts a new line that says `valid`, then turns on conceal
 * (ESC[8m) so a terminal hides the real reason and verdict that follow.
 */
const FORGED_KID = "k\u001b[32m ok\u001b[0m\nvalid\u001b[8m";
// Any raw character a terminal would act on: C0, DEL, C1, separators, bidi controls.
const RAW_CONTROL_RE = /[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/;

describe("mnemom-verify: bundle text cannot drive the terminal", () => {
  const forged = () => JSON.parse(fixtureText("golden-outcome")) as Record<string, unknown>;

  it("a forged kid with ESC and \\n still gives one line per statement and ends with `invalid:`", async () => {
    const r = await run([writeTmp("forged-kid.json", { ...forged(), signing_key_id: FORGED_KID }), "--jwks", JWKS_PATH]);
    expect(r.code).toBe(EXIT_INVALID);
    expect(r.stdout).not.toMatch(RAW_CONTROL_RE);
    const lines = r.stdout.split("\n");
    expect(lines.pop()).toBe("");
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe(`JWKS: ${JWKS_PATH} (offline, no network call)`);
    expect(lines[1]).toBe(
      "[0] AAP-Outcome/v1  k\\u001b[32m ok\\u001b[0m\\u000avalid\\u001b[8m  key_not_found",
    );
    expect(lines[2]).toBe("invalid: 0:key_not_found");
    expect(lines.filter((l) => l.startsWith("valid"))).toEqual([]);
  });

  it("the same forged kid in every statement of a bundle: still one line each", async () => {
    const bundle = JSON.parse(fixtureText("golden-bundle")) as { statements: Record<string, unknown>[] };
    bundle.statements = bundle.statements.map((st) => ({ ...st, signing_key_id: FORGED_KID }));
    const r = await run([writeTmp("forged-kids.json", bundle), "--jwks", JWKS_PATH]);
    expect(r.code).toBe(EXIT_INVALID);
    expect(r.stdout).not.toMatch(RAW_CONTROL_RE);
    const lines = r.stdout.trim().split("\n");
    expect(lines).toHaveLength(1 + bundle.statements.length + 1);
    lines.slice(1, -1).forEach((l, i) => expect(l.startsWith(`[${i}] `)).toBe(true));
    expect(lines[lines.length - 1]!.startsWith("invalid: ")).toBe(true);
  });

  it("a forged typ (unknown_typ) is escaped too, C1 CSI and bidi overrides included", async () => {
    const typ = "AAP-Outcome/v1\u009b2K\u202e\r";
    const r = await run([writeTmp("forged-typ.json", { ...forged(), typ }), "--jwks", JWKS_PATH]);
    expect(r.code).toBe(EXIT_INVALID);
    expect(r.stdout).not.toMatch(RAW_CONTROL_RE);
    expect(r.stdout).toContain("[0] AAP-Outcome/v1\\u009b2K\\u202e\\u000d  ");
    expect(r.stdout.trim().split("\n").pop()).toBe("invalid: 0:unknown_typ");
  });

  it("--json keeps the value but writes C1 and bidi characters as escapes", async () => {
    const typ = "x\u009b\u202e\u001b";
    const r = await run([writeTmp("forged-typ-json.json", { ...forged(), typ }), "--jwks", JWKS_PATH, "--json"]);
    expect(r.code).toBe(EXIT_INVALID);
    expect(r.stdout).not.toMatch(RAW_CONTROL_RE);
    expect((JSON.parse(r.stdout) as { statements: StatementVerificationResult[] }).statements[0]!.typ).toBe(typ);
  });

  it("a bundle path and a JSON parse error that quote control characters reach stderr escaped", async () => {
    const name = "evil\u001b[2J\nvalid.json";
    const r = await run([writeTmp(name, "{\"a\":\u001b[32m}"), "--jwks", JWKS_PATH]);
    expect(r.code).toBe(EXIT_ERROR);
    expect(r.stderr).not.toMatch(RAW_CONTROL_RE);
    expect(r.stderr.split("\n")).toHaveLength(2);
    expect(r.stderr).toMatch(/^mnemom-verify: .*evil\\u001b\[2J\\u000avalid\.json is not JSON/);
    const missing = await run([join(tmp, "gone\u001b[8m.json"), "--jwks", JWKS_PATH]);
    expect(missing.stderr).not.toMatch(RAW_CONTROL_RE);
    expect(missing.stderr).toContain("gone\\u001b[8m.json");
  });

  it("terminalSafe escapes C0, DEL, C1, separators and bidi controls, and leaves other text alone", () => {
    expect(terminalSafe("a\u0000\u0007\t\n\r\u001b\u007f\u0085\u009b\u2028\u202e\u2066z")).toBe(
      "a\\u0000\\u0007\\u0009\\u000a\\u000d\\u001b\\u007f\\u0085\\u009b\\u2028\\u202e\\u2066z",
    );
    expect(terminalSafe("aap-test-record-2026-10 é 漢字 🙂")).toBe("aap-test-record-2026-10 é 漢字 🙂");
  });
});

describe("mnemom-verify: stdin", () => {
  it("reads the bundle from stdin when the argument is -", async () => {
    const r = await run(["-", "--jwks", JWKS_PATH], { stdin: fixtureText("golden-bundle") });
    expect(r.code).toBe(EXIT_VALID);
    expect(r.stdout).toContain("valid, with flags:");
  });

  it("a tampered bundle on stdin exits 1; non-JSON on stdin exits 2", async () => {
    const tampered = fixtureText("golden-bundle").replace("cp_unbound", "cp_unbouNd");
    expect((await run(["-", "--jwks", JWKS_PATH], { stdin: tampered })).code).toBe(EXIT_INVALID);
    const r = await run(["-", "--jwks", JWKS_PATH], { stdin: "not json" });
    expect(r.code).toBe(EXIT_ERROR);
    expect(r.stderr).toMatch(/^mnemom-verify: stdin is not JSON/);
  });
});

describe("mnemom-verify: the JWKS", () => {
  it("with --jwks makes no network call (global fetch stubbed to throw)", async () => {
    const fetchStub = vi.fn(() => {
      throw new Error("network call with --jwks");
    });
    vi.stubGlobal("fetch", fetchStub);
    let stdout = "";
    const io: CliIo = { ...processIo(), stdout: (t) => void (stdout += t), stderr: () => undefined };
    expect(await runCli([BUNDLE_PATH, "--jwks", JWKS_PATH], io)).toBe(EXIT_VALID);
    expect(await runCli(["-", "--jwks", JWKS_PATH], { ...io, readStdin: async () => fixtureText("golden-bundle") })).toBe(
      EXIT_VALID,
    );
    expect(await runCli([BUNDLE_PATH, "--jwks", JWKS_PATH, "--json"], io)).toBe(EXIT_VALID);
    expect(fetchStub).not.toHaveBeenCalled();
    expect(stdout).toContain("(offline, no network call)");
  });

  it("without --jwks fetches the default URL through global fetch and prints it", async () => {
    const fetchStub = vi.fn(async (_url: string) => new Response(fixtureText("jwks"), { status: 200 }));
    vi.stubGlobal("fetch", fetchStub);
    let stdout = "";
    const io: CliIo = { ...processIo(), stdout: (t) => void (stdout += t), stderr: () => undefined };
    expect(await runCli([BUNDLE_PATH], io)).toBe(EXIT_VALID);
    expect(fetchStub).toHaveBeenCalledTimes(1);
    expect(fetchStub.mock.calls[0]![0]).toBe(DEFAULT_JWKS_URL);
    expect(DEFAULT_JWKS_URL).toBe("https://api.mnemom.ai/v1/.well-known/jwks.json");
    expect(stdout.split("\n")[0]).toBe(`JWKS: ${DEFAULT_JWKS_URL} (fetched)`);
  });

  it("--jwks-url fetches that URL instead", async () => {
    const url = "https://api.example.test/v1/.well-known/jwks.json";
    const r = await run([BUNDLE_PATH, "--jwks-url", url], { fetch: serve(fixtureText("jwks")) });
    expect(r.code).toBe(EXIT_VALID);
    expect(r.fetchCalls).toEqual([url]);
    expect(r.stdout.split("\n")[0]).toBe(`JWKS: ${url} (fetched)`);
  });

  it("a fetch that fails, an HTTP error, non-JSON or a body without keys exits 2", async () => {
    const failing = async (): Promise<FetchResponseLike> => {
      throw new Error("getaddrinfo ENOTFOUND api.mnemom.ai");
    };
    for (const [fetch, why] of [
      [failing, /JWKS fetch from https:\/\/api\.mnemom\.ai\/v1\/\.well-known\/jwks\.json failed: getaddrinfo ENOTFOUND/],
      [
        async (): Promise<FetchResponseLike> => {
          throw new TypeError("fetch failed", { cause: Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }) });
        },
        /failed: fetch failed \(ECONNREFUSED\)/,
      ],
      [serve("oops", 503), /failed: HTTP 503/],
      [serve("<html>"), /is not JSON/],
      [serve('{"kid":"x"}'), /is not a JWKS/],
    ] as const) {
      const r = await run([BUNDLE_PATH], { fetch });
      expect(r.code).toBe(EXIT_ERROR);
      expect(r.stderr).toMatch(why);
      expect(r.stdout).toBe("");
    }
  });

  it("a --jwks file that is missing, not JSON or not a key set exits 2", async () => {
    expect((await run([BUNDLE_PATH, "--jwks", join(tmp, "nope.json")])).stderr).toMatch(/cannot read JWKS/);
    expect((await run([BUNDLE_PATH, "--jwks", writeTmp("bad-jwks.json", "{")])).code).toBe(EXIT_ERROR);
    const r = await run([BUNDLE_PATH, "--jwks", writeTmp("no-keys.json", { keys: "x" })]);
    expect(r.code).toBe(EXIT_ERROR);
    expect(r.stderr).toMatch(/is not a JWKS/);
  });
});

describe("mnemom-verify: usage and IO errors exit 2", () => {
  it.each([
    ["no bundle", [], /no bundle given/],
    ["two bundles", ["a.json", "b.json"], /one bundle at a time/],
    ["an unknown option", [BUNDLE_PATH, "--offline"], /unknown option --offline/],
    ["--jwks with no value", [BUNDLE_PATH, "--jwks"], /--jwks needs a value/],
    ["--jwks given twice", [BUNDLE_PATH, "--jwks", JWKS_PATH, "--jwks", JWKS_PATH], /--jwks given twice/],
    ["--jwks and --jwks-url", [BUNDLE_PATH, "--jwks", JWKS_PATH, "--jwks-url", "https://x.test/j"], /cannot be used together/],
    ["a plain-http --jwks-url", [BUNDLE_PATH, "--jwks-url", "http://api.mnemom.ai/j"], /must be https/],
    ["a --jwks-url that is not a URL", [BUNDLE_PATH, "--jwks-url", "jwks.json"], /is not a URL/],
    ["a malformed --expected-head-sha", [BUNDLE_PATH, "--jwks", JWKS_PATH, "--expected-head-sha", "ABC"], /--expected-head-sha must be/],
  ] as const)("%s", async (_name, argv, why) => {
    const r = await run([...argv]);
    expect(r.code).toBe(EXIT_ERROR);
    expect(r.stderr).toMatch(why);
    expect(r.stderr).toContain("Usage: mnemom-verify");
    expect(r.fetchCalls).toEqual([]);
  });

  it("a missing or non-JSON bundle file exits 2 before any fetch", async () => {
    const missing = await run([join(tmp, "missing.json")], { fetch: serve(fixtureText("jwks")) });
    expect(missing.code).toBe(EXIT_ERROR);
    expect(missing.stderr).toMatch(/cannot read .*missing\.json/);
    expect(missing.fetchCalls).toEqual([]);
    const garbled = await run([writeTmp("garbled.json", "{nope"), "--jwks", JWKS_PATH]);
    expect(garbled.code).toBe(EXIT_ERROR);
    expect(garbled.stderr).toMatch(/garbled\.json is not JSON/);
  });

  it("--help prints the usage and what the check does not prove, exit 0", async () => {
    const r = await run(["--help"]);
    expect(r.code).toBe(EXIT_VALID);
    expect(r.stdout).toContain("Usage: mnemom-verify <bundle.json | -> [options]");
    expect(r.stdout).toContain("It does not prove the code is correct");
    expect(r.stdout).toContain(DEFAULT_JWKS_URL);
  });

  it("parses --flag=value and -- before a path starting with a dash", () => {
    expect(parseCliArgs(["--jwks=k.json", "--json", "--", "-odd.json"])).toEqual({
      bundle: "-odd.json",
      jwks: "k.json",
      json: true,
    });
  });
});

describe("mnemom-verify: branches the main cases do not reach", () => {
  const goldenJwks = () => fixtureText("jwks");

  it("a JWKS fetch that never answers is aborted after FETCH_TIMEOUT_MS: `no answer within 15s`, exit 2", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      let fetchStarted!: () => void;
      const started = new Promise<void>((r) => {
        fetchStarted = r;
      });
      const hang = (_url: string, init?: { signal: AbortSignal }): Promise<FetchResponseLike> =>
        new Promise((_resolve, reject) => {
          fetchStarted();
          init?.signal.addEventListener("abort", () => reject(new Error("This operation was aborted")));
        });
      let stderr = "";
      const io: CliIo = {
        ...processIo(),
        stdout: () => {},
        stderr: (t) => {
          stderr += t;
        },
        readFile: async () => fixtureText("golden-bundle"),
        fetch: (url, init) => hang(url, init),
      };
      const pending = runCli([BUNDLE_PATH], io);
      await started; // the 15s timer is armed before fetch is called
      await vi.advanceTimersByTimeAsync(FETCH_TIMEOUT_MS);
      expect(await pending).toBe(EXIT_ERROR);
      expect(stderr).toBe(`mnemom-verify: JWKS fetch from ${DEFAULT_JWKS_URL} failed: no answer within 15s\n`);
    } finally {
      vi.useRealTimers();
    }
  });

  it("a fetch that rejects with a non-Error value reports String(value), exit 2", async () => {
    const r = await run([BUNDLE_PATH], {
      fetch: async () => {
        throw "plain string failure"; // eslint-disable-line @typescript-eslint/only-throw-error
      },
    });
    expect(r.code).toBe(EXIT_ERROR);
    expect(r.stderr).toBe(`mnemom-verify: JWKS fetch from ${DEFAULT_JWKS_URL} failed: plain string failure\n`);
  });

  it("plain-http --jwks-url is accepted for localhost, 127.0.0.1 and [::1]", async () => {
    for (const url of [
      "http://localhost:8787/v1/.well-known/jwks.json",
      "http://127.0.0.1:8787/v1/.well-known/jwks.json",
      "http://[::1]:8787/v1/.well-known/jwks.json",
    ]) {
      expect(parseCliArgs([BUNDLE_PATH, "--jwks-url", url])).toMatchObject({ jwksUrl: url });
      const r = await run([BUNDLE_PATH, "--jwks-url", url], { fetch: serve(goldenJwks()) });
      expect(r.code, r.stderr).toBe(EXIT_VALID);
      expect(r.fetchCalls).toEqual([url]);
      expect(r.stdout.split("\n")[0]).toBe(`JWKS: ${url} (fetched)`);
    }
  });

  it("a bundle whose top-level JSON is a string, number, boolean or null is invalid (bundle_not_an_object), exit 1", async () => {
    for (const text of ['"a string"', "42", "true", "false", "null"]) {
      const r = await run([writeTmp("scalar.json", text), "--jwks", JWKS_PATH]);
      expect(r.code, text).toBe(EXIT_INVALID);
      expect(r.stdout.trim().split("\n").pop(), text).toBe("invalid: bundle_not_an_object");
    }
  });

  it("a bundle or JWKS file over MAX_INPUT_BYTES exits 2 before parsing", async () => {
    const big = "x".repeat(MAX_INPUT_BYTES + 1);
    let stderr = "";
    const io = (files: Record<string, string>): CliIo => ({
      ...processIo(),
      stdout: () => {},
      stderr: (t) => {
        stderr += t;
      },
      readFile: async (p) => files[p] ?? "",
    });
    expect(await runCli(["b.json", "--jwks", "j.json"], io({ "b.json": big, "j.json": goldenJwks() }))).toBe(EXIT_ERROR);
    expect(stderr).toBe(`mnemom-verify: b.json is larger than ${MAX_INPUT_BYTES} bytes\n`);
    stderr = "";
    expect(await runCli(["b.json", "--jwks", "j.json"], io({ "b.json": fixtureText("golden-bundle"), "j.json": big }))).toBe(EXIT_ERROR);
    expect(stderr).toBe(`mnemom-verify: j.json is larger than ${MAX_INPUT_BYTES} bytes\n`);
    // A fetched JWKS body is checked the same way.
    const r = await run([BUNDLE_PATH], { fetch: serve(big) });
    expect(r.code).toBe(EXIT_ERROR);
    expect(r.stderr).toBe(`mnemom-verify: ${DEFAULT_JWKS_URL} is larger than ${MAX_INPUT_BYTES} bytes\n`);
  });

  it("a statement with no typ renders `(no typ)` and no signing_key_id renders `(no signing_key_id)`", async () => {
    const r = await run([writeTmp("no-typ-kid.json", {}), "--jwks", JWKS_PATH]);
    expect(r.code).toBe(EXIT_INVALID);
    const line = r.stdout.split("\n").find((l) => l.startsWith("[0] "));
    expect(line).toBe("[0] (no typ)  (no signing_key_id)  unknown_typ");
  });

  describe("processIo().readStdin driven with a fake stdin", () => {
    const original = Object.getOwnPropertyDescriptor(process, "stdin")!;
    const withStdin = async <T>(stream: Readable, fn: () => Promise<T>): Promise<T> => {
      Object.defineProperty(process, "stdin", { value: stream, configurable: true });
      try {
        return await fn();
      } finally {
        Object.defineProperty(process, "stdin", original);
      }
    };

    it("joins string chunks (stream with an encoding set)", async () => {
      const stream = Readable.from(["{\"a\":", "1}"], { objectMode: true });
      expect(await withStdin(stream, () => processIo().readStdin())).toBe('{"a":1}');
    });

    it("joins Buffer chunks", async () => {
      const stream = Readable.from([Buffer.from("héllo "), Buffer.from("wörld")], { objectMode: true });
      expect(await withStdin(stream, () => processIo().readStdin())).toBe("héllo wörld");
    });

    it("rejects once stdin exceeds MAX_INPUT_BYTES, and runCli exits 2 with the message", async () => {
      const half = Buffer.alloc(MAX_INPUT_BYTES / 2 + 1);
      const stream = Readable.from([half, half], { objectMode: true });
      let stderr = "";
      const io: CliIo = {
        ...processIo(),
        stdout: () => {},
        stderr: (t) => {
          stderr += t;
        },
      };
      const code = await withStdin(stream, () => runCli(["-", "--jwks", JWKS_PATH], io));
      expect(code).toBe(EXIT_ERROR);
      expect(stderr).toBe(`mnemom-verify: cannot read stdin: stdin is larger than ${MAX_INPUT_BYTES} bytes\n`);
    });
  });
});

describe("commitsLine", () => {
  const ok = { valid: true, typ: "AAP-PRRecord/v1" } as StatementVerificationResult;
  it("counts bound commits in a list, reads a { bound, total } count, and says nothing otherwise", () => {
    const list = { commits: [{ sha: "a", bound: true }, { sha: "b", bound: false }, { sha: "c", bound: true }] };
    expect(commitsLine(list, ok)).toBe("2 of 3 commits from recorded sessions");
    expect(commitsLine({ commits: { bound: 3, total: 4 } }, ok)).toBe("3 of 4 commits from recorded sessions");
    expect(commitsLine({ commits: { bound: "3", total: 4 } }, ok)).toBeNull();
    expect(commitsLine({}, ok)).toBeNull();
    expect(commitsLine(list, { ...ok, valid: false })).toBeNull();
    expect(commitsLine(list, { ...ok, typ: "AAP-Outcome/v1" })).toBeNull();
  });
});

const CLI = resolve(here, "../dist/cli.js");
describe.skipIf(!existsSync(CLI))("dist/cli.js as a process (after npm run build)", () => {
  const node = (args: string[], input?: string) =>
    spawnSync(process.execPath, [CLI, ...args], { input, encoding: "utf8", timeout: 30_000 });

  it("starts with the node shebang", () => {
    expect(readFileSync(CLI, "utf8").startsWith("#!/usr/bin/env node\n")).toBe(true);
  });

  it("exit 0 on a valid bundle, 1 on a tampered one, 2 on a usage error", () => {
    const valid = node([BUNDLE_PATH, "--jwks", JWKS_PATH]);
    expect(valid.status, valid.stderr).toBe(0);
    expect(valid.stdout).toContain("valid, with flags: card hash not recorded, card not bound");
    const tampered = (JSON.parse(fixtureText("tampered")) as TamperedCase[])[0]!;
    const bad = node([writeTmp("proc-tampered.json", tampered.input), "--jwks", JWKS_PATH]);
    expect(bad.status).toBe(1);
    expect(bad.stdout).toContain("invalid: 0:signature_invalid");
    expect(node([]).status).toBe(2);
  });

  it("a forged kid cannot print `valid` through the real process either", () => {
    const outcome = JSON.parse(fixtureText("golden-outcome")) as Record<string, unknown>;
    const r = node([writeTmp("proc-forged-kid.json", { ...outcome, signing_key_id: FORGED_KID }), "--jwks", JWKS_PATH]);
    expect(r.status).toBe(1);
    expect(r.stdout).not.toMatch(RAW_CONTROL_RE);
    const lines = r.stdout.trim().split("\n");
    expect(lines).toHaveLength(3);
    expect(lines[2]).toBe("invalid: 0:key_not_found");
  });

  it("reads real stdin with -", () => {
    const r = node(["-", "--jwks", JWKS_PATH, "--json"], fixtureText("golden-bundle"));
    expect(r.status, r.stderr).toBe(0);
    expect((JSON.parse(r.stdout) as { valid: boolean }).valid).toBe(true);
  });
});
