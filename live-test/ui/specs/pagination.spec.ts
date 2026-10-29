import { expect, openHub, rowNames, searchFor, test } from "../fixtures";
import { testTag } from "../../naming";

// Scoped to the current run: the assertions need exactly 30 tags, and a leftover
// run's volume fixtures would otherwise match too.
const volumeQuery = (runId: string): string => testTag(runId, "ui", "vol-");

test("splits a 30-tag result into two pages of 25 and 5", async ({ page, seed }) => {
  await openHub(page);
  await searchFor(page, volumeQuery(seed.runId));

  await expect(page.locator('[data-testid="pagination-status"]')).toHaveText(
    /Page 1 of 2 \(30 tags\)/
  );
  expect(await rowNames(page)).toHaveLength(25);

  await page.getByRole("button", { name: "Next" }).click();

  await expect(page.locator('[data-testid="pagination-status"]')).toHaveText(
    /Page 2 of 2 \(30 tags\)/
  );
  expect(await rowNames(page)).toHaveLength(5);
});

test("Previous returns to the first page", async ({ page, seed }) => {
  await openHub(page);
  await searchFor(page, volumeQuery(seed.runId));

  await page.getByRole("button", { name: "Next" }).click();
  await expect(page.locator('[data-testid="pagination-status"]')).toHaveText(/Page 2 of 2/);

  await page.getByRole("button", { name: "Previous" }).click();
  await expect(page.locator('[data-testid="pagination-status"]')).toHaveText(/Page 1 of 2/);
});

test("Previous is disabled on the first page and Next on the last", async ({ page, seed }) => {
  await openHub(page);
  await searchFor(page, volumeQuery(seed.runId));

  await expect(page.getByRole("button", { name: "Previous" })).toBeDisabled();

  await page.getByRole("button", { name: "Next" }).click();
  await expect(page.getByRole("button", { name: "Next" })).toBeDisabled();
});

test("hides the pager when a filter leaves a single page", async ({ page, seed }) => {
  await openHub(page);
  await searchFor(page, seed.volume[0]);

  await expect(page.locator('[data-testid="pagination"]')).toHaveCount(0);
});
