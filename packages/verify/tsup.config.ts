import { defineConfig } from "tsup";

// Two builds into one dist/. `npm run build` empties dist/ first, so neither
// build cleans (two concurrent cleans could delete the other build's output).
export default defineConfig([
  {
    entry: ["src/index.ts", "src/render-lines.ts"],
    format: ["cjs", "esm"],
    dts: true,
    clean: false,
    sourcemap: true,
    splitting: false,
    treeshake: true,
    target: "es2022",
  },
  {
    // The `mnemom-verify` bin: ESM only, no types, self-contained.
    entry: ["src/cli.ts"],
    format: ["esm"],
    dts: false,
    clean: false,
    sourcemap: true,
    splitting: false,
    treeshake: true,
    target: "es2022",
    platform: "node",
    banner: { js: "#!/usr/bin/env node" },
  },
]);
