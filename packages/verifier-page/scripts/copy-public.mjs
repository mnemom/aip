// Copy the static shell next to the built script. The out dir is the whole
// site. In share mode (VERIFIER_PAGE_MODE exactly "true") share.html becomes
// index.html; otherwise the paste verifier's index.html is used.
import { copyFileSync, cpSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = resolve(root, process.env.OUT_DIR ?? "dist");
const share = process.env.VERIFIER_PAGE_MODE === "true";
mkdirSync(out, { recursive: true });
cpSync(resolve(root, "public"), out, {
  recursive: true,
  filter: (src) => !src.endsWith("share.html"),
});
if (share) copyFileSync(resolve(root, "public", "share.html"), resolve(out, "index.html"));
console.log(`copied public/ -> ${out} (${share ? "share" : "paste"} page)`);
