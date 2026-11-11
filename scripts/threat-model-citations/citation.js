"use strict";
// gates/threat-model-links/citation.js: when a PR touches a threat-model surface, and when its
// body cites the surface's doc. One copy of these rules serves both graders: the K-L07 gate
// (check.js, on merged PRs) and the PR-time check (pr-check.js, on an open PR).
//
// Vendored byte for byte, with pr-check.js, into scripts/threat-model-citations/ of each repo a
// surface lives in (mnemom/mnemom-api, mnemom/aip). Edit this file here, then copy it there: the
// gate compares each vendored copy with this file and fails a surface whose copy differs.
//
// A surface is { id, doc, former_docs?, paths }. A path ending in "/" is a directory, any other
// path a file or a directory. A citation is the doc path, or a former doc path, on a body line
// the author wrote: text inside an HTML comment is not one, nor is a line that any version of
// the repo's PR template puts in a new body outside its comments.

// The lines a reader sees: HTML comments (closed, or open to the end, as GitHub renders
// them) removed, each line trimmed (which also drops the \r of a CRLF body), blanks dropped.
function authoredLines(text) {
  return text
    .replace(/<!--[\s\S]*?(?:-->|$)/g, "")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l !== "");
}

/** Every line any of the template texts puts in a new PR body. */
const templateLines = (texts) => new Set(texts.flatMap(authoredLines));

/** True when the body cites one of the docs on a line its author wrote. */
const cites = (body, docs, lines) =>
  authoredLines(body).some((l) => !lines.has(l) && docs.some((d) => l.includes(d)));

/** True when the file is one of the paths, or under one of them. */
const under = (f, paths) =>
  paths.some((p) => f === p || f.startsWith(p.endsWith("/") ? p : `${p}/`));

/** True when one of the changed files is one of the paths, or under one of them. */
const touches = (files, paths) => files.some((f) => under(f, paths));

/** The doc paths that cite a surface: its doc, then its former docs. */
const docsOf = (s) => [s.doc, ...(s.former_docs || [])];

/** The surfaces a PR touches, each with the changed files on it and whether its body cites the
 * surface's doc. */
function grade(surfaces, { body, files, lines }) {
  return surfaces
    .map((s) => ({ surface: s, files: files.filter((f) => under(f, s.paths)) }))
    .filter((g) => g.files.length > 0)
    .map((g) => ({ ...g, cited: cites(body, docsOf(g.surface), lines) }));
}

module.exports = { authoredLines, templateLines, cites, touches, docsOf, grade };
