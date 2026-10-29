import { testTag } from "../naming";
import { pollUntil } from "../poll";
import { Ability, AbilityContext, AbilityResult } from "../types";
import { PollSettings, timed } from "./support";

const NAME = "Rename tag";

async function run(
  ctx: AbilityContext,
  poll: PollSettings = {}
): Promise<AbilityResult> {
  return timed(NAME, async () => {
    const oldName = testTag(ctx.runId, "rename", "old");
    const newName = testTag(ctx.runId, "rename", "new");

    const ids = [
      await ctx.createWorkItem([oldName], `${oldName} #1`),
      await ctx.createWorkItem([oldName], `${oldName} #2`),
    ];

    const before = await ctx.client.listTags();
    const target = before.find((t) => t.name === oldName);
    if (!target) {
      return { ok: false, detail: `${oldName} not found in the tags list` };
    }

    // Record before renaming: if the rename succeeds and a later step throws,
    // cleanup still has to know about the new name.
    ctx.recordTag(newName);
    await ctx.client.renameTag(target.id, newName);

    // The rewrite onto each work item is not guaranteed to have landed by the
    // time the PATCH returns — the same asynchrony deleteTag polls for. Reading
    // back once would flake on a real org while the identical delete path passes.
    const propagated = await pollUntil({
      probe: async () => await ctx.client.getWorkItemTags(ids),
      until: (items) =>
        items.every((wi) => !wi.tags.includes(oldName) && wi.tags.includes(newName)),
      ...poll,
    });

    if (!propagated.ok) {
      const stale = propagated.last.find((wi) => wi.tags.includes(oldName));
      if (stale) {
        return {
          ok: false,
          detail: `work item ${stale.id} still carries ${oldName} after ${propagated.elapsedMs}ms`,
        };
      }
      const missing = propagated.last.find((wi) => !wi.tags.includes(newName));
      return {
        ok: false,
        detail: `work item ${missing?.id} did not receive ${newName} after ${propagated.elapsedMs}ms`,
      };
    }

    const delisted = await pollUntil({
      probe: async () => await ctx.client.listTags(),
      until: (listed) => !listed.some((t) => t.name === oldName),
      ...poll,
    });

    if (!delisted.ok) {
      return {
        ok: false,
        detail: `${oldName} is still present in the tags list after ${delisted.elapsedMs}ms`,
      };
    }

    return { ok: true, detail: `renamed across ${ids.length} work items` };
  });
}

export const renameTagAbility: Ability = { name: NAME, run: (ctx) => run(ctx) };

/** Exported for unit tests so the poll budget can be shrunk. */
export const runWithPollSettings = run;
