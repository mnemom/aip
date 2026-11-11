"use strict";
// citation.js and pr-check.js: the PR-time threat-model check and the reads the K-L07 gate
// shares with it. Vendored with them into scripts/threat-model-citations/__tests__/ of each
// surface repo, so it needs nothing but the two files beside it and Node's own modules.
const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const buffer = require("node:buffer");
const citation = require("../citation.js");
const pc = require("../pr-check.js");

const REPO = "mnemom/aip";
const DOC = "packages/verify-page/THREAT-MODEL.md";
const OLD_DOC = "packages/verifier-page/THREAT-MODEL.md";
const SURFACE = { id: "verifier", doc: DOC, former_docs: [OLD_DOC], paths: ["packages/verify/"] };
const OTHER = { id: "page", doc: "docs/page.md", paths: ["web/index.html"] };
const SURFACES = JSON.stringify({ repo: REPO, surfaces: [SURFACE, OTHER] });
const TEMPLATE = `## Threat model\n\n<!--\nThreat model: ${DOC}\n-->\n\nThreat model: ${DOC}\n`;
const b64 = (s) => buffer.Buffer.from(s, "utf8").toString("base64");
const sha = (c) => c.repeat(40);

function res(status, body, link) {
  return {
    status,
    headers: { get: (name) => (name === "link" && link ? link : null) },
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
  };
}

// A GitHub stand-in: routes is { "<path?query>": () => res(...) }. Any other URL is a 404.
function fake(routes) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const u = new URL(url);
    calls.push({ key: u.pathname + u.search, init });
    const r = routes[u.pathname + u.search];
    return r ? r() : res(404, { message: "Not Found" });
  };
  return { fetchImpl, calls };
}
const API = "https://api.github.com";
const tree = `/repos/${REPO}/git/trees/HEAD?recursive=1`;
const commits = `/repos/${REPO}/commits?path=.github%2Fpull_request_template.md&per_page=100`;
const content = (c) => `/repos/${REPO}/contents/.github/pull_request_template.md?ref=${sha(c)}`;
const pull = (n) => `/repos/${REPO}/pulls/${n}`;
const files = (n) => `/repos/${REPO}/pulls/${n}/files?per_page=100`;
const routes = ({ body = `Threat model: ${DOC} (rows 3 and 6 hold)`, changed } = {}) => ({
  [pull(7)]: () => res(200, { number: 7, body }),
  [files(7)]: () =>
    res(
      200,
      (changed || ["packages/verify/src/index.ts"]).map((filename) => ({ filename })),
    ),
  [tree]: () =>
    res(200, {
      truncated: false,
      tree: [
        { type: "tree", path: ".github" },
        { type: "blob", path: ".github/pull_request_template.md" },
      ],
    }),
  [commits]: () => res(200, [{ sha: sha("b") }, { sha: sha("a") }]),
  [content("a")]: () => res(200, { encoding: "base64", content: b64("old") }),
  [content("b")]: () => res(200, { encoding: "base64", content: b64(TEMPLATE) }),
});
const dirWith = (t, text = SURFACES) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "tmc-"));
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  if (text !== null) fs.writeFileSync(path.join(d, "surfaces.json"), text);
  return d;
};
async function runMain(t, argv, { r = routes(), env = { GH_TOKEN: "t" }, text } = {}) {
  const logs = [];
  const { fetchImpl } = fake(r);
  const code = await pc.main(argv, {
    env,
    fetchImpl,
    log: (m) => logs.push(m),
    dir: dirWith(t, text),
  });
  return { code, logs };
}
const ARGV = ["--repo", REPO, "--pr", "7"];

test("authoredLines drops HTML comments, closed or open to the end, CRs and blank lines", () => {
  assert.deepEqual(citation.authoredLines("a\r\n<!-- b -->\n\n  c  \n<!-- d\ne"), ["a", "c"]);
});

test("touches: a bare path is that file or a directory, a trailing slash a directory", () => {
  assert.equal(citation.touches(["src/a.ts"], ["src/a.ts"]), true);
  assert.equal(citation.touches(["src/a.ts/x"], ["src/a.ts"]), true);
  assert.equal(citation.touches(["src/a.tsx", "x/src/a.ts"], ["src/a.ts"]), false);
  assert.equal(citation.touches(["packages/verify/x"], ["packages/verify/"]), true);
  assert.equal(citation.touches(["packages/verify-page/x"], ["packages/verify/"]), false);
});

