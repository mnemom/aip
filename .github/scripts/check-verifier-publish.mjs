#!/usr/bin/env node
// check-verifier-publish.mjs: PR-time proof that packages/verifier publishes
// what publish.yml would ship (Record K1.15).
//
// publish.yml ships @mnemom/aip-verifier two ways from the release commit:
// the `npm pack` tarball attached to the release (verifier-test) and
// `npm publish` through the org reusable (publish-verifier-npm). This script
// runs both locally, never touching the registry beyond a read:
//   1. `npm publish --dry-run --json`: the files and shasum npm would upload;
//   2. `npm pack --json`: the release-asset tarball;
//   3. the manifest npm publish sends, read with npm's own package-json
//      prepare() (the call `npm publish` makes), for its gitHead.
// It fails when the two tarballs differ (files or shasum), when the tarball
// holds a file outside package.json, LICENSE, README and dist/, when an entry
// point named in package.json is missing from it, or when gitHead is not the
// checked-out commit (`git rev-parse HEAD`) and, given --expect-sha, that sha.
//
// Usage: node check-verifier-publish.mjs --dir packages/verifier [--expect-sha <sha>]
// Run it after `npm ci && npm run build`. Exit 0 pass, 1 mismatch, 2 could not run.
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ALLOWED = /^(package\.json|LICENSE|README(\.md)?|dist\/.+)$/;
const REQUIRED = ["package.json", "LICENSE"];

/** Every file path package.json names as an entry point (main, module, types, exports). */
export function entryPoints(pkg) {
  const out = new Set();
  const walk = (v) => {
    if (typeof v === "string") out.add(v.replace(/^\.\//, ""));
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  for (const k of ["main", "module", "types"]) walk(pkg[k]);
  walk(pkg.exports);
  return [...out].sort();
}

/** The one package entry of an npm --json pack/publish output. */
export function entryOf(json, name, what) {
  const e = Array.isArray(json) ? json.find((x) => x && x.name === name) : json && json[name];
  if (!e || !Array.isArray(e.files) || typeof e.shasum !== "string")
    throw new Error(`${what}: no files and shasum for ${name}`);
  return { files: e.files.map((f) => f.path).sort(), shasum: e.shasum, integrity: e.integrity };
}

/** Every mismatch between what would be published and what publish.yml ships. */
export function compare({ pkg, dryRun, packed, gitHead, headSha, expectSha }) {
  const errors = [];
  const a = dryRun.files.join("\n");
  const b = packed.files.join("\n");
  if (a !== b) {
    const only = (x, y) => x.filter((f) => !y.includes(f));
    errors.push(
      `publish --dry-run files differ from the release tarball: only in publish [${only(dryRun.files, packed.files).join(", ")}], only in tarball [${only(packed.files, dryRun.files).join(", ")}]`,
    );
  }
  if (dryRun.shasum !== packed.shasum)
    errors.push(`publish --dry-run shasum ${dryRun.shasum} != release tarball shasum ${packed.shasum}`);
  for (const f of dryRun.files)
    if (!ALLOWED.test(f)) errors.push(`tarball holds ${f}, outside package.json, LICENSE, README and dist/`);
  for (const f of REQUIRED) if (!dryRun.files.includes(f)) errors.push(`tarball has no ${f}`);
  for (const f of entryPoints(pkg))
    if (!dryRun.files.includes(f)) errors.push(`package.json names ${f}, which is not in the tarball`);
  const sha = /^[0-9a-f]{40}$/;
  if (typeof gitHead !== "string" || !sha.test(gitHead)) errors.push(`gitHead is ${JSON.stringify(gitHead)}, not a commit sha`);
  else {
    if (gitHead !== headSha) errors.push(`gitHead ${gitHead} != checked-out HEAD ${headSha}`);
    if (expectSha && gitHead !== expectSha) errors.push(`gitHead ${gitHead} != expected ${expectSha}`);
  }
  return errors;
}

function parseArgs(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--dir" || argv[i] === "--expect-sha") a[argv[i].slice(2)] = argv[++i];
    else throw new Error(`unknown argument ${argv[i]}`);
  }
  if (!a.dir) throw new Error("--dir is required");
  return a;
}

const run = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });

async function main() {
  const a = parseArgs(process.argv.slice(2));
  const dir = path.resolve(a.dir);
  const pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
  // --force: a dry run never uploads; without it npm refuses a version that is
  // already on the registry, and a PR that does not bump the version is still checked.
  // --ignore-scripts: the caller has built dist/; prepublishOnly would only rebuild it.
  const dryRun = entryOf(
    JSON.parse(run("npm", ["publish", "--dry-run", "--json", "--force", "--ignore-scripts", "--tag", "latest"], dir)),
    pkg.name,
    "npm publish --dry-run",
  );
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "verifier-pack-"));
  const packed = entryOf(
    JSON.parse(run("npm", ["pack", "--json", "--ignore-scripts", "--pack-destination", dest], dir)),
    pkg.name,
    "npm pack",
  );
  // The manifest `npm publish` sends: npm's own package-json, fix() then prepare().
  const npmRoot = path.join(run("npm", ["root", "-g"], dir).trim(), "npm");
  const PackageJson = createRequire(path.join(npmRoot, "package.json"))("@npmcli/package-json");
  const { content } = await (await PackageJson.fix(dir, { changes: [] })).prepare();
  const headSha = run("git", ["rev-parse", "HEAD"], dir).trim();
  const errors = compare({ pkg, dryRun, packed, gitHead: content.gitHead, headSha, expectSha: a["expect-sha"] });
  console.log(
    `${pkg.name}@${pkg.version}: ${dryRun.files.length} files, shasum ${dryRun.shasum}, gitHead ${content.gitHead}, HEAD ${headSha}${a["expect-sha"] ? `, expected ${a["expect-sha"]}` : ""}`,
  );
  for (const f of dryRun.files) console.log(`  ${f}`);
  if (errors.length) {
    for (const e of errors) console.error(`ERROR: ${e}`);
    process.exit(1);
  }
  console.log("ok: npm publish would ship the release tarball, built from HEAD");
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(`check-verifier-publish: ${e && e.message}`);
    process.exit(2);
  });
}
