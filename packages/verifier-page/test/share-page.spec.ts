/**
 * C5-R8: the share page verifies a card in the browser with the network off.
 *
 * dist-share/ is built with VERIFIER_PAGE_MODE=true and the fixture key set
 * (npm run build:share). The card travels in the URL fragment. Every
 * non-file request is aborted and counted; the count must stay zero.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { expect, test, type Page } from "@playwright/test";

import { isShareMode } from "../src/mode.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const fixtures = resolve(root, "..", "verifier", "test", "fixtures", "record");
const shareUrl = pathToFileURL(resolve(root, "dist-share", "index.html")).href;
const pasteUrl = pathToFileURL(resolve(root, "dist", "index.html")).href;

const cardText = readFileSync(resolve(fixtures, "golden-share-card.json"), "utf8");
const card = JSON.parse(cardText) as { lines: Array<{ text: string }> };
const b64url = (s: string) => Buffer.from(s, "utf8").toString("base64url");

async function blocked(page: Page): Promise<string[]> {
  const requests: string[] = [];
  await page.route("**/*", (route) => {
    const url = route.request().url();
    if (url.startsWith("file://")) return route.continue();
    requests.push(url);
    return route.abort("internetdisconnected");
  });
  return requests;
}

test("VERIFIER_PAGE_MODE is on only for exactly \"true\"", () => {
  expect(isShareMode("true")).toBe(true);
  for (const v of [undefined, "", "TRUE", "True", "1", "yes", " true", "true ", "false"]) {
    expect(isShareMode(v)).toBe(false);
  }
});

test("a signed card in the fragment verifies offline and shows only the verifier's lines", async ({ page }) => {
  const requests = await blocked(page);
  await page.goto(`${shareUrl}#card=${b64url(cardText)}`);
  await expect(page.locator("#status")).toHaveText("Verified offline");
  const items = page.locator("#card-lines li");
  await expect(items).toHaveCount(card.lines.length);
  for (let i = 0; i < card.lines.length; i++) {
    await expect(items.nth(i)).toContainText(card.lines[i]!.text);
  }
  // The coverage line is a fixed template over the two integers returned.
  await expect(items.nth(1)).toContainText("6 of 12 judged");
  // Inside the card, nothing but the title, chip and the lines is drawn.
  const body = (await page.locator("#card").innerText()).replace(/\s+/g, " ");
  let rest = body;
  for (const l of card.lines) rest = rest.replace(l.text, "");
  rest = rest.replace("6 of 12 judged", "");
  expect(rest).not.toMatch(/\d/);
  // "Accepted, no revert in 7 days" is a clean outcome, not a revert.
  await expect(page.locator("#card-lines li.revert")).toHaveCount(0);
  expect(requests).toEqual([]);
});

test("a tampered card shows no card text and no verified chip", async ({ page }) => {
  const requests = await blocked(page);
  const tampered = JSON.parse(cardText) as { lines: Array<{ text: string }> };
  tampered.lines[0]!.text = "4 of 4 commits from recorded sessions";
  await page.goto(`${shareUrl}#card=${b64url(JSON.stringify(tampered))}`);
  await expect(page.locator("#message")).toContainText("could not be verified");
  await expect(page.locator("#message")).toContainText("signature_invalid");
  await expect(page.locator("#card-lines")).toBeHidden();
  await expect(page.locator("#status")).toBeHidden();
  expect(await page.locator("body").innerText()).not.toContain("commits from recorded sessions");
  expect(requests).toEqual([]);
});

test("a card with an extra field is refused even when otherwise intact", async ({ page }) => {
  const requests = await blocked(page);
  const extra = { ...JSON.parse(cardText), repo: "acme/secret" };
  await page.goto(`${shareUrl}#card=${b64url(JSON.stringify(extra))}`);
  await expect(page.locator("#message")).toContainText("could not be verified");
  expect(await page.locator("body").innerText()).not.toContain("acme/secret");
  await expect(page.locator("#card-lines")).toBeHidden();
  expect(requests).toEqual([]);
});

test("a fragment that is not a card is unreadable; no fragment says so", async ({ page }) => {
  const requests = await blocked(page);
  await page.goto(`${shareUrl}#card=not*base64`);
  await expect(page.locator("#message")).toContainText("could not be read");
  await page.goto(`${shareUrl}#card=${b64url("{ not json")}`);
  await page.reload();
  await expect(page.locator("#message")).toContainText("could not be read");
  await page.goto(`${shareUrl}#`);
  await page.reload();
  await expect(page.locator("#message")).toContainText("no card in it");
  expect(requests).toEqual([]);
});

test("the card is only ever in the fragment: the page request carries none of it", async ({ page }) => {
  // Chromium strips the fragment before any request, so a request URL that
  // contained card text would mean the page itself built one.
  const seen: string[] = [];
  page.on("request", (r) => seen.push(r.url()));
  await blocked(page);
  await page.goto(`${shareUrl}#card=${b64url(cardText)}`);
  await expect(page.locator("#status")).toHaveText("Verified offline");
  for (const u of seen) expect(u).not.toContain("card=");
});

test("the preview image is generic: no numbers in the tags or the image source", async ({ page }) => {
  await blocked(page);
  await page.goto(shareUrl);
  const meta = async (sel: string) => (await page.locator(sel).getAttribute("content")) ?? "";
  for (const sel of ['meta[property="og:image"]', 'meta[name="twitter:image"]']) {
    const url = new URL(await meta(sel)); // throws if relative
    expect(url.protocol).toBe("https:");
    expect(url.search + url.hash).toBe("");
    expect(url.pathname).not.toMatch(/\d/);
  }
  expect(await meta('meta[property="og:image"]')).toBe("https://www.mnemom.ai/share/preview.png");
  for (const sel of ['meta[property="og:title"]', 'meta[property="og:description"]', 'meta[property="og:image:alt"]', 'meta[name="description"]']) {
    expect(await meta(sel)).not.toMatch(/\d/);
  }
  const svg = readFileSync(resolve(root, "dist-share", "preview.svg"), "utf8");
  const texts = [...svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]).join(" ");
  expect(texts.length).toBeGreaterThan(0);
  expect(texts).not.toMatch(/\d/);
});

test("with the mode off, the fragment is ignored and the paste verifier shows", async ({ page }) => {
  const requests = await blocked(page);
  await page.goto(`${pasteUrl}#card=${b64url(cardText)}`);
  await expect(page.locator("#verify")).toBeVisible();
  await expect(page.locator("#card-lines")).toHaveCount(0);
  expect(requests).toEqual([]);
});