test("cites: an authored line naming the doc counts; a template line or a comment does not", () => {
  const lines = citation.templateLines([TEMPLATE]);
  assert.equal(citation.cites(`Threat model: ${DOC}`, [DOC], lines), false);
  assert.equal(citation.cites(`<!-- ${DOC} -->`, [DOC], lines), false);
  assert.equal(citation.cites(`Threat model: ${DOC} (row 3 holds)`, [DOC], lines), true);
  assert.equal(citation.cites(`Checked ${OLD_DOC}`, citation.docsOf(SURFACE), lines), true);
});

test("grade lists each touched surface with whether the body cites it", () => {
  const lines = new Set();
  const g = citation.grade([SURFACE, OTHER], {
    body: `see ${DOC}`,
    files: ["packages/verify/a.ts", "web/index.html", "README.md"],
    lines,
  });
  assert.deepEqual(
    g.map((x) => [x.surface.id, x.files, x.cited]),
    [
      ["verifier", ["packages/verify/a.ts"], true],
      ["page", ["web/index.html"], false],
    ],
  );
  assert.deepEqual(citation.docsOf(OTHER), ["docs/page.md"]);
});

test("githubGet reads api.github.com only, with the token, and follows the next link", async () => {
  const next = `${API}/x?page=2`;
  const { fetchImpl, calls } = fake({ "/x": () => res(200, [1], `<${next}>; rel="next"`) });
  const get = pc.githubGet(fetchImpl, "tok");
  assert.deepEqual(await get(`${API}/x`), { json: [1], next });
  assert.equal(calls[0].init.headers.Authorization, "Bearer tok");
  assert.equal(calls[0].init.redirect, "manual");
  await assert.rejects(get("https://example.com/x"), /refusing https:\/\/example.com/);
  await assert.rejects(get("http://api.github.com/x"), /refusing/);
  await assert.rejects(get(`${API}/missing`), /GET \/missing: HTTP 404/);
  const bad = pc.githubGet(async () => res(200, "{not json"), "tok");
  await assert.rejects(bad(`${API}/y`), /body is not JSON/);
  const plain = pc.githubGet(async () => res(200, []), "tok");
  assert.deepEqual(await plain(`${API}/z`), { json: [], next: null });
});

test("pages reads every page, and refuses a non-list page or more than MAX_PAGES", async () => {
  const two = async (url) => (url === "u1" ? { json: [1], next: "u2" } : { json: [2], next: null });
  assert.deepEqual(await pc.pages(two, "u1", "w"), [1, 2]);
  assert.deepEqual(
    await pc.pages(
      async () => ({ json: { a: [3] } }),
      "u",
      "w",
      (j) => j.a,
    ),
    [3],
  );
  await assert.rejects(
    pc.pages(async () => ({ json: {} }), "u", "w"),
    /w: page 1 is not a list/,
  );
  const endless = async () => ({ json: [], next: "again" });
  await assert.rejects(pc.pages(endless, "u", "w"), new RegExp(`more than ${pc.MAX_PAGES} pages`));
});

test("templateLocation matches GitHub's template locations in any case, and nothing else", () => {
  for (const p of [
    ".github/pull_request_template.md",
    "PULL_REQUEST_TEMPLATE.md",
    "docs/Pull_Request_Template.md",
    "pull_request_template",
    ".github/PULL_REQUEST_TEMPLATE/feature.md",
  ])
    assert.equal(pc.templateLocation(p), true, p);
  for (const p of [
    "src/pull_request_template.md",
    ".github/PULL_REQUEST_TEMPLATE/a/b.md",
    "my_pull_request_template.md",
  ])
    assert.equal(pc.templateLocation(p), false, p);
});

test("templatePaths refuses no tree, a truncated tree or a template outside GitHub's places", async () => {
  const get = (json) => async () => ({ json });
  await assert.rejects(pc.templatePaths(get(null), REPO), /tree: no tree/);
  await assert.rejects(pc.templatePaths(get({ tree: {} }), REPO), /tree: no tree/);
  await assert.rejects(pc.templatePaths(get({ truncated: true, tree: [] }), REPO), /truncated/);
  await assert.rejects(
    pc.templatePaths(get({ tree: [{ type: "blob", path: "src/pull_request_template.md" }] }), REPO),
    /outside the locations read/,
  );
  const ok = await pc.templatePaths(
    get({
      tree: [
        null,
        { type: "tree", path: ".github/PULL_REQUEST_TEMPLATE" },
        { type: "blob", path: 7 },
        { type: "blob", path: "docs/pull_request_template.md" },
        { type: "blob", path: ".github/pull_request_template.md" },
        { type: "blob", path: "README.md" },
      ],
    }),
    REPO,
  );
  assert.deepEqual(ok, [".github/pull_request_template.md", "docs/pull_request_template.md"]);
});

