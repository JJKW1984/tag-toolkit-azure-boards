import { testTag } from "../naming";
import { Ability, AbilityContext, AbilityResult } from "../types";
import { timed } from "./support";

const NAME = "Rename tag";

async function run(ctx: AbilityContext): Promise<AbilityResult> {
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

    const after = await ctx.client.getWorkItemTags(ids);
    const stale = after.find((wi) => wi.tags.includes(oldName));
    if (stale) {
      return { ok: false, detail: `work item ${stale.id} still carries ${oldName}` };
    }

    const missing = after.find((wi) => !wi.tags.includes(newName));
    if (missing) {
      return { ok: false, detail: `work item ${missing.id} did not receive ${newName}` };
    }

    const listed = await ctx.client.listTags();
    if (listed.some((t) => t.name === oldName)) {
      return { ok: false, detail: `${oldName} is still present in the tags list` };
    }

    return { ok: true, detail: `renamed across ${ids.length} work items` };
  });
}

export const renameTagAbility: Ability = { name: NAME, run };
