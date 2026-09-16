import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./specs",
  // These specs mutate one shared project's tags — they must not race.
  fullyParallel: false,
  workers: 1,
  retries: 0,
  // Generous: every action round-trips to a live Azure DevOps page.
  timeout: 120_000,
  expect: { timeout: 15_000 },
  globalSetup: require.resolve("./globalSetup"),
  globalTeardown: require.resolve("./globalTeardown"),
  reporter: [["list"], ["html", { outputFolder: "../../playwright-report", open: "never" }]],
});
