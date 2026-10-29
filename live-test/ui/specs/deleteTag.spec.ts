import { expect, openHub, rowFor, searchFor, test } from "../fixtures";

test("deletes a selected tag after confirming the dialog", async ({ page, seed }) => {
  await openHub(page);
  await searchFor(page, seed.del);
  await expect(rowFor(page, seed.del)).toBeVisible();

  await page.getByRole("checkbox").nth(1).click();
  await page.getByRole("button", { name: /^Delete/ }).first().click();

  const dialog = page.locator('[data-testid="delete-dialog"]');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(seed.del);

  await page.getByRole("button", { name: /^Delete \d+ tags?$/ }).click();

  await expect(dialog).toBeHidden({ timeout: 60_000 });
  await expect(rowFor(page, seed.del)).toHaveCount(0);
});

test("cancelling the delete dialog keeps the tag", async ({ page, seed }) => {
  await openHub(page);
  await searchFor(page, seed.search.alpha);

  await page.getByRole("checkbox").nth(1).click();
  await page.getByRole("button", { name: /^Delete/ }).first().click();

  const dialog = page.locator('[data-testid="delete-dialog"]');
  await expect(dialog).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();

  await expect(dialog).toBeHidden();
  await expect(rowFor(page, seed.search.alpha)).toBeVisible();
});
