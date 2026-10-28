import { readFileSync } from "node:fs";
import { defineConfig } from "tsup";

import { isShareMode } from "./src/mode.js";

// One classic script, no module graph: the page then loads from file://,
// from any static host, and from a browser with the network blocked.
//
// VERIFIER_PAGE_MODE=true builds the share page (src/share.ts, fragment card
// only); anything else builds the paste verifier (src/app.ts). OUT_DIR picks
// the output folder so both can be built side by side for the tests.
// VERIFIER_PAGE_TEST_JWKS (a file path) swaps the baked-in key set for a test
// key set. It exists so CI can verify cards signed by the fixture key; the
// deployable build never sets it, and CI greps dist/ to prove that.
const share = isShareMode(process.env.VERIFIER_PAGE_MODE);
const testJwksFile = process.env.VERIFIER_PAGE_TEST_JWKS;

export default defineConfig({
  entry: { app: share ? "src/share.ts" : "src/app.ts" },
  format: ["iife"],
  globalName: "AipVerifierPage",
  platform: "browser",
  target: "es2022",
  outDir: process.env.OUT_DIR ?? "dist",
  clean: true,
  minify: false,
  sourcemap: false,
  splitting: false,
  treeshake: true,
  noExternal: [/.*/],
  define: {
    __TEST_JWKS__: testJwksFile ? readFileSync(testJwksFile, "utf8").trim() : "null",
  },
  outExtension: () => ({ js: ".js" }),
});
