#!/usr/bin/env node
"use strict";
// adw:vendored-from mnemom/deploy gates/record-test-shape/check.js tests=gates/record-test-shape/__tests__/check.test.js
// gates/record-test-shape/check.js: the per-PR test-shape check for Record criterion K1.15
// ("a direct test per added branch, a parser test per flag with unknown values reading off,
// a fault test per Mnemom call (fail open)"). Lane K-L06. See README.md next to this file.
// Rule letters, as Keith ruled on them (2026-11-14), differ from the criterion's word order:
//   (a) a parser test per flag read          graded here
//   (b) a fault test per Mnemom call site    graded here
//   (c) a direct test per added branch       NOT graded here: the review-gate structured verdict
//
// It runs in the CI of the five K1.15 repos (mnemom-platform, mnemom-api, aip, mnemom-adw,
// mnemom-test), not in record-gates.yml. mnemom/deploy is private and aip is public, so a
// repo cannot load this file from here at run time: each repo carries a copy at
// .github/record-test-shape/check.cjs (this file plus one provenance line, `drift.js
// --emit-copy`) and flags.json generated from the threshold registry (`--emit-flags`). That
// is why this file is self-contained and does not require gates/lib/gate.js. It keeps the
// same contract: exit 0 pass, 1 fail, 2 could not check (blind, red, never green), one JSON
// report per run (--out).
//
// Inputs, all files the caller workflow produced; this script makes no network call:
//   --diff <file>        `git diff --unified=0 --no-color --no-ext-diff <base>...<head>`
//   --flags <file>       flags.json ({ flags: { NAME: [known values] }, patterns: [regex] })
//   --registry <file>    or the threshold registry itself (deploy-side tests)
//   --head-ref <branch>  the PR head branch; --labels <a,b,c> the PR labels
//   --pr-author <login>  the PR author; --waived-by <login> who applied the waive label
//   --waived-by-type <t> that actor's account type (User, Bot, Organization); must be User
//   --max-diff-bytes <n> diffs larger than this are blind (default MAX_DIFF_BYTES, at most
//                        MAX_DIFF_BYTES_LIMIT)
//   --exclude <prefix>   repeatable: repo-relative path prefixes no rule grades
//   --out <file>         the JSON report; --summary <file> a markdown summary (step summary)
//   --emit-flags         print flags.json for --registry and exit
//   --names-only         with --emit-flags: each flag lists on and off only, never the
//                        registry's cell values (for a public repo, see flagsFromRegistry)

const fs = require("node:fs");
const path = require("node:path");
const { Buffer } = require("node:buffer");

const GATE = "record-test-shape";
const EXIT = Object.freeze({ pass: 0, fail: 1, blind: 2 });
const WAIVE_LABEL = "record-test-shape-waive";
const SCOPE_LABEL = "record-lane";
// A diff past this many bytes is blind: the text rules run several regexes per added line.
const MAX_DIFF_BYTES = 10 * 1024 * 1024;
/** The largest --max-diff-bytes accepted: one buffer of this size is allocated for the read. */
const MAX_DIFF_BYTES_LIMIT = 100 * 1024 * 1024;
// LANE.md section 4: every Record lane works on branches named record/<lane>/<slug>.
const RECORD_BRANCH = /^record\/[A-Z]-L\d{2}\//;
// Flag-shaped names that are credentials, never flags (RECORD_APP_PRIVATE_KEY, *_TOKEN ...).
const CREDENTIAL = /(KEY|TOKEN|SECRET|PASSWORD|PRIVATE|CREDENTIAL)/;

class CheckError extends Error {
  constructor(message) {
    super(message);
    this.exit = EXIT.blind;
  }
}

// ---------- files ----------

