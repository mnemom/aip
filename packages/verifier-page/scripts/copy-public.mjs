// Copy the static shell next to the built script. The out dir is the whole
// site. In share mode (VERIFIER_PAGE_MODE exactly "true") share.html becomes
// index.html; otherwise the paste verifier's index.html is used.
import { cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
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
if (share) {
  // Crawlers need an absolute og:image / twitter:image. Build-time only; it is
  // a generic image URL, never card data. Override with SHARE_OG_IMAGE_URL.
  const ogImage = process.env.SHARE_OG_IMAGE_URL || "https://www.mnemom.ai/share/preview.png";
  const u = new URL(ogImage);
  if (u.protocol !== "https:" || u.search || u.hash) {
    throw new Error(`SHARE_OG_IMAGE_URL must be an absolute https URL with no query or fragment: ${ogImage}`);
  }
  const html = readFileSync(resolve(root, "public", "share.html"), "utf8").replaceAll("%%OG_IMAGE_URL%%", u.href);
  writeFileSync(resolve(out, "index.html"), html);
}
console.log(`copied public/ -> ${out} (${share ? "share" : "paste"} page)`);
