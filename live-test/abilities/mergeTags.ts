import { testTag } from "../naming";
import { pollUntil } from "../poll";
import { Ability, AbilityContext, AbilityResult } from "../types";
import { PollSettings, timed } from "./support";

const NAME = "Merge tags (3->1)";

async function run(
  ctx: AbilityContext,
  poll: PollSettings = {}
): Promise<AbilityResult> {
  return timed(NAME, async () => {
    const a = testTag(ctx.runId, "merge", "a");
    const b = testTag(ctx.runId, "merge", "b");
    const c = testTag(ctx.runId, "merge", "c");
    const target = testTag(ctx.runId, "merge", "target");
    const sources = [a, b, c];

    const ids = [
      await ctx.createWorkItem([a], `${a} only`),
      await ctx.createWorkItem([a, b], `${a} and ${b}`),
      await ctx.createWorkItem([c], `${c} only`),
      // Already carries the target — proves the merge does not duplicate it.
      await ctx.createWorkItem([c, target], `${c} and target`),
    ];
    ctx.recordTag(target);
    // Phase 1 writes to ids that came out of a WIQL query, not out of the
    // manifest. A true-positive match on a work item this run did not create
    // would be mutated and never recorded, so cleanup could not undo it. Only
    // ids this ability created are ever written to, and a query returning
    // anything else aborts before the first write.
    const owned = new Set(ids);

    // Read and validate every source first, nothing written yet.
    const pendingUpdates = new Map<number, string[]>();
    for (const source of sources) {
      const candidates = await ctx.client.queryWorkItemIdsByTag(source);
      const foreign = candidates.filter((id) => !owned.has(id));
      if (foreign.length > 0) {
        return {
          ok: false,
          detail:
            `query for ${source} returned work item(s) ${foreign.join(", ")} that this ` +
            `run did not create — refusing to modify work items the harness does not own`,
        };
      }
      const current = await ctx.client.getWorkItemTags(
        candidates.filter((id) => owned.has(id))
      );
      for (const item of current) {
        if (!item.tags.includes(source)) continue; // WIQL CONTAINS is substring-ish
        const remaining = item.tags.filter((tag) => !sources.includes(tag));
        pendingUpdates.set(item.id, remaining.includes(target) ? remaining : [...remaining, target]);
      }
    }

    for (const [id, tags] of pendingUpdates) {
      await ctx.client.setWorkItemTags(id, tags);
    }

    const settled = await pollUntil({
      probe: async () => await ctx.client.getWorkItemTags(ids),
      until: (items) =>
        items.every(
          (item) =>
            item.tags.filter((t) => t === target).length === 1 &&
            !item.tags.some((t) => sources.includes(t))
        ),
      ...poll,
    });

    for (const item of settled.last) {
      const occurrences = item.tags.filter((t) => t === target).length;
      if (occurrences === 0) {
        return {
          ok: false,
          detail: `work item ${item.id} did not receive ${target} after ${settled.elapsedMs}ms`,
        };
      }
      if (occurrences > 1) {
        return { ok: false, detail: `work item ${item.id} carries ${target} ${occurrences} times` };
      }
      const leftover = item.tags.find((t) => sources.includes(t));
      if (leftover) {
        return {
          ok: false,
          detail: `work item ${item.id} still carries ${leftover} after ${settled.elapsedMs}ms`,
        };
      }
    }

    const finalTags = (await ctx.client.listTags()).map((tag) => tag.name);
    if (!finalTags.includes(target)) {
      return { ok: false, detail: `${target} is missing from the tags list` };
    }

    return { ok: true, detail: `3 sources merged into ${target} across ${ids.length} work items` };
  });
}

export const mergeTagsAbility: Ability = { name: NAME, run: (ctx) => run(ctx) };

/** Exported for unit tests so the poll budget can be shrunk. */
export const runWithPollSettings = run;
