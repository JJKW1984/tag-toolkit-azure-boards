// live-test/ui/seed.ts
import * as fs from "node:fs";
import * as path from "node:path";
import { AdoClient } from "../adoClient";
import { ManifestStore, RUNS_DIR } from "../manifest";
import { newRunId, testTag } from "../naming";
import { buildContext, cleanupRun } from "../runner";
import { uiConfigFromEnv } from "./hub";

export interface SeedData {
  runId: string;
  manifestPath: string;
  rename: { old: string; new: string };
  merge: { sources: string[]; target: string };
  del: string;
  search: { alpha: string; beta: string };
  volume: string[];
}

export const SEED_FILE = path.join(RUNS_DIR, "ui-seed.json");

/** Pure: decides every name a run will use, with no I/O. */
export function planSeed(runId: string): SeedData {
  const ui = (suffix: string): string => testTag(runId, "ui", suffix);
  return {
    runId,
    manifestPath: path.join(RUNS_DIR, `${runId}.json`),
    rename: { old: ui("rename-old"), new: ui("rename-new") },
    merge: { sources: [ui("merge-a"), ui("merge-b")], target: ui("merge-target") },
    del: ui("delete-a"),
    search: { alpha: ui("search-alpha"), beta: ui("search-beta") },
    volume: Array.from({ length: 30 }, (_, i) => ui(`vol-${String(i).padStart(3, "0")}`)),
  };
}

export function readSeed(): SeedData {
  return JSON.parse(fs.readFileSync(SEED_FILE, "utf8")) as SeedData;
}

/**
 * Creates fixture data through the REST API rather than the UI: the specs are
 * here to test the UI's behavior, not to spend minutes building state through it.
 *
 * Work items are created through `buildContext(...).createWorkItem`, not a raw
 * `client.createWorkItem` call: that is what stamps every title with the
 * live-test provenance marker (see `testWorkItemTitle`). Without the marker, a
 * work item whose only tag is later stripped off it by a UI spec (e.g. the
 * delete-tag spec) would carry neither a marker nor a run-scoped tag, and
 * `cleanupRun`'s `isOwnedWorkItem` check would then refuse to delete it,
 * leaking a plain "Task" work item into the live org forever.
 */
export async function seedFixtures(): Promise<SeedData> {
  const config = uiConfigFromEnv();
  const runId = newRunId(new Date());
  const seed = planSeed(runId);

  const client = new AdoClient({
    orgUrl: config.orgUrl,
    project: config.project,
    pat: config.pat,
  });
  const store = ManifestStore.create(RUNS_DIR, {
    runId,
    org: config.orgUrl,
    project: config.project,
  });
  const ctx = buildContext({ client, store, runId, workItemType: "Task" });

  await ctx.createWorkItem([seed.rename.old], "ui rename #1");
  await ctx.createWorkItem([seed.rename.old], "ui rename #2");
  ctx.recordTag(seed.rename.new); // the rename spec will bring this into existence

  await ctx.createWorkItem([seed.merge.sources[0]], "ui merge a");
  await ctx.createWorkItem([seed.merge.sources[1]], "ui merge b");
  ctx.recordTag(seed.merge.target);

  await ctx.createWorkItem([seed.del], "ui delete #1");
  await ctx.createWorkItem([seed.del], "ui delete #2");

  await ctx.createWorkItem([seed.search.alpha], "ui search alpha");
  await ctx.createWorkItem([seed.search.beta], "ui search beta");

  for (const tag of seed.volume) {
    await ctx.createWorkItem([tag], tag);
  }

  fs.writeFileSync(SEED_FILE, `${JSON.stringify(seed, null, 2)}\n`, "utf8");
  return seed;
}

export async function teardownFixtures(): Promise<void> {
  if (!fs.existsSync(SEED_FILE)) return;
  try {
    const seed = readSeed();
    const config = uiConfigFromEnv();
    const store = ManifestStore.open(seed.manifestPath);
    const client = new AdoClient({
      orgUrl: config.orgUrl,
      project: config.project,
      pat: config.pat,
    });

    await cleanupRun(client, store, (m) => console.log(m));

    if (store.manifest.status !== "cleaned") {
      throw new Error(
        `Live-test UI teardown did not fully clean up: manifest ${seed.manifestPath} is ` +
          `still "${store.manifest.status}". Inspect it and re-run cleanup by hand before ` +
          `trusting the live project's tag/work-item state.`
      );
    }
  } finally {
    // Always drop the seed pointer, even on failure: a failed run must not
    // leave the next suite invocation reading stale, already-deleted names.
    fs.rmSync(SEED_FILE, { force: true });
  }
}
