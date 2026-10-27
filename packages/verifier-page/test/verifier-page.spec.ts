/**
 * K4.2: the verifier page checks a real bundle offline.
 *
 * The page is opened from file:// in a context with `offline: true`, and
 * every request that is not file:// is aborted and counted. The golden
 * bundle from packages/verifier must verify, every tampered fixture must
 * fail with its named reason, and the request counter must stay at zero.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { pathToFileURL } from "node:url";
import { expect, test, type Page } from "@playwright/test";

const here = dirname(fileURLToPath(import.meta.url));
const dist = resolve(here, "..", "dist");
const fixtures = resolve(here, "..", "..", "verifier", "test", "fixtures", "record");
const pageUrl = pathToFileURL(resolve(dist, "index.html")).href;

const read = (name: string) => readFileSync(resolve(fixtures, name), "utf8");
const goldenBundle = read("golden-bundle.json");
const goldenConduct = read("golden-conduct.json");
const jwks = read("jwks.json");
const tampered = JSON.parse(read("tampered.json")) as Array<{ name: string; reason: string; input: unknown }>;

async function open(page: Page): Promise<{ networkRequests: string[] }> {
  const networkRequests: string[] = [];
  await page.route("**/*", (route) => {
    const url = route.request().url();
    if (url.startsWith("file://")) return route.continue();
    networkRequests.push(url);
    return route.abort("internetdisconnected");
  });
  await page.goto(pageUrl);
  await expect(page.locator("#verify")).toBeVisible();
  // The embedded key snapshot is prefilled; the fixtures are signed by the
  // test key, so point the page at the fixture JWKS.
  await page.fill("#jwks", jwks);
  return { networkRequests };
}

async function verifyText(page: Page, text: string) {
  await page.fill("#input", text);
  await page.click("#verify");
  await expect(page.locator("#verdict")).toBeVisible();
}

test("golden bundle verifies with the network blocked", async ({ page }) => {
  const { networkRequests } = await open(page);
  await verifyText(page, goldenBundle);
  await expect(page.locator("#verdict")).toHaveText("Verified");
  await expect(page.locator("#result")).toHaveAttribute("data-valid", "true");
  const bundle = JSON.parse(goldenBundle) as { statements: unknown[] };
  await expect(page.locator("#statements tr[data-index]")).toHaveCount(bundle.statements.length);
  await expect(page.locator("#reasons")).toHaveCount(0);
  expect(networkRequests).toEqual([]);
});

test("a single golden statement verifies", async ({ page }) => {
  const { networkRequests } = await open(page);
  await verifyText(page, goldenConduct);
  await expect(page.locator("#verdict")).toHaveText("Verified");
  await expect(page.locator("#statements tr[data-index]")).toHaveCount(1);
  expect(networkRequests).toEqual([]);
});

for (const tcase of tampered) {
  test(`tampered fixture ${tcase.name} fails with ${tcase.reason}`, async ({ page }) => {
    const { networkRequests } = await open(page);
    await verifyText(page, JSON.stringify(tcase.input));
    await expect(page.locator("#verdict")).toHaveText("Not verified");
    await expect(page.locator("#result")).toHaveAttribute("data-valid", "false");
    await expect(page.locator(`#reasons li:has(code:text-is("${tcase.reason}"))`)).toHaveCount(1);
    expect(networkRequests).toEqual([]);
  });
}

test("a signature by a key outside the pasted key set is refused", async ({ page }) => {
  const { networkRequests } = await open(page);
  // Published Mnemom keys only: the fixture key is not among them.
  await page.goto(pageUrl);
  await verifyText(page, goldenBundle);
  await expect(page.locator("#verdict")).toHaveText("Not verified");
  await expect(page.locator("#reasons li[data-reason=key_not_found]").first()).toBeVisible();
  expect(networkRequests).toEqual([]);
});

test("malformed input is reported without verifying", async ({ page }) => {
  const { networkRequests } = await open(page);
  await verifyText(page, "{ not json");
  await expect(page.locator("#result")).toHaveAttribute("data-valid", "error");
  await expect(page.locator("#verdict")).toContainText("not valid JSON");
  expect(networkRequests).toEqual([]);
});

test("a page without crypto.subtle says so instead of failing every signature", async ({ page }) => {
  // Browsers expose crypto.subtle only in secure contexts (https, localhost,
  // file://). Served over plain http:// it is undefined, and the Ed25519
  // check would throw and read as signature_invalid. Simulate that context.
  await page.addInitScript(() => {
    Object.defineProperty(globalThis.crypto, "subtle", { get: () => undefined });
  });
  const { networkRequests } = await open(page);
  await verifyText(page, goldenBundle);
  await expect(page.locator("#result")).toHaveAttribute("data-valid", "error");
  await expect(page.locator("#verdict")).toContainText("secure context");
  await expect(page.locator("#reasons")).toHaveCount(0);
  expect(networkRequests).toEqual([]);
});