const SOURCE_EXT = /\.(?:[cm]?[jt]sx?|py)$/;
const TEST_PATH = [
  /(?:^|\/)(?:__tests__|__mocks__|tests?|spec|fixtures?)\//,
  /\.(?:test|spec)\.[cm]?[jt]sx?$/,
  /(?:^|\/)test_[^/]*\.py$/,
  /_test\.py$/,
  /(?:^|\/)conftest\.py$/,
];
const NEVER_SOURCE = [/(?:^|\/)(?:node_modules|dist|build|vendor)\//, /\.d\.ts$/];

function isTest(p) {
  return SOURCE_EXT.test(p) && TEST_PATH.some((re) => re.test(p));
}
function isSource(p) {
  return SOURCE_EXT.test(p) && !isTest(p) && !NEVER_SOURCE.some((re) => re.test(p));
}

/**
 * Parse a unified diff into [{ path, added: [{ line, text }] }] for files that exist after
 * the change. Deleted files and pure renames carry no added lines and are left out.
 */
function parseDiff(text) {
  const files = [];
  let cur = null;
  let next = 0;
  for (const raw of text.split("\n")) {
    if (raw.startsWith("diff --git ")) {
      cur = null;
      continue;
    }
    if (raw.startsWith("+++ ")) {
      const p = raw.slice(4).trim();
      if (p === "/dev/null") {
        cur = null;
      } else {
        cur = { path: p.replace(/^b\//, ""), added: [] };
        files.push(cur);
      }
      continue;
    }
    if (raw.startsWith("--- ")) continue;
    const h = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw);
    if (h) {
      next = Number(h[1]);
      continue;
    }
    if (!cur) continue;
    if (raw.startsWith("+")) {
      cur.added.push({ line: next, text: raw.slice(1) });
      next++;
    } else if (raw.startsWith(" ")) {
      next++;
    }
  }
  return files.filter((f) => f.added.length > 0);
}

function isComment(text) {
  return /^\s*(?:\/\/|#|\*|\/\*)/.test(text);
}

// ---------- flags (rule a) ----------

/**
 * flags.json from the threshold registry: each declared flag's known values, and the patterns.
 * With namesOnly (`--emit-flags --names-only`) each flag lists on and off only. A public repo
 * (aip) carries that form, so the registry's cell values (org ids, repo lists, App ids) never
 * sit in a public file. Rule (a) still finds every read of a declared flag. Only the parser
 * test's "unknown value" is wider there: a registry value counts as unknown.
 */
function flagsFromRegistry(registry, namesOnly = false) {
  const flags = {};
  for (const [name, f] of Object.entries(registry.flags || {})) {
    const known = new Set(["on", "off"]);
    if (!namesOnly) {
      if (typeof f.unknown_reads === "string") known.add(f.unknown_reads);
      for (const v of Object.values(f.cells || {})) if (typeof v === "string") known.add(v);
    }
    flags[name] = [...known].sort();
  }
  return { flags, patterns: [...(registry.flag_name_patterns || [])] };
}

function loadFlags(args) {
  if (args.flags) return readJson(args.flags, "--flags");
  if (args.registry) return flagsFromRegistry(readJson(args.registry, "--registry"));
  throw new CheckError("--flags or --registry is required");
}

function isFlagName(name, spec) {
  if (CREDENTIAL.test(name)) return false;
  if (Object.prototype.hasOwnProperty.call(spec.flags, name)) return true;
  return spec.patterns.some((p) => new RegExp(p).test(name));
}

const DOTTED_ENV_READ = /\b(?:env|process\.env)\s*\??\.\s*([A-Z][A-Z0-9_]*)\b/g;
const QUOTED_NAME = /["'`]([A-Z][A-Z0-9_]*)["'`]/g;

/** Flag names an added source line reads: a dotted env read, or the name as a string literal. */
function flagReads(text, spec) {
  if (isComment(text)) return [];
  const out = new Set();
  for (const re of [DOTTED_ENV_READ, QUOTED_NAME]) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text)) !== null) if (isFlagName(m[1], spec)) out.add(m[1]);
  }
  return [...out];
}

