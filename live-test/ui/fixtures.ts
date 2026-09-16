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

/** Types into the hub's search box and lets the table settle. */
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
