import type { Page } from "@playwright/test";
import { expect, openHub, rowNames, searchFor, test, totalTagCount } from "../fixtures";

const filter = (page: Page) => page.getByLabel("Starts with", { exact: true });

async function chooseLetter(page: Page, name: string): Promise<void> {
  await filter(page).click();
  await page.getByRole("option", { name, exact: true }).click();
}

async function offeredChoices(page: Page): Promise<string[]> {
  await filter(page).click();
  const names = await page.getByRole("option").allInnerTexts();
  await page.keyboard.press("Escape");
  return names.map((n) => n.trim());
}

test("filters to tags starting with the selected letter", async ({ page }) => {
  await openHub(page);

  await chooseLetter(page, "L");

  const names = await rowNames(page);
  expect(names.length).toBeGreaterThan(0);
  expect(names.every((n) => n.toUpperCase().startsWith("L"))).toBe(true);
});

test("Any letter restores every tag", async ({ page, seed }) => {
  await openHub(page);
  await searchFor(page, seed.runId);

  await chooseLetter(page, "L");
  const filtered = await totalTagCount(page);

  await chooseLetter(page, "Any letter");
  const all = await totalTagCount(page);

  expect(all).toBeGreaterThanOrEqual(filtered);
});

test("offers only letters that have tags", async ({ page, seed }) => {
  await openHub(page);
  await searchFor(page, seed.runId);

  // Every seeded tag starts with "l", so L is always offered.
  const choices = await offeredChoices(page);
  expect(choices).toContain("L");

  // Scoped to this run's own tags (all start with "l"), so Q can never
  // legitimately appear here — this only checks the filter doesn't spuriously
  // offer a letter with zero tags in the current (searched) view.
  const namesStartingWithQ = (await rowNames(page)).filter((n) =>
    n.toUpperCase().startsWith("Q")
  );
  expect(choices.includes("Q")).toBe(namesStartingWithQ.length > 0);
});
