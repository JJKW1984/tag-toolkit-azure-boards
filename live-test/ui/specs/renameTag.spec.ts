import { expect, openHub, rowFor, searchFor, test } from "../fixtures";
import { testTag } from "../../naming";

test("renames a tag inline and shows the new name in the table", async ({ page, seed }) => {
  await openHub(page);
  // Search on a substring stable across the rename ("-ui-rename-" is shared by
  // both seed.rename.old and seed.rename.new) so the row stays visible
  // through the rename instead of falling out of a stale filter.
  await searchFor(page, "-ui-rename-");

  await expect(rowFor(page, seed.rename.old)).toBeVisible();

  await page.getByLabel(`Rename tag ${seed.rename.old}`).dblclick();
  const input = page.getByLabel("Edit tag name");
  await input.fill(seed.rename.new);
  await input.press("Enter");

  // The table re-sorts and re-renders from the service response.
  await expect(rowFor(page, seed.rename.new)).toBeVisible({ timeout: 30_000 });
  await expect(rowFor(page, seed.rename.old)).toHaveCount(0);
});

test("abandons a rename when the edit is cancelled", async ({ page, seed }) => {
  await openHub(page);
  // The first test already renamed it, so work against the post-rename name.
  await searchFor(page, seed.rename.new);

  await page.getByLabel(`Rename tag ${seed.rename.new}`).dblclick();
  const input = page.getByLabel("Edit tag name");
  const canary = testTag(seed.runId, "ui", "should-never-exist");
  await input.fill(canary);
  await input.press("Escape");

  await expect(rowFor(page, seed.rename.new)).toBeVisible();
  await expect(rowFor(page, canary)).toHaveCount(0);
});
