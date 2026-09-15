import { testTag } from "../naming";
import { pollUntil } from "../poll";
import { Ability, AbilityContext, AbilityResult } from "../types";
import { PollSettings, timed } from "./support";

const NAME = "Delete tag";

async function run(
  ctx: AbilityContext,
  poll: PollSettings = {}
): Promise<AbilityResult> {
  return timed(NAME, async () => {
    const tag = testTag(ctx.runId, "delete", "a");

    const ids = [
      await ctx.createWorkItem([tag], `${tag} #1`),
      await ctx.createWorkItem([tag], `${tag} #2`),
    ];

    const before = await ctx.client.listTags();
    const target = before.find((t) => t.name === tag);
    if (!target) {
      return { ok: false, detail: `${tag} not found in the tags list` };
    }

    await ctx.client.deleteTag(target.id);

    const listed = await ctx.client.listTags();
    if (listed.some((t) => t.name === tag)) {
      return { ok: false, detail: `${tag} is still present in the tags list after delete` };
    }

    // The cascade onto work items is not guaranteed to be synchronous.
    const cascaded = await pollUntil({
      probe: async () => await ctx.client.getWorkItemTags(ids),
      until: (items) => items.every((wi) => !wi.tags.includes(tag)),
      ...poll,
    });

    if (!cascaded.ok) {
      const stale = cascaded.last.find((wi) => wi.tags.includes(tag));
      return {
        ok: false,
        detail: `work item ${stale?.id} still carries ${tag} after ${cascaded.elapsedMs}ms`,
      };
    }

    return { ok: true, detail: `cascaded off ${ids.length} work items in ${cascaded.elapsedMs}ms` };
  });
}

export const deleteTagAbility: Ability = { name: NAME, run: (ctx) => run(ctx) };

/** Exported for unit tests so the poll budget can be shrunk. */
export const runWithPollSettings = run;
