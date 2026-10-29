// live-test/ui/globalSetup.ts
import { seedFixtures } from "./seed";

export default async function globalSetup(): Promise<void> {
  const seed = await seedFixtures();
  console.log(`Seeded UI fixtures for run ${seed.runId}`);
}
