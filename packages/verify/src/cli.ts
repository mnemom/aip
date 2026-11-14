/**
 * Threat model: packages/verify-page/THREAT-MODEL.md
 *
 * Entry point of the `mnemom-verify` bin (`npx @mnemom/verify <bundle>`).
 * tsup adds the `#!/usr/bin/env node` line. The command lives in cli-run.ts.
 */

import { processIo, runCli, terminalSafe } from "./cli-run.js";

runCli(process.argv.slice(2), processIo()).then(
  (code) => {
    process.exitCode = code;
  },
  (e: unknown) => {
    process.stderr.write(`mnemom-verify: ${terminalSafe(e instanceof Error ? e.message : String(e))}\n`);
    process.exitCode = 2;
  },
);
