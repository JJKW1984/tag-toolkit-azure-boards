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

export async function verifyRunReport(page: Page, action: "merge" | "rename" | "delete"): Promise<void> {
  await page.getByRole("button", { name: "View latest run" }).click();
  const report = page.getByRole("region", { name: "Run report" });
  await expect(report).toBeVisible();
  await expect(report).toContainText("completed");
  await expect(report).toContainText(action === "merge" ? "confirmed" : "observed");
  await expect(report.getByRole("link")).toHaveCount(2);
  const heading = await report.getByRole("heading", { level: 3 }).innerText();
  const runId = heading.match(/run ([a-f0-9]{32})$/)?.[1];
  if (!runId) throw new Error("Report did not expose a run ID");
  const downloadPromise = page.waitForEvent("download");
  await report.getByRole("button", { name: "Export run to CSV" }).click();
  const download = await downloadPromise;
  const stream = await download.createReadStream();
  if (!stream) throw new Error("Run CSV was not readable");
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  const csv = Buffer.concat(chunks).toString("utf8");
  expect(csv).toContain(runId);
  expect(csv).toContain('"Card ID"');
  expect(csv).toContain(action === "merge" ? "confirmed" : "observed");
  if (action === "delete") expect(csv).toContain("Pull-request effects are not enumerated.");
  await openHub(page);
  await page.getByRole("button", { name: "Run history", exact: true }).click();
  await page.getByRole("button", { name: new RegExp(`Open ${action} run .*${runId}`) }).click();
  await expect(page.getByRole("region", { name: "Run report" })).toContainText(runId);
  await expect(page.getByRole("region", { name: "Run report" }).getByRole("link")).toHaveCount(2);
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