const LITERAL = /["'`]([^"'`\n]*)["'`]/g;
const VALUE_SHAPED = /^[A-Za-z0-9_.,:*-]{1,64}$/;

/**
 * True when some changed test file has an added line naming the flag with a value-shaped
 * string literal, on that line or within two lines, that is neither the flag name nor one of
 * the values the registry lists for it (its cells and unknown_reads, plus on and off).
 */
function hasParserTest(name, spec, testFiles) {
  const known = new Set(spec.flags[name] || ["on", "off"]);
  for (const f of testFiles) {
    const byLine = new Map(f.added.map((a) => [a.line, a.text]));
    for (const a of f.added) {
      if (!a.text.includes(name)) continue;
      for (let l = a.line - 2; l <= a.line + 2; l++) {
        const t = byLine.get(l);
        if (t === undefined) continue;
        LITERAL.lastIndex = 0;
        let m;
        while ((m = LITERAL.exec(t)) !== null) {
          const v = m[1];
          if (v !== name && VALUE_SHAPED.test(v) && !known.has(v)) return true;
        }
      }
    }
  }
  return false;
}

// ---------- Mnemom calls (rule b) ----------

const NETWORK_CALL =
  /\b(?:fetch|fetchImpl|guardedFetch)\s*\(|\.fetch\s*\(|\b(?:requests|httpx)\.(?:get|post|put|patch|delete|head|request)\s*\(|\burlopen\s*\(/;
const MNEMOM_ENDPOINT =
  /\bMNEMOM_[A-Z0-9_]*(?:URL|BASE|ENDPOINT|HOST)[A-Z0-9_]*\b|https?:\/\/(?:[a-z0-9-]+\.)*mnemom\.ai\b/;
const FAULT =
  /\b5\d\d\b|\bthrow\b|mockRejectedValue|\breject\s*\(|ECONNREFUSED|ETIMEDOUT|ECONNRESET|AbortError|TimeoutError|ConnectionError|ConnectTimeout|ReadTimeout|side_effect\s*=|\braise\b/;

function isMnemomCall(text) {
  return !isComment(text) && NETWORK_CALL.test(text) && MNEMOM_ENDPOINT.test(text);
}

/** How many following added lines a call's arguments may span (`fetch(\n  `${MNEMOM_URL}`...`). */
const CALL_SPAN = 3;

/**
 * Open parentheses minus closed ones in `text`, not counting any inside a '…', "…" or `…`
 * literal, so `fetch(sep(")") +` stays open. `quote` is a template literal still open from the
 * previous line; only a backtick literal carries to the next line. A ' or " left open at the end
 * of the line was not a string (a regex `/'/`, an apostrophe in a comment), so that line counts
 * every parenthesis, as it did before literals were skipped.
 */
function parenDelta(text, quote = "") {
  let d = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === "\\") i++;
      else if (ch === quote) quote = "";
    } else if (ch === "'" || ch === '"' || ch === "`") quote = ch;
    else if (ch === "(") d++;
    else if (ch === ")") d--;
  }
  if (quote === "'" || quote === '"') {
    let all = 0;
    for (const ch of text)
      if (ch === "(") all++;
      else if (ch === ")") all--;
    return { d: all, quote: "" };
  }
  return { d, quote };
}

/**
 * Added lines that open a network call naming a Mnemom endpoint on that line, or on the next
 * few added lines while the call's parentheses are still open. A call that closes on its own
 * line (`fetch("https://example.com/x");`) never joins an endpoint on a later line.
 */
function mnemomCallSites(added) {
  const sites = [];
  for (let i = 0; i < added.length; i++) {
    const a = added[i];
    if (isComment(a.text)) continue;
    const m = NETWORK_CALL.exec(a.text);
    if (!m) continue;
    let hit = MNEMOM_ENDPOINT.test(a.text);
    let { d: depth, quote } = parenDelta(a.text.slice(m.index));
    for (let j = i + 1; !hit && depth > 0 && j < added.length && j <= i + CALL_SPAN; j++) {
      const b = added[j];
      if (b.line !== a.line + (j - i)) break; // only a contiguous run of added lines
      if (isComment(b.text)) continue;
      if (MNEMOM_ENDPOINT.test(b.text)) hit = true;
      const p = parenDelta(b.text, quote);
      depth += p.d;
      quote = p.quote;
    }
    if (hit) sites.push(a);
  }
  return sites;
}

/** The bare file stem, or null for an `index` or `__init__` file, which only an import names. */
function moduleStem(p) {
  const base = path.posix.basename(p).replace(SOURCE_EXT, "");
  return base === "index" || base === "__init__" ? null : base;
}

