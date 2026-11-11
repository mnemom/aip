"use strict";
// This repo's surfaces.json, the copy of its surfaces in mnemom/deploy
// registry/threshold-registry.json (gates.threat-model-links.surfaces). The deploy gate fails a
// surface whose copy differs from the registry. This test checks the copy against this repo:
// it loads as the PR-time check loads it, its doc is here, and one of its paths is here.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { loadSurfaces } = require("../pr-check.js");

const ROOT = path.join(__dirname, "..", "..", "..");
const text = fs.readFileSync(path.join(__dirname, "..", "surfaces.json"), "utf8");
const { repo } = JSON.parse(text);

test("surfaces.json loads as the PR-time check reads it", () => {
  assert.ok(loadSurfaces(text, repo).length > 0);
});

test("each surface's doc is in this repo, and at least one of its paths is", () => {
  for (const s of loadSurfaces(text, repo)) {
    assert.ok(fs.existsSync(path.join(ROOT, s.doc)), `${s.id}: ${s.doc}`);
    assert.ok(
      s.paths.some((p) => fs.existsSync(path.join(ROOT, p))),
      `${s.id}: none of ${s.paths.join(", ")}`,
    );
  }
});
