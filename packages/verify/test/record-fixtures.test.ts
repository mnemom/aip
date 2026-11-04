/**
 * The committed fixtures under test/fixtures/record are a deterministic
 * build. This test rebuilds them and fails on drift. Set
 * RECORD_FIXTURES=write (npm run fixtures) to rewrite them instead.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { buildFixtures } from "./helpers/build-fixtures.js";

const here = dirname(fileURLToPath(import.meta.url));
export const FIXTURE_DIR = resolve(here, "fixtures/record");
const WRITE = process.env.RECORD_FIXTURES === "write";

describe("record fixtures", () => {
  it("committed fixtures match a fresh deterministic build", async () => {
    const built = await buildFixtures();
    mkdirSync(FIXTURE_DIR, { recursive: true });
    for (const [name, value] of Object.entries(built)) {
      const path = resolve(FIXTURE_DIR, `${name}.json`);
      const text = JSON.stringify(value, null, 2) + "\n";
      if (WRITE || !existsSync(path)) writeFileSync(path, text);
      expect(readFileSync(path, "utf8"), `${name}.json drifted; run npm run fixtures`).toBe(text);
    }
  });
});
