#!/usr/bin/env node
/** results-report build --outcomes <file> --jwks <file> --out <file> */
import { readFileSync, writeFileSync } from "node:fs";
import { readOutcomes } from "./adapter.js";
import { buildReport } from "./build.js";

function arg(name: string): string {
  const i = process.argv.indexOf(`--${name}`);
  const v = i >= 0 ? process.argv[i + 1] : undefined;
  if (!v) throw new Error(`missing --${name}`);
  return v;
}

async function main(): Promise<void> {
  if (process.argv[2] !== "build") throw new Error("usage: results-report build --outcomes F --jwks F --out F");
  const outcomes = await readOutcomes(JSON.parse(readFileSync(arg("outcomes"), "utf8")), JSON.parse(readFileSync(arg("jwks"), "utf8")));
  writeFileSync(arg("out"), buildReport(outcomes).markdown);
}

main().catch((e) => {
  console.error(`results-report: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
