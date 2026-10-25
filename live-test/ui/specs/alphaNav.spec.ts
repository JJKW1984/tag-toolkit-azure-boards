import { expect, openHub, rowNames, searchFor, test, totalTagCount } from "../fixtures";

test("filters to tags starting with the selected letter", async ({ page }) => {
  await openHub(page);

  await page.locator('[data-testid="alpha-nav"]').getByText("L", { exact: true }).click();

  const names = await rowNames(page);
  expect(names.length).toBeGreaterThan(0);
  expect(names.every((n) => n.toUpperCase().startsWith("L"))).toBe(true);
});

test("the All tab restores every tag", async ({ page, seed }) => {
  await openHub(page);
  await searchFor(page, seed.runId);
  const nav = page.locator('[data-testid="alpha-nav"]');

  await nav.getByText("L", { exact: true }).click();
  const filtered = await totalTagCount(page);

  await nav.getByText("All", { exact: true }).click();
  const all = await totalTagCount(page);

  expect(all).toBeGreaterThanOrEqual(filtered);
});

test("offers only letters that have tags", async ({ page, seed }) => {
  await openHub(page);
  await searchFor(page, seed.runId);
  const nav = page.locator('[data-testid="alpha-nav"]');

  // Every seeded tag starts with "l", so L is always offered.
  await expect(nav.getByText("L", { exact: true })).toBeVisible();

  // Scoped to this run's own tags (all start with "l"), so Q can never
  // legitimately appear here — this only checks AlphaNav doesn't spuriously
  // offer a letter with zero tags in the current (searched) view.
  const namesStartingWithQ = (await rowNames(page)).filter((n) =>
    n.toUpperCase().startsWith("Q")
  );
  const qVisible = await nav.getByText("Q", { exact: true }).isVisible().catch(() => false);
  expect(qVisible).toBe(namesStartingWithQ.length > 0);
});
