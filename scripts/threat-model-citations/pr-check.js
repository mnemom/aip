#!/usr/bin/env node
"use strict";
// gates/threat-model-links/pr-check.js: the GitHub reads behind threat-model citations, and the
// PR-time check that fails an open PR which touches a threat-model surface without citing its
// doc. The K-L07 record step (scripts/record-gates-k-l07-github.js) reads PR templates with
// templatePaths and readTemplates from here, so the gate and the PR-time check exclude the same
// template lines.
//
// Vendored byte for byte, with citation.js, into scripts/threat-model-citations/ of each repo a
// surface lives in, next to that repo's surfaces.json (its surfaces from
// registry/threshold-registry.json gates.threat-model-links.surfaces: id, doc, former_docs,
// paths). Edit this file here, then copy it there: the gate compares each vendored copy with
// this file and fails a surface whose copy differs.
//
// READ ONLY. GETs to https://api.github.com only, with the workflow's GITHUB_TOKEN (contents
// and pull-requests read). The PR body and its changed files are read live on each run, so a
// re-run after a body edit grades the edited body. No request timeout of its own: the
// workflow job's timeout-minutes bounds the run. Templates: every version of every PR
// template on the default branch, the same reads the gate's dump makes.
//
// Usage: node scripts/threat-model-citations/pr-check.js --repo <owner/name> --pr <number>
//   env GH_TOKEN. Exit 0: every surface the PR touches is cited, or it touches none.
//   Exit 1: a touched surface is not cited. Exit 2: could not check (never a pass).
const fs = require("node:fs");
const path = require("node:path");
const buffer = require("node:buffer");
const citation = require("./citation.js");

const API = "https://api.github.com";
const PER_PAGE = 100;
const MAX_PAGES = 30;
const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

/** A GET for https://api.github.com only: { json, next } per page, throws on anything not 200. */
function githubGet(fetchImpl, token) {
  return async function get(url) {
    const u = new URL(url);
    if (u.protocol !== "https:" || u.hostname !== "api.github.com")
      throw new Error(`refusing ${u.origin}: this check reads https://api.github.com only`);
    const r = await fetchImpl(u.toString(), {
      method: "GET",
      redirect: "manual",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "mnemom-threat-model-citations",
      },
    });
    if (r.status !== 200) throw new Error(`GET ${u.pathname}: HTTP ${r.status}`);
    let json;
    try {
      json = JSON.parse(await r.text());
    } catch {
      throw new Error(`GET ${u.pathname}: body is not JSON`);
    }
    const m = /<([^>]+)>;\s*rel="next"/.exec(r.headers.get("link") || "");
    return { json, next: m ? m[1] : null };
  };
}

/** Every page of a list endpoint. `pick` maps a page body to its items. */
async function pages(get, url, what, pick = (j) => j) {
  const out = [];
  for (let page = 1; url; page++) {
    if (page > MAX_PAGES) throw new Error(`${what}: more than ${MAX_PAGES} pages`);
    const { json, next } = await get(url);
    const items = pick(json);
    if (!Array.isArray(items)) throw new Error(`${what}: page ${page} is not a list`);
    out.push(...items);
    url = next;
  }
  return out;
}

/** Where GitHub reads a PR template from (case-insensitive): the file in the root, .github/ or
 * docs/, or any file in a PULL_REQUEST_TEMPLATE/ directory there. */
const TEMPLATE_DIRS = ["", ".github/", "docs/"];
function templateLocation(p) {
  const lower = p.toLowerCase();
  for (const d of TEMPLATE_DIRS) {
    if (!lower.startsWith(d)) continue;
    const rest = lower.slice(d.length);
    if (/^pull_request_template(\.[a-z]+)?$/.test(rest)) return true;
    if (/^pull_request_template\/[^/]+$/.test(rest)) return true;
  }
  return false;
}

/** The repo's PR template files on its default branch. Throws on a truncated tree, or on a
 * template-named file outside the locations GitHub reads (its lines could not be told apart). */
async function templatePaths(get, repo) {
  const { json } = await get(`${API}/repos/${repo}/git/trees/HEAD?recursive=1`);
  if (!json || !Array.isArray(json.tree)) throw new Error(`${repo} tree: no tree`);
  if (json.truncated) throw new Error(`${repo} tree: truncated, template locations unknown`);
  const out = [];
  for (const e of json.tree) {
    if (!e || e.type !== "blob" || typeof e.path !== "string") continue;
    if (!/pull_request_template/i.test(e.path)) continue;
    if (!templateLocation(e.path))
      throw new Error(`${repo}: a PR template at ${e.path} is outside the locations read`);
    out.push(e.path);
  }
  return out.sort();
}

/** Every version of every PR template on the default branch, oldest first per file. A template
 * deleted before the read is not seen: its location is gone from the tree. */
