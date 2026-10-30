import { expect, openHub, rowFor, searchFor, test, verifyRunReport } from "../fixtures";
import { testTag } from "../../naming";

test("merges two selected tags into a target tag", async ({ page, seed }) => {
  await openHub(page);
  // Scoped to this run: the checkboxes below are picked by position, so a
  // leftover run's merge tags in the result would also be selected and changed.
  const mergeQuery = testTag(seed.runId, "ui", "merge-");
  await searchFor(page, mergeQuery);

  // Select both source tags via their row checkboxes.
  for (const source of seed.merge.sources) {
    await expect(rowFor(page, source)).toBeVisible();
  }
  const checkboxes = page.getByRole("checkbox");
  await checkboxes.nth(1).click(); // nth(0) is the select-all header checkbox
  await checkboxes.nth(2).click();

  await page.getByRole("button", { name: /^Merge/ }).click();
  const dialog = page.locator('[data-testid="merge-dialog"]');
  await expect(dialog).toBeVisible();

  await dialog.getByRole("combobox", { name: "Tag to keep" }).fill(seed.merge.target);
  await page.getByRole("button", { name: /^Merge/ }).last().click();

  await expect(dialog).toBeHidden({ timeout: 60_000 });

  await searchFor(page, mergeQuery);
  await expect(rowFor(page, seed.merge.target)).toBeVisible({ timeout: 30_000 });
  for (const source of seed.merge.sources) {
    await expect(rowFor(page, source)).toBeVisible();
  }
  await verifyRunReport(page, "merge");
});

test("cancelling the merge dialog changes nothing", async ({ page, seed }) => {
  await openHub(page);
  await searchFor(page, seed.merge.target);

  await page.getByRole("checkbox").nth(1).click();
  await page.getByRole("button", { name: /^Merge/ }).click();

  const dialog = page.locator('[data-testid="merge-dialog"]');
  await expect(dialog).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();

  await expect(dialog).toBeHidden();
  await expect(rowFor(page, seed.merge.target)).toBeVisible();
});