test("readTemplates reads every version oldest first, and refuses a bad commit or content", async () => {
  const get = pc.githubGet(fake(routes()).fetchImpl, "t");
  assert.deepEqual(await pc.readTemplates(get, REPO), ["old", TEMPLATE]);
  const noSha = { ...routes(), [commits]: () => res(200, [{}]) };
  await assert.rejects(
    pc.readTemplates(pc.githubGet(fake(noSha).fetchImpl, "t"), REPO),
    /a commit without sha/,
  );
  const raw = { ...routes(), [content("a")]: () => res(200, { encoding: "utf8", content: "x" }) };
  await assert.rejects(
    pc.readTemplates(pc.githubGet(fake(raw).fetchImpl, "t"), REPO),
    /@aaaaaaa: no base64 content/,
  );
  const none = { ...routes(), [content("a")]: () => res(200, null) };
  await assert.rejects(
    pc.readTemplates(pc.githubGet(fake(none).fetchImpl, "t"), REPO),
    /no base64/,
  );
});

test("readPr reads the live body and every changed file; a null body reads as empty", async () => {
  const get = (r) => pc.githubGet(fake(r).fetchImpl, "t");
  assert.deepEqual(await pc.readPr(get(routes({ body: "b" })), REPO, 7), {
    body: "b",
    files: ["packages/verify/src/index.ts"],
  });
  assert.equal((await pc.readPr(get(routes({ body: null })), REPO, 7)).body, "");
  const notPr = { ...routes(), [pull(7)]: () => res(200, { number: 8 }) };
  await assert.rejects(pc.readPr(get(notPr), REPO, 7), /#7: not a pull request/);
  const empty = { ...routes(), [pull(7)]: () => res(200, null) };
  await assert.rejects(pc.readPr(get(empty), REPO, 7), /not a pull request/);
  const noName = { ...routes(), [files(7)]: () => res(200, [{ filename: "a" }, {}]) };
  await assert.rejects(pc.readPr(get(noName), REPO, 7), /a file without filename/);
  const nul = { ...routes(), [files(7)]: () => res(200, [null]) };
  await assert.rejects(pc.readPr(get(nul), REPO, 7), /a file without filename/);
});

test("readPr counts a renamed file under its old name too, so a move off a surface touches it", async () => {
  const moved = [
    {
      filename: "lib/index.ts",
      previous_filename: "packages/verify/src/index.ts",
      status: "renamed",
    },
    { filename: "README.md" },
  ];
  const r = { ...routes(), [files(7)]: () => res(200, moved) };
  assert.deepEqual((await pc.readPr(pc.githubGet(fake(r).fetchImpl, "t"), REPO, 7)).files, [
    "lib/index.ts",
    "packages/verify/src/index.ts",
    "README.md",
  ]);
});

test("loadSurfaces keeps a well-formed file for the repo, and refuses anything else", () => {
  assert.deepEqual(pc.loadSurfaces(SURFACES, REPO), [SURFACE, OTHER]);
  const bad = (surfaces) => JSON.stringify({ repo: REPO, surfaces });
  for (const [text, re] of [
    ["{not json", /is not JSON/],
    ["null", /is not for mnemom\/aip/],
    [JSON.stringify({ repo: "mnemom/other", surfaces: [SURFACE] }), /is not for mnemom\/aip/],
    [JSON.stringify({ repo: REPO }), /not a non-empty list/],
    [bad([]), /not a non-empty list/],
    [bad([null]), /surfaces\[0\] needs/],
    [bad([{ ...SURFACE, id: "" }]), /surfaces\[0\] needs/],
    [bad([{ ...SURFACE, id: 3 }]), /surfaces\[0\] needs/],
    [bad([{ ...SURFACE, doc: "" }]), /surfaces\[0\] needs/],
    [bad([{ ...SURFACE, doc: null }]), /surfaces\[0\] needs/],
    [bad([{ ...SURFACE, former_docs: "x" }]), /surfaces\[0\] needs/],
    [bad([{ ...SURFACE, former_docs: [""] }]), /surfaces\[0\] needs/],
    [bad([{ ...SURFACE, paths: [] }]), /surfaces\[0\] needs/],
    [bad([OTHER, { ...SURFACE, paths: [3] }]), /surfaces\[1\] needs/],
  ])
    assert.throws(() => pc.loadSurfaces(text, REPO), re, text);
});

test("report: no surface touched passes, a cited one passes, an uncited one fails", () => {
  assert.equal(pc.report([]).code, 0);
  assert.match(pc.report([]).lines[0], /touches no threat-model surface/);
  const cited = pc.report([{ surface: SURFACE, files: ["packages/verify/a"], cited: true }]);
  assert.deepEqual(cited, { code: 0, lines: [`cited: ${DOC} (surface verifier)`] });
  const mixed = pc.report([
    { surface: SURFACE, files: ["packages/verify/a"], cited: true },
    { surface: OTHER, files: ["web/index.html"], cited: false },
  ]);
  assert.equal(mixed.code, 1);
  assert.match(mixed.lines[1], /^::error title=Threat model not cited::/);
  assert.match(
    mixed.lines[1],
    /changes web\/index\.html \(surface page\) and its body does not cite docs\/page\.md/,
  );
});

test("report names up to five changed files, then how many more", () => {
  const files = (n) => Array.from({ length: n }, (_, i) => `packages/verify/f${i}`);
  const line = (n) => pc.report([{ surface: SURFACE, files: files(n), cited: false }]).lines[0];
  assert.match(line(5), /changes packages\/verify\/f0, (.*, ){3}packages\/verify\/f4 \(surface/);
  assert.match(line(7), /packages\/verify\/f4 and 2 more \(surface verifier\)/);
  assert.doesNotMatch(line(7), /f5/);
});

test("parseArgv needs --repo owner/name and a positive --pr, and nothing else", () => {
  assert.deepEqual(pc.parseArgv(ARGV), { repo: REPO, pr: 7 });
  assert.throws(() => pc.parseArgv([...ARGV, "--x"]), /unknown argument --x/);
  assert.throws(() => pc.parseArgv(["--pr", "7"]), /--repo owner\/name is required/);
  assert.throws(() => pc.parseArgv(["--repo", "aip", "--pr", "7"]), /--repo owner/);
  for (const n of [[], ["--pr", "0"], ["--pr", "07"], ["--pr", "7a"]])
    assert.throws(() => pc.parseArgv(["--repo", REPO, ...n]), /--pr <number> is required/);
});

test("main passes a PR whose body cites the doc it touches", async (t) => {
  const { code, logs } = await runMain(t, ARGV);
  assert.equal(code, 0);
  assert.deepEqual(logs, [`cited: ${DOC} (surface verifier)`]);
});

test("main fails a PR that leaves the template line as it came, and passes it once edited", async (t) => {
  const kept = await runMain(t, ARGV, { r: routes({ body: TEMPLATE }) });
  assert.equal(kept.code, 1);
  assert.match(kept.logs[0], /surface verifier\) and its body does not cite/);
  const edited = `${TEMPLATE.slice(0, TEMPLATE.lastIndexOf("Threat model:"))}Threat model: ${DOC} (row 6)\n`;
  assert.equal((await runMain(t, ARGV, { r: routes({ body: edited }) })).code, 0);
});

test("main fails a PR that moves a surface file off the surface without a citation", async (t) => {
  const moved = [{ filename: "lib/index.ts", previous_filename: "packages/verify/src/index.ts" }];
  const r = { ...routes({ body: "" }), [files(7)]: () => res(200, moved) };
  const { code, logs } = await runMain(t, ARGV, { r });
  assert.equal(code, 1);
  assert.match(logs[0], /changes packages\/verify\/src\/index\.ts \(surface verifier\)/);
});

test("main passes a PR off every surface without a citation", async (t) => {
  const { code } = await runMain(t, ARGV, { r: routes({ body: "", changed: ["README.md"] }) });
  assert.equal(code, 0);
});

test("main exits 2, never 0, when it cannot check", async (t) => {
  for (const [opts, re] of [
    [{ env: {} }, /GH_TOKEN is unset/],
    [{ text: null }, /ENOENT/],
    [{ r: { ...routes(), [tree]: () => res(500, {}) } }, /HTTP 500/],
  ]) {
    const { code, logs } = await runMain(t, ARGV, opts);
    assert.equal(code, 2);
    assert.match(logs[0], /^::error title=Threat model check could not run::/);
    assert.match(logs[0], re);
  }
  assert.equal((await runMain(t, ["--repo", REPO])).code, 2);
  const thrown = await pc.main(ARGV, {
    env: { GH_TOKEN: "t" },
    fetchImpl: async () => {
      throw "offline";
    },
    log: () => {},
    dir: dirWith(t),
  });
  assert.equal(thrown, 2);
});

test("the CLI sets exit code 2 on a bad argument, before any read", () => {
  const r = spawnSync(process.execPath, [path.join(__dirname, "..", "pr-check.js"), "--nope"], {
    encoding: "utf8",
    env: {},
  });
  assert.equal(r.status, 2);
  assert.match(r.stdout, /could not run::unknown argument --nope/);
});