async function readTemplates(get, repo) {
  const out = [];
  for (const file of await templatePaths(get, repo)) {
    const commits = await pages(
      get,
      `${API}/repos/${repo}/commits?path=${encodeURIComponent(file)}&per_page=${PER_PAGE}`,
      `${repo} ${file} commits`,
    );
    for (const c of commits.reverse()) {
      if (!c || typeof c.sha !== "string")
        throw new Error(`${repo} ${file} commits: a commit without sha`);
      const { json } = await get(
        `${API}/repos/${repo}/contents/${file.split("/").map(encodeURIComponent).join("/")}?ref=${c.sha}`,
      );
      if (!json || json.encoding !== "base64" || typeof json.content !== "string")
        throw new Error(`${repo} ${file} @${c.sha.slice(0, 7)}: no base64 content`);
      out.push(buffer.Buffer.from(json.content, "base64").toString("utf8"));
    }
  }
  return out;
}

/** The PR's body as it is now and its changed files. */
async function readPr(get, repo, number) {
  const { json } = await get(`${API}/repos/${repo}/pulls/${number}`);
  if (!json || json.number !== number) throw new Error(`${repo}#${number}: not a pull request`);
  const files = await pages(
    get,
    `${API}/repos/${repo}/pulls/${number}/files?per_page=${PER_PAGE}`,
    `${repo}#${number} files`,
  );
  if (files.some((f) => !f || typeof f.filename !== "string"))
    throw new Error(`${repo}#${number} files: a file without filename`);
  return {
    body: typeof json.body === "string" ? json.body : "",
    files: files.map((f) => f.filename),
  };
}

/** The repo's surfaces from surfaces.json text: { repo, surfaces: [{ id, doc, former_docs?,
 * paths }] }. Throws unless every field is well formed and the file is for `repo`. */
function loadSurfaces(text, repo) {
  let j;
  try {
    j = JSON.parse(text);
  } catch {
    throw new Error("surfaces.json is not JSON");
  }
  if (!j || j.repo !== repo) throw new Error(`surfaces.json is not for ${repo}`);
  if (!Array.isArray(j.surfaces) || j.surfaces.length === 0)
    throw new Error("surfaces.json surfaces is not a non-empty list");
  const strings = (v) => Array.isArray(v) && v.every((x) => typeof x === "string" && x !== "");
  j.surfaces.forEach((s, i) => {
    if (
      !s ||
      typeof s.id !== "string" ||
      s.id === "" ||
      typeof s.doc !== "string" ||
      s.doc === "" ||
      !(s.former_docs === undefined || strings(s.former_docs)) ||
      !strings(s.paths) ||
      s.paths.length === 0
    )
      throw new Error(`surfaces.json surfaces[${i}] needs id, doc, paths and a valid former_docs`);
  });
  return j.surfaces;
}

/** Up to SHOWN file names, then how many more. */
const SHOWN = 5;
const named = (files) =>
  files.slice(0, SHOWN).join(", ") +
  (files.length > SHOWN ? ` and ${files.length - SHOWN} more` : "");

/** The report lines for graded surfaces, and the exit code: 1 when one is not cited. */
function report(graded) {
  if (graded.length === 0) return { code: 0, lines: ["This PR touches no threat-model surface."] };
  const lines = graded.map(({ surface: s, files, cited }) =>
    cited
      ? `cited: ${s.doc} (surface ${s.id})`
      : `::error title=Threat model not cited::This PR changes ${named(files)} (surface ${s.id}) and its body does not cite ${s.doc}. Add a line of your own, outside HTML comments, naming the doc and the threat rows you checked, for example "Threat model: ${s.doc} (rows 3 and 6 still hold)". A line left as the PR template put it does not count. Edit the body and this check re-runs.`,
  );
  return { code: graded.every((g) => g.cited) ? 0 : 1, lines };
}

function parseArgv(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === "--repo" || k === "--pr") a[k.slice(2)] = argv[++i];
    else throw new Error(`unknown argument ${k}`);
  }
  if (typeof a.repo !== "string" || !REPO_RE.test(a.repo))
    throw new Error("--repo owner/name is required");
  if (!/^[1-9][0-9]*$/.test(a.pr || "")) throw new Error("--pr <number> is required");
  return { repo: a.repo, pr: Number(a.pr) };
}

/** The PR-time check. Returns the exit code. Logs the report, never the body or the token. */
async function main(argv, { env, fetchImpl, log, dir = __dirname }) {
  try {
    const { repo, pr } = parseArgv(argv);
    const surfaces = loadSurfaces(fs.readFileSync(path.join(dir, "surfaces.json"), "utf8"), repo);
    if (!env.GH_TOKEN) throw new Error("GH_TOKEN is unset");
    const get = githubGet(fetchImpl, env.GH_TOKEN);
    const { body, files } = await readPr(get, repo, pr);
    const lines = citation.templateLines(await readTemplates(get, repo));
    const { code, lines: out } = report(citation.grade(surfaces, { body, files, lines }));
    out.forEach((l) => log(l));
    return code;
  } catch (e) {
    const why = String((e && e.message) || e).split("\n")[0];
    log(`::error title=Threat model check could not run::${why}`);
    return 2;
  }
}

module.exports = {
  API,
  PER_PAGE,
  MAX_PAGES,
  githubGet,
  pages,
  templateLocation,
  templatePaths,
  readTemplates,
  readPr,
  loadSurfaces,
  report,
  parseArgv,
  main,
};

if (require.main === module) {
  main(process.argv.slice(2), {
    env: process.env,
    fetchImpl: fetch,
    log: (m) => process.stdout.write(`${m}\n`),
  }).then((code) => {
    process.exitCode = code;
  });
}