const JS_IMPORT =
  /(?:\bfrom\s+|\brequire\s*\(\s*|\bimport\s*\(\s*|\bimport\s+|\.mock\s*\(\s*)["'`](\.\.?(?:\/[^"'`\s]*)?)["'`]/g;
const PY_FROM_IMPORT = /^\s*from\s+(\.*)([\w.]*)\s+import\s+\(?\s*([\w\s,]*)/;
const PY_IMPORT = /^\s*import\s+([\w.]+(?:\s*,\s*[\w.]+)*)/;

/** Repo-relative paths a Python import line can name, each tagged relative or absolute. */
function pythonTargets(testDir, text) {
  const out = [];
  const from = PY_FROM_IMPORT.exec(text);
  if (from) {
    const [, dots, mod, names] = from;
    const bases = mod ? [mod.split(".")] : [[]];
    const parts = names
      .split(",")
      .map((n) => n.trim().split(/\s+/)[0])
      .filter((n) => /^\w+$/.test(n));
    const all = [...bases, ...parts.map((n) => [...bases[0], n])];
    if (dots) {
      let base = testDir;
      for (let k = 1; k < dots.length; k++) base = path.posix.dirname(base);
      for (const segs of all)
        out.push({ rel: true, p: path.posix.normalize(path.posix.join(base, ...segs)) });
    } else {
      for (const segs of all) if (segs.length) out.push({ rel: false, p: segs.join("/") });
    }
    return out;
  }
  const imp = PY_IMPORT.exec(text);
  if (imp)
    for (const m of imp[1].split(","))
      out.push({ rel: false, p: m.trim().split(/\s+/)[0].replace(/\./g, "/") });
  return out;
}

/**
 * True when a test's line imports the `index` or `__init__` module in `moduleDir` (repo
 * relative, "." for the repo root). A JS import must resolve from the test's own directory to
 * that directory or its index file. A Python relative import must resolve to it, and an
 * absolute one (`from pkg.client import x`, `import pkg.client`) must name a trailing run of
 * its path. A bare word `index`, `src` or `__init__` (a `def __init__`, say) never counts.
 */
function importsIndexModule(testPath, text, moduleDir) {
  const dir = path.posix.dirname(testPath);
  const want = path.posix.normalize(moduleDir);
  if (testPath.endsWith(".py")) {
    const wantParts = want === "." ? [] : want.split("/");
    return pythonTargets(dir, text).some(({ rel, p }) => {
      if (rel) return p === want;
      const segs = p.split("/");
      return (
        segs.length > 0 &&
        segs.length <= wantParts.length &&
        segs.every((s, k) => s === wantParts[wantParts.length - segs.length + k])
      );
    });
  }
  JS_IMPORT.lastIndex = 0;
  let m;
  while ((m = JS_IMPORT.exec(text)) !== null) {
    let r = path.posix.normalize(path.posix.join(dir, m[1])).replace(/\.[cm]?[jt]sx?$/, "");
    if (r === "index") r = ".";
    else if (r.endsWith("/index")) r = r.slice(0, -"/index".length);
    if (r === want) return true;
  }
  return false;
}

/** True when a changed test file's added lines name the module and carry a fault construct. */
function hasFaultTest(sourcePath, testFiles) {
  const stem = moduleStem(sourcePath);
  const moduleDir = path.posix.dirname(sourcePath);
  return testFiles.some((f) => {
    const body = f.added.map((a) => a.text).join("\n");
    const names =
      stem === null
        ? f.added.some((a) => importsIndexModule(f.path, a.text, moduleDir))
        : new RegExp(`\\b${escapeRe(stem)}\\b`).test(body);
    return names && FAULT.test(body);
  });
}

// ---------- the check ----------

/** A login with the app/ prefix (gh pr view) or [bot] suffix (REST) removed, lower-cased. */
function bareLogin(login) {
  return login
    .replace(/^app\//i, "")
    .replace(/\[bot\]$/i, "")
    .toLowerCase();
}

/**
 * The waive label counts only when a person other than the PR author applied it, so an agent
 * cannot waive its own PR. The actor type (`actor.type` of the labeled event: User, Bot or
 * Organization) must be exactly User, and is required: a GitHub App login such as
 * `mnemom-adw` carries no [bot] suffix in GraphQL, so the login alone cannot tell a bot from a
 * person. Returns { waived, waiver } where waiver says why it did or did not.
 */
function waiverOf(labels, prAuthor, waivedBy, waivedByType) {
  if (!labels.includes(WAIVE_LABEL)) return { waived: false, waiver: null };
  const by = (waivedBy || "").trim();
  const type = (waivedByType || "").trim();
  const author = (prAuthor || "").trim();
  let refused = null;
  if (!by) refused = "no --waived-by: who applied the label is unknown";
  else if (!type) refused = "no --waived-by-type: whether a person applied the label is unknown";
  else if (!author) refused = "no --pr-author: the PR author is unknown";
  else if (type !== "User") refused = `applied by a ${type} account (${by}), not a User`;
  else if (/^app\//i.test(by) || /\[bot\]$/i.test(by)) refused = `applied by a bot (${by})`;
  else if (bareLogin(by) === bareLogin(author)) refused = `applied by the PR author (${by})`;
  if (refused)
    return { waived: false, waiver: { label: WAIVE_LABEL, honored: false, reason: refused } };
  return { waived: true, waiver: { label: WAIVE_LABEL, honored: true, by } };
}

function evaluate({
  diffText,
  spec,
  headRef = "",
  labels = [],
  excludes = [],
  prAuthor = "",
  waivedBy = "",
  waivedByType = "",
}) {
  // Fail closed: without the head branch the scope cannot be decided, so an unknown head is
  // blind, never "not a Record-lane PR".
  if (typeof headRef !== "string" || headRef.trim() === "")
    throw new CheckError("--head-ref is missing or empty, so the PR scope cannot be decided");
  const inScope = RECORD_BRANCH.test(headRef) || labels.includes(SCOPE_LABEL);
  const { waived, waiver } = waiverOf(labels, prAuthor, waivedBy, waivedByType);
  if (!inScope) {
    return finish(
      [
        {
          id: "scope",
          status: "pass",
          detail: `not a Record-lane PR (head ${headRef}, no ${SCOPE_LABEL} label); K1.15 grades only Record-lane PRs`,
        },
      ],
      { in_scope: false },
    );
  }
  // Fail closed: a PR always changes something, so an empty diff or one with no file header
  // means the caller's diff step went wrong, not that there is nothing to grade.
  if (typeof diffText !== "string" || !/^diff --git /m.test(diffText))
    throw new CheckError("--diff is empty or not a unified git diff (no 'diff --git' header)");
  const graded = (p) =>
    !excludes.some((x) => p === x || p.startsWith(x.endsWith("/") ? x : `${x}/`));
  const files = parseDiff(diffText).filter((f) => graded(f.path));
  const sources = files.filter((f) => isSource(f.path));
  const tests = files.filter((f) => isTest(f.path));

  // (a) parser test per flag
  const flagSites = new Map();
  for (const f of sources)
    for (const a of f.added)
      for (const name of flagReads(a.text, spec))
        if (!flagSites.has(name)) flagSites.set(name, `${f.path}:${a.line}`);
  const missingParser = [...flagSites]
    .filter(([name]) => !hasParserTest(name, spec, tests))
    .map(([name, at]) => ({ flag: name, at }));

  // (b) fault test per Mnemom call site
  const callSites = [];
  for (const f of sources)
    for (const a of mnemomCallSites(f.added)) callSites.push({ file: f.path, line: a.line });
  const missingFault = callSites.filter((c) => !hasFaultTest(c.file, tests));

  const ruleAB = (id, missing, total, what) => {
    if (missing.length === 0)
      return { id, status: "pass", detail: `${total} ${what}, each with a test in this PR` };
    if (waived)
      return {
        id,
        status: "pass",
        waived: true,
        missing,
        detail: `waived by label ${WAIVE_LABEL}, applied by ${waiver.by}`,
      };
    return {
      id,
      status: "fail",
      missing,
      detail:
        `${missing.length} of ${total} ${what} with no test in this PR` +
        (waiver ? `; waive label not honored: ${waiver.reason}` : ""),
    };
  };
  const checks = [
    {
      id: "scope",
      status: "pass",
      detail: `Record-lane PR (head ${headRef})`,
    },
    ruleAB("parser-test-per-flag", missingParser, flagSites.size, "flag read(s)"),
    ruleAB("fault-test-per-mnemom-call", missingFault, callSites.length, "Mnemom call site(s)"),
  ];
  return finish(checks, { in_scope: true, waived, ...(waiver ? { waiver } : {}) });
}

function finish(checks, extra) {
  // Every check is pass or fail: anything that cannot be checked throws CheckError (blind).
  // A check with any other status is a bug in this file, so it is blind too, never a pass.
  const odd = checks.find((c) => c.status !== "pass" && c.status !== "fail");
  if (odd) throw new CheckError(`check ${odd.id} has unknown status ${String(odd.status)}`);
  const fails = checks.filter((c) => c.status === "fail").length;
  const status = fails > 0 ? "fail" : "pass";
  return {
    gate: GATE,
    criteria: ["K1.15"],
    status,
    exit: EXIT[status],
    counts: { pass: checks.length - fails, fail: fails, blind: 0 },
    checks,
    ...extra,
  };
}

function summary(report) {
  const rows = report.checks.map((c) => {
    const items = (c.missing || [])
      .slice(0, 20)
      .map((x) => (x.flag ? `${x.flag} at ${x.at}` : `${x.file}:${x.line}`));
    return `| ${c.id} | ${c.status}${c.waived ? " (waived)" : ""} | ${c.detail}${items.length ? "<br>" + items.join("<br>") : ""} |`;
  });
  return [
    `## ${GATE} (K1.15): ${report.status.toUpperCase()}`,
    "",
    "| rule | status | detail |",
    "|---|---|---|",
    ...rows,
    "",
  ].join("\n");
}

// ---------- CLI ----------

function parseArgs(argv) {
  const repeatable = new Set(["exclude"]);
  const known = new Set([
    "diff",
    "flags",
    "registry",
    "head-ref",
    "labels",
    "pr-author",
    "waived-by",
    "waived-by-type",
    "max-diff-bytes",
    "exclude",
    "out",
    "summary",
    "emit-flags",
    "names-only",
  ]);
  const switches = new Set(["emit-flags", "names-only"]);
  const out = { exclude: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) throw new CheckError(`unexpected argument: ${a}`);
    let name = a.slice(2);
    let value;
    const eq = name.indexOf("=");
    if (eq >= 0) {
      value = name.slice(eq + 1);
      name = name.slice(0, eq);
    } else if (argv[i + 1] === undefined || argv[i + 1].startsWith("--")) {
      // Only the switches take no value. Any other option with none (an unquoted empty
      // ${{ github.head_ref }} at the end of a line, say) is blind, never a "true" string.
      if (!switches.has(name)) throw new CheckError(`--${name} needs a value`);
      value = "true";
    } else {
      value = argv[++i];
    }
    if (!known.has(name)) throw new CheckError(`unknown option --${name}`);
    if (repeatable.has(name)) out[name].push(value);
    else if (name in out) throw new CheckError(`--${name} given twice`);
    else out[name] = value;
  }
  return out;
}

function readJson(file, what) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (err) {
    throw new CheckError(`cannot read ${what} ${file}: ${err.message}`);
  }
}

