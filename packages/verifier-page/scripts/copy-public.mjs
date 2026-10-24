// Copy the static shell next to the built script. dist/ is the whole site.
import { cpSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
mkdirSync(resolve(root, "dist"), { recursive: true });
cpSync(resolve(root, "public"), resolve(root, "dist"), { recursive: true });
console.log("copied public/ -> dist/");
