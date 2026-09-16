// live-test/ui/globalTeardown.ts
import { teardownFixtures } from "./seed";

export default async function globalTeardown(): Promise<void> {
  await teardownFixtures();
}
