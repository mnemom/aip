// Tests for check-verifier-publish.mjs (Record K1.15). Run: node --test .github/scripts/
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { compare, entryOf, entryPoints, parseArgs } from "./check-verifier-publish.mjs";

const SCRIPT = fileURLToPath(new URL("./check-verifier-publish.mjs", import.meta.url));
const SHA = "a".repeat(40);
const PKG = {
  name: "@mnemom/aip-verifier",
  main: "./dist/index.cjs",
  types: "./dist/index.d.ts",
  exports: { ".": { import: { default: "./dist/index.js" }, require: { default: "./dist/index.cjs" } } },
};
const FILES = ["LICENSE", "dist/index.cjs", "dist/index.d.ts", "dist/index.js", "package.json"];
const good = (over = {}) => ({
  pkg: PKG,
  dryRun: { files: FILES, shasum: "s1" },
  packed: { files: FILES, shasum: "s1" },
  gitHead: SHA,
  headSha: SHA,
  expectSha: SHA,
  ...over,
});

test("entryPoints: main, types and every exports target", () => {
  assert.deepEqual(entryPoints(PKG), ["dist/index.cjs", "dist/index.d.ts", "dist/index.js"]);
});

test("entryOf: reads the package entry, refuses output without one", () => {
  const out = { "@mnemom/aip-verifier": { files: [{ path: "b" }, { path: "a" }], shasum: "x" } };
  assert.deepEqual(entryOf(out, PKG.name, "t").files, ["a", "b"]);
  assert.deepEqual(entryOf([{ name: PKG.name, files: [], shasum: "y" }], PKG.name, "t").shasum, "y");
  assert.throws(() => entryOf({}, PKG.name, "t"), /no files and shasum/);
  assert.throws(() => entryOf([{ name: PKG.name, files: [] }], PKG.name, "t"), /no files and shasum/);
});

test("compare: a matching publish passes", () => {
  assert.deepEqual(compare(good()), []);
  assert.deepEqual(compare(good({ expectSha: undefined })), []);
});

test("compare: a tarball whose files differ from the release tarball fails", () => {
  const errs = compare(good({ packed: { files: [...FILES, "dist/extra.js"], shasum: "s1" } }));
  assert.match(errs.join("\n"), /only in tarball \[dist\/extra\.js\]/);
});

test("compare: a tarball whose shasum differs from the release tarball fails", () => {
  assert.match(compare(good({ packed: { files: FILES, shasum: "s2" } })).join("\n"), /shasum s1 != release tarball shasum s2/);
});

test("compare: a file outside package.json, LICENSE, README and dist/ fails", () => {
  const files = [...FILES, "src/index.ts"].sort();
  const errs = compare(good({ dryRun: { files, shasum: "s1" }, packed: { files, shasum: "s1" } }));
  assert.match(errs.join("\n"), /tarball holds src\/index\.ts/);
});

test("compare: a missing LICENSE or entry point fails", () => {
  const files = FILES.filter((f) => f !== "LICENSE" && f !== "dist/index.js");
  const errs = compare(good({ dryRun: { files, shasum: "s1" }, packed: { files, shasum: "s1" } })).join("\n");
  assert.match(errs, /tarball has no LICENSE/);
  assert.match(errs, /names dist\/index\.js, which is not in the tarball/);
});

test("compare: a gitHead that is not HEAD, not the expected sha, or missing fails", () => {
  const b = "b".repeat(40);
  assert.match(compare(good({ gitHead: b })).join("\n"), /gitHead b+ != checked-out HEAD a+/);
  assert.match(compare(good({ expectSha: b })).join("\n"), /gitHead a+ != expected b+/);
  assert.match(compare(good({ gitHead: undefined })).join("\n"), /gitHead is undefined/);
  assert.match(compare(good({ gitHead: "HEAD" })).join("\n"), /not a commit sha/);
});

// End to end: a throwaway package in its own git repo, run through real npm.
function fixture({ extraFile } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "verifier-publish-"));
  const pkg = { name: "@mnemom/aip-verifier", version: "0.0.0-test", main: "./dist/index.js", files: ["dist", "LICENSE"] };
  if (extraFile) pkg.files.push(extraFile);
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify(pkg));
  fs.writeFileSync(path.join(dir, "LICENSE"), "Apache-2.0\n");
  fs.mkdirSync(path.join(dir, "dist"));
  fs.writeFileSync(path.join(dir, "dist/index.js"), "export {};\n");
  if (extraFile) fs.writeFileSync(path.join(dir, extraFile), "x\n");
  const git = (...a) => execFileSync("git", a, { cwd: dir, encoding: "utf8" }).trim();
  git("init", "-q");
  git("add", "-A");
  git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "fixture");
  return { dir, head: git("rev-parse", "HEAD") };
}
const runCheck = (...args) =>
  spawnSync(process.execPath, [SCRIPT, ...args], {
    encoding: "utf8",
    env: { ...process.env, npm_config_registry: "http://127.0.0.1:9/", npm_config_fetch_retries: "0" },
  });

test("end to end: the real npm run passes at HEAD and fails on a mismatched gitHead or tarball", { timeout: 120_000 }, () => {
  const ok = fixture();
  const pass = runCheck("--dir", ok.dir, "--expect-sha", ok.head);
  assert.equal(pass.status, 0, pass.stderr + pass.stdout);
  assert.match(pass.stdout, new RegExp(`gitHead ${ok.head}`));

  const wrong = runCheck("--dir", ok.dir, "--expect-sha", "c".repeat(40));
  assert.equal(wrong.status, 1);
  assert.match(wrong.stderr, /gitHead [0-9a-f]{40} != expected c{40}/);

  const extra = fixture({ extraFile: "secrets.txt" });
  const bad = runCheck("--dir", extra.dir, "--expect-sha", extra.head);
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /tarball holds secrets\.txt/);
});

test("parseArgs: --dir and --expect-sha parse; no --dir or an unknown argument throws", () => {
  assert.deepEqual(parseArgs(["--dir", "d", "--expect-sha", SHA]), { dir: "d", "expect-sha": SHA });
  assert.throws(() => parseArgs([]), /--dir is required/);
  assert.throws(() => parseArgs(["--expect-sha", SHA]), /--dir is required/);
  assert.throws(() => parseArgs(["--dir", "d", "--tag", "next"]), /unknown argument --tag/);
});

test("CLI: a bad argument is exit 2 (could not run), never a pass", () => {
  const none = runCheck();
  assert.equal(none.status, 2);
  assert.match(none.stderr, /--dir is required/);
  const unknown = runCheck("--dir", ".", "--bogus");
  assert.equal(unknown.status, 2);
  assert.match(unknown.stderr, /unknown argument --bogus/);
});
