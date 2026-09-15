// live-test/runner.ts
import { sanitizeError } from "../src/utils/sanitizeError";
import { isNotFound } from "./errors";
import { ManifestStore } from "./manifest";
import { isLiveTestWorkItemTitle, LIVE_TEST_PREFIX, testWorkItemTitle } from "./naming";
import { formatResultLine } from "./report";
import { Ability, AbilityContext, AbilityResult, IAdoClient, WorkItemTags } from "./types";

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
        // Every title carries the live-test marker. This is what lets cleanup
        // prove an id is the harness's own even after every tag has been
        // cascaded off it — see testWorkItemTitle.
        testWorkItemTitle(deps.runId, title ?? "live test work item"),
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
 * Whether a work item read back from the project is one the harness created.
 *
 * Two independent signals, either of which is sufficient. The title marker is
 * the durable one — it is stamped at creation and never rewritten. The tag
 * check is the fallback for an item created before titles were marked. An
 * absent title is not evidence of ownership.
 */
function isOwnedWorkItem(item: WorkItemTags | undefined): boolean {
  if (!item) return false;
  return (
    isLiveTestWorkItemTitle(item.title) ||
    item.tags.some((t) => t.startsWith(LIVE_TEST_PREFIX))
  );
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
 * Provenance: nothing is deleted until it has been shown to belong to this
 * harness. `--cleanup <path>` takes an arbitrary path and `--cleanup-all`
 * sweeps a directory, so a stale, hand-edited, misplaced or planted manifest
 * could otherwise name real production data and have it destroyed without a
 * murmur. A tag qualifies when its name carries LIVE_TEST_PREFIX; a work item
 * qualifies when its title carries the marker, or it still carries a live-test
 * tag. The whole manifest is scanned before the first delete, so a corrupt one
 * is caught while its contents are still intact. A manifest naming anything
 * foreign is corrupt by definition, so the run is also left in-progress: a
 * human should look before anything reports a clean sweep.
 */
export async function cleanupRun(
  client: IAdoClient,
  store: ManifestStore,
  log: (message: string) => void
): Promise<void> {
  const { workItems, tags } = store.manifest;
  log(`Cleaning up ${workItems.length} work items and ${tags.length} tags…`);
  let unresolved = 0;
  let refused = 0;

  // --- Scan phase. Nothing is destroyed here.
  const ownedWorkItems: number[] = [];
  for (const id of workItems) {
    let item;
    try {
      // One id per call, deliberately. getWorkItemTags rejects the whole batch
      // if any id is unknown or already soft-deleted, so batching would make a
      // second cleanup of the same manifest throw instead of being the no-op
      // that re-running cleanup is documented to be.
      [item] = await client.getWorkItemTags([id]);
    } catch (e) {
      // Already gone is the outcome we wanted: not a refusal, not a failure.
      if (isNotFound(e)) continue;
      unresolved += 1;
      log(`  could not read work item ${id} to check provenance: ${sanitizeError(e)}`);
      continue;
    }

    if (!isOwnedWorkItem(item)) {
      refused += 1;
      log(
        `  REFUSING to delete work item ${id} — its title does not carry the ` +
          `"${LIVE_TEST_PREFIX}" marker and it holds no live-test tag, so this ` +
          `harness did not create it. Manifest ${store.path} is corrupt or was ` +
          `hand-edited; inspect it by hand.`
      );
      continue;
    }
    ownedWorkItems.push(id);
  }

  const ownedTags: string[] = [];
  for (const tag of tags) {
    if (!tag.startsWith(LIVE_TEST_PREFIX)) {
      refused += 1;
      log(
        `  REFUSING to delete tag ${sanitizeError(JSON.stringify(tag))} — it does ` +
          `not start with "${LIVE_TEST_PREFIX}", so this harness did not create ` +
          `it. Manifest ${store.path} is corrupt or was hand-edited; inspect it ` +
          `by hand.`
      );
      continue;
    }
    ownedTags.push(tag);
  }

  // --- Delete phase. Only what the scan approved.
  for (const id of ownedWorkItems) {
    try {
      await client.deleteWorkItem(id);
    } catch (e) {
      // Already gone is the outcome we wanted; anything else may still be alive.
      if (isNotFound(e)) continue;
      unresolved += 1;
      log(`  could not delete work item ${id}: ${sanitizeError(e)}`);
    }
  }

  for (const tag of ownedTags) {
    try {
      await client.deleteTag(tag);
    } catch (e) {
      if (isNotFound(e)) continue;
      unresolved += 1;
      log(`  could not delete tag ${tag}: ${sanitizeError(e)}`);
    }
  }

  if (refused > 0) {
    log(
      `Cleanup refused: ${refused} item(s) in ${store.path} do not belong to this ` +
        `harness. Run left in-progress — review the manifest before retrying.`
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