/**
 * Read at most max + 1 bytes of the diff through one descriptor: one more byte than the cap
 * means the diff is over it. There is no separate size check, so nothing can change between a
 * check and the read. A read error is blind; the over-cap error keeps its own message.
 */
function readCapped(file, max) {
  let over;
  let text;
  try {
    const fd = fs.openSync(file, "r");
    try {
      const buf = Buffer.alloc(max + 1);
      let n = 0;
      let got;
      while (n < buf.length && (got = fs.readSync(fd, buf, n, buf.length - n, null)) > 0) n += got;
      over = n > max;
      text = buf.toString("utf8", 0, n);
    } finally {
      fs.closeSync(fd);
    }
  } catch (err) {
    throw new CheckError(`cannot read --diff ${file}: ${err.message}`);
  }
  if (over)
    throw new CheckError(`--diff is over the ${max}-byte cap: too large to grade, split the PR`);
  return text;
}

function run(argv) {
  const args = parseArgs(argv);
  const namesOnly = args["names-only"] !== undefined;
  if (namesOnly && (args["names-only"] !== "true" || args["emit-flags"] !== "true"))
    throw new CheckError("--names-only is a switch that only goes with --emit-flags");
  if (args["emit-flags"] === "true") {
    if (!args.registry) throw new CheckError("--emit-flags needs --registry");
    return { emit: flagsFromRegistry(readJson(args.registry, "--registry"), namesOnly) };
  }
  if (!args.diff) throw new CheckError("--diff is required");
  let max = MAX_DIFF_BYTES;
  if (args["max-diff-bytes"] !== undefined) {
    max = Number(args["max-diff-bytes"]);
    if (!/^\d+$/.test(args["max-diff-bytes"]) || max < 1 || max > MAX_DIFF_BYTES_LIMIT)
      throw new CheckError(
        `--max-diff-bytes must be a positive integer of at most ${MAX_DIFF_BYTES_LIMIT}`,
      );
  }
  const diffText = readCapped(args.diff, max);
  const spec = loadFlags(args);
  const labels = (args.labels || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return evaluate({
    diffText,
    spec,
    headRef: args["head-ref"] || "",
    labels,
    excludes: args.exclude,
    prAuthor: args["pr-author"] || "",
    waivedBy: args["waived-by"] || "",
    waivedByType: args["waived-by-type"] || "",
  });
}

function main(argv = process.argv.slice(2)) {
  let report;
  let args = {};
  try {
    args = parseArgs(argv);
    report = run(argv);
    if (report.emit) {
      process.stdout.write(JSON.stringify(report.emit, null, 2) + "\n");
      return 0;
    }
  } catch (err) {
    // any error, a CheckError or not (a bad regex in flags.json, say), is blind, never green
    report = {
      gate: GATE,
      criteria: ["K1.15"],
      status: "blind",
      exit: EXIT.blind,
      reason: err.message,
      checks: [],
    };
  }
  // Write the report even when argument parsing failed (same as gates/lib/gate.js runCli):
  // recover --out and --summary straight from argv.
  const out = args.out ?? rawOption(argv, "out");
  const sum = args.summary ?? rawOption(argv, "summary");
  try {
    if (out) fs.writeFileSync(out, JSON.stringify(report, null, 2) + "\n");
    if (sum) fs.appendFileSync(sum, summary(report) + "\n");
  } catch (err) {
    // the report to stdout still carries the result; an unwritable --out cannot turn green
    process.stderr.write(`gate ${GATE}: cannot write report: ${err.message}\n`);
    if (report.exit === EXIT.pass) report = { ...report, status: "blind", exit: EXIT.blind };
  }
  process.stderr.write(
    `gate ${GATE}: ${report.status.toUpperCase()}${report.reason ? ` (${report.reason})` : ""}\n`,
  );
  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  process.exitCode = report.exit;
  return report.exit;
}

function rawOption(argv, name) {
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === `--${name}`) {
      const v = argv[i + 1];
      return v !== undefined && !v.startsWith("--") ? v : undefined;
    }
    if (argv[i].startsWith(`--${name}=`)) return argv[i].slice(name.length + 3);
  }
  return undefined;
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

module.exports = {
  GATE,
  EXIT,
  WAIVE_LABEL,
  MAX_DIFF_BYTES,
  MAX_DIFF_BYTES_LIMIT,
  SCOPE_LABEL,
  CheckError,
  parseDiff,
  isSource,
  isTest,
  flagsFromRegistry,
  flagReads,
  hasParserTest,
  isMnemomCall,
  mnemomCallSites,
  hasFaultTest,
  importsIndexModule,
  waiverOf,
  finish,
  evaluate,
  summary,
  main,
};

if (require.main === module) main();
