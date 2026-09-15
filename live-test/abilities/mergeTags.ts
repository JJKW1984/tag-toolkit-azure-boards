import { testTag } from "../naming";
import { Ability, AbilityContext, AbilityResult } from "../types";
import { timed } from "./support";

const NAME = "Merge tags (3->1)";

async function run(ctx: AbilityContext): Promise<AbilityResult> {
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

    // Phase 1 — additive across every source, nothing removed yet.
    for (const source of sources) {
      const candidates = await ctx.client.queryWorkItemIdsByTag(source);
      const current = await ctx.client.getWorkItemTags(candidates);
      for (const item of current) {
        if (!item.tags.includes(source)) continue; // WIQL CONTAINS is substring-ish
        if (item.tags.includes(target)) continue;
        await ctx.client.setWorkItemTags(item.id, [...item.tags, target]);
      }
    }

    // Phase 2 — delete sources; ADO cascades each off its work items.
    const listed = await ctx.client.listTags();
    for (const source of sources) {
      const tag = listed.find((t) => t.name === source);
      if (!tag) {
        return { ok: false, detail: `${source} disappeared before it could be deleted` };
      }
      await ctx.client.deleteTag(tag.id);
    }

    const after = await ctx.client.getWorkItemTags(ids);
    for (const item of after) {
      const occurrences = item.tags.filter((t) => t === target).length;
      if (occurrences === 0) {
        return { ok: false, detail: `work item ${item.id} did not receive ${target}` };
      }
      if (occurrences > 1) {
        return { ok: false, detail: `work item ${item.id} carries ${target} ${occurrences} times` };
      }
      const leftover = item.tags.find((t) => sources.includes(t));
      if (leftover) {
        return { ok: false, detail: `work item ${item.id} still carries ${leftover}` };
      }
    }

    const finalTags = (await ctx.client.listTags()).map((t) => t.name);
    const survivor = sources.find((s) => finalTags.includes(s));
    if (survivor) {
      return { ok: false, detail: `${survivor} is still present in the tags list` };
    }
    if (!finalTags.includes(target)) {
      return { ok: false, detail: `${target} is missing from the tags list` };
    }

    return { ok: true, detail: `3 sources merged into ${target} across ${ids.length} work items` };
  });
}

export const mergeTagsAbility: Ability = { name: NAME, run };
