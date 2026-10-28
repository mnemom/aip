#!/usr/bin/env node
/**
 * results-report build --outcomes <file> --jwks <file> --out <file>
 * results-report build --record-rows <file> --out <file>   (unsigned record-app rows, C3 shape)
 */
import { readFileSync, writeFileSync } from "node:fs";
import { readOutcomes, readRecordRows } from "./adapter.js";
import { buildReport } from "./build.js";

function arg(name: string): string {
  const i = process.argv.indexOf(`--${name}`);
  const v = i >= 0 ? process.argv[i + 1] : undefined;
  if (!v) throw new Error(`missing --${name}`);
  return v;
}

async function main(): Promise<void> {
  if (process.argv[2] !== "build") throw new Error("usage: results-report build (--outcomes F --jwks F | --record-rows F) --out F");
  if (process.argv.includes("--record-rows")) {
    writeFileSync(arg("out"), buildReport(readRecordRows(JSON.parse(readFileSync(arg("record-rows"), "utf8")))).markdown);
    return;
  }
  const outcomes = await readOutcomes(JSON.parse(readFileSync(arg("outcomes"), "utf8")), JSON.parse(readFileSync(arg("jwks"), "utf8")));
  writeFileSync(arg("out"), buildReport(outcomes).markdown);
}

main().catch((e) => {
  console.error(`results-report: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
