// live-test/ui/fixtures.ts
import * as path from "node:path";
import { expect, Locator, Page, test as base } from "@playwright/test";
import { assertSignedIn, launchProfileContext } from "./auth";
import { hubUrl, readHubContribution, uiConfigFromEnv } from "./hub";
import { readSeed, SeedData } from "./seed";

const DEV_MANIFEST = path.resolve(process.cwd(), "vss-extension-dev.json");

export const test = base.extend<{ page: Page; seed: SeedData }>({
  // eslint-disable-next-line no-empty-pattern
  page: async ({}, use) => {
    const context = await launchProfileContext();
    const page = context.pages()[0] ?? (await context.newPage());
    await use(page);
    await context.close();
  },
  // eslint-disable-next-line no-empty-pattern
  seed: async ({}, use) => {
    await use(readSeed());
  },
});

export { expect };

/** Navigates to the installed dev extension's hub and waits for it to render. */
export async function openHub(page: Page): Promise<void> {
  const config = uiConfigFromEnv();
  const ids = readHubContribution(DEV_MANIFEST);
  await page.goto(hubUrl(config.orgUrl, config.project, ids));
  await assertSignedIn(page);
  await page.waitForSelector('[data-testid="tag-manager"]', { timeout: 60_000 });
  // The hub loads tags asynchronously; the first row is the signal it is ready.
  await page.waitForSelector('[data-testid="tag-row"]', { timeout: 60_000 });
}

/**
 * Types into the hub's search box and lets the table settle.
 * Asserts at least one row becomes visible — do not use this for a query
 * expected to match zero rows (fill the search box directly instead), and do
 * not call it a second time after an action that could have removed the very
 * row you searched for (delete, or a rename that changes the matched text).
 */
export async function searchFor(page: Page, text: string): Promise<void> {
  const box = page.getByLabel("Search tags");
  await box.fill(text);
  await expect(page.locator('[data-testid="tag-row"]').first()).toBeVisible();
}

export function rowFor(page: Page, tagName: string): Locator {
  return page.locator(`[data-testid="tag-row"][data-tag-name="${tagName}"]`);
}

export async function rowNames(page: Page): Promise<string[]> {
  return page
    .locator('[data-testid="tag-row"]')
    .evaluateAll((els) => els.map((e) => e.getAttribute("data-tag-name") ?? ""));
}

/**
 * The true total tag count for the current filter, even when it spans more
 * than one page — rowNames() alone only sees the current page's rows.
 */
export async function totalTagCount(page: Page): Promise<number> {
  const status = page.locator('[data-testid="pagination-status"]');
  if ((await status.count()) > 0) {
    const text = (await status.textContent()) ?? "";
    const match = text.match(/\((\d+) tags?\)/);
    if (match) return Number(match[1]);
  }
  return (await rowNames(page)).length;
}
