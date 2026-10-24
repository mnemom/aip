import { defineConfig } from "tsup";

// One classic script, no module graph: the page then loads from file://,
// from any static host, and from a browser with the network blocked.
export default defineConfig({
  entry: { app: "src/app.ts" },
  format: ["iife"],
  globalName: "AipVerifierPage",
  platform: "browser",
  target: "es2022",
  outDir: "dist",
  clean: true,
  minify: false,
  sourcemap: false,
  splitting: false,
  treeshake: true,
  noExternal: [/.*/],
  outExtension: () => ({ js: ".js" }),
});
