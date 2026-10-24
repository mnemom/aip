import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/cli.ts"],
  format: ["esm"],
  clean: true,
  splitting: false,
  target: "node18",
  // Bundle the verifier so the CLI runs with no node_modules at rebuild time.
  noExternal: [/.*/],
});
