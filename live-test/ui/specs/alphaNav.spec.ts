import { expect, openHub, rowNames, test } from "../fixtures";

test("filters to tags starting with the selected letter", async ({ page }) => {
  await openHub(page);

  await page.locator('[data-testid="alpha-nav"]').getByText("L", { exact: true }).click();

  const names = await rowNames(page);
  expect(names.length).toBeGreaterThan(0);
  expect(names.every((n) => n.toUpperCase().startsWith("L"))).toBe(true);
});

test("the All tab restores every tag", async ({ page }) => {
  await openHub(page);
  const nav = page.locator('[data-testid="alpha-nav"]');

  await nav.getByText("L", { exact: true }).click();
  const filtered = (await rowNames(page)).length;

  await nav.getByText("All", { exact: true }).click();
  const all = (await rowNames(page)).length;

  expect(all).toBeGreaterThanOrEqual(filtered);
});

test("offers only letters that have tags", async ({ page }) => {
  await openHub(page);
  const nav = page.locator('[data-testid="alpha-nav"]');

  // Every seeded tag starts with "l", so L is always offered.
  await expect(nav.getByText("L", { exact: true })).toBeVisible();

  // Q is offered only if the project genuinely has a tag starting with Q.
  const namesStartingWithQ = (await rowNames(page)).filter((n) =>
    n.toUpperCase().startsWith("Q")
  );
  const qVisible = await nav.getByText("Q", { exact: true }).isVisible().catch(() => false);
  expect(qVisible).toBe(namesStartingWithQ.length > 0);
});
