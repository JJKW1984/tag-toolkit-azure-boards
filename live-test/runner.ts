// live-test/runner.ts
import { sanitizeError } from "../src/utils/sanitizeError";
import { isNotFound } from "./errors";
import { ManifestStore } from "./manifest";
import { LIVE_TEST_PREFIX } from "./naming";
import { formatResultLine } from "./report";
import { Ability, AbilityContext, AbilityResult, IAdoClient } from "./types";

export interface ContextDeps {
  client: IAdoClient;
  store: ManifestStore;
  runId: string;
  workItemType: string;
}

export function buildContext(deps: ContextDeps): AbilityContext {
  return {
    client: deps.client,
    runId: deps.runId,
    createWorkItem: async (tags, title) => {
      const id = await deps.client.createWorkItem(
        deps.workItemType,
        title ?? `live test ${deps.runId}`,
        tags
      );
      deps.store.addWorkItem(id);
      for (const tag of tags) deps.store.addTag(tag);
      return id;
    },
    recordTag: (name) => deps.store.addTag(name),
  };
}

export interface RunDeps extends ContextDeps {
  abilities: Ability[];
  log: (message: string) => void;
}

export async function runAbilities(deps: RunDeps): Promise<AbilityResult[]> {
  const ctx = buildContext(deps);
  const results: AbilityResult[] = [];

  for (const ability of deps.abilities) {
    const start = Date.now();
    let result: AbilityResult;
    try {
      result = await ability.run(ctx);
    } catch (e) {
      // Abilities are expected to return failures rather than throw, but a bug
      // in one must never stop the remaining abilities from running.
      result = {
        name: ability.name,
        status: "fail",
        durationMs: Date.now() - start,
        detail: sanitizeError(e),
      };
    }
    results.push(result);
    deps.log(formatResultLine(result));
  }

  return results;
}

/**
 * Best-effort teardown: every work item is soft-deleted and every tag removed.
 * Individual failures are logged and skipped — a 404 on something already gone
 * must not strand the rest of the run's data.
 *
 * The manifest is marked "cleaned" only when every delete succeeded. A run that
 * failed a delete stays "in-progress" so `--cleanup-all` picks it up again;
 * marking it cleaned would make later sweeps skip it and strand the surviving
 * resource in the live project. Re-running cleanup is safe because deleting
 * something already gone is tolerated.
 *
 * Provenance: a tag is deleted only when its name carries LIVE_TEST_PREFIX.
 * `--cleanup <path>` takes an arbitrary path and `--cleanup-all` sweeps a
 * directory, so a stale, hand-edited, misplaced or planted manifest could
 * otherwise name a real production tag and have it deleted without a murmur.
 * A manifest naming a foreign tag is corrupt by definition, so the run is also
 * left in-progress: a human should look before anything reports a clean sweep.
 */
export async function cleanupRun(
  client: IAdoClient,
  store: ManifestStore,
  log: (message: string) => void
): Promise<void> {
  const { workItems, tags } = store.manifest;
  log(`Cleaning up ${workItems.length} work items and ${tags.length} tags…`);
  let unresolved = 0;

  for (const id of workItems) {
    try {
      await client.deleteWorkItem(id);
    } catch (e) {
      // Already gone is the outcome we wanted; anything else may still be alive.
      if (isNotFound(e)) continue;
      unresolved += 1;
      log(`  could not delete work item ${id}: ${sanitizeError(e)}`);
    }
  }

  let foreign = 0;
  for (const tag of tags) {
    if (!tag.startsWith(LIVE_TEST_PREFIX)) {
      foreign += 1;
      log(
        `  REFUSING to delete tag ${JSON.stringify(tag)} — it does not start with ` +
          `"${LIVE_TEST_PREFIX}", so this harness did not create it. Manifest ` +
          `${store.path} is corrupt or was hand-edited; inspect it by hand.`
      );
      continue;
    }
    try {
      await client.deleteTag(tag);
    } catch (e) {
      if (isNotFound(e)) continue;
      unresolved += 1;
      log(`  could not delete tag ${tag}: ${sanitizeError(e)}`);
    }
  }

  if (foreign > 0) {
    log(
      `Cleanup refused: ${foreign} tag(s) in ${store.path} are not live-test tags. ` +
        `Run left in-progress — review the manifest before retrying.`
    );
    return;
  }

  if (unresolved > 0) {
    log(
      `Cleanup incomplete: ${unresolved} deletion(s) failed. Run left in-progress — ` +
        `retry with: pnpm live-test --cleanup ${store.path} --pat <pat>`
    );
    return;
  }

  store.markCleaned();
  log("Cleanup complete.");
}
