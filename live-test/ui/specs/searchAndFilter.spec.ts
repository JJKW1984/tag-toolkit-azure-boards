import { expect, openHub, rowFor, rowNames, searchFor, test } from "../fixtures";

test("filters the table to matching tags as you type", async ({ page, seed }) => {
  await openHub(page);
  await searchFor(page, seed.search.alpha);

  await expect(rowFor(page, seed.search.alpha)).toBeVisible();
  await expect(rowFor(page, seed.search.beta)).toHaveCount(0);

  const names = await rowNames(page);
  expect(names.every((n) => n.includes(seed.search.alpha))).toBe(true);
});

test("matches on any part of the tag name, not just the start", async ({ page, seed }) => {
  await openHub(page);
  await searchFor(page, "search-beta");

  await expect(rowFor(page, seed.search.beta)).toBeVisible();
  await expect(rowFor(page, seed.search.alpha)).toHaveCount(0);
});

test("clearing the search restores the unfiltered table", async ({ page, seed }) => {
  await openHub(page);
  await searchFor(page, seed.search.alpha);
  const filtered = (await rowNames(page)).length;

  await page.getByLabel("Clear search").click();
  await expect(rowFor(page, seed.search.alpha)).toBeVisible();

  const restored = (await rowNames(page)).length;
  // Holds as long as the project has more than 1 tag total — trivially true once the harness's own ~39 fixtures are seeded.
  expect(restored).toBeGreaterThan(filtered);
});

test("shows no rows for a query that matches nothing", async ({ page }) => {
  await openHub(page);
  await page.getByLabel("Search tags").fill("livetest-definitely-no-such-tag");

  await expect(page.locator('[data-testid="tag-row"]')).toHaveCount(0);
});
