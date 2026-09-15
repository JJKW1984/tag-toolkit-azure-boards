import { testTag } from "../naming";
import { Ability, AbilityContext, AbilityResult } from "../types";
import { timed } from "./support";

const NAME = "Paging/volume (30 tags)";

/** Enough tags to exceed the UI's 25-per-page size. */
export const VOLUME_TAG_COUNT = 30;

async function run(ctx: AbilityContext): Promise<AbilityResult> {
  return timed(NAME, async () => {
    const names = Array.from({ length: VOLUME_TAG_COUNT }, (_, i) =>
      testTag(ctx.runId, "vol", String(i).padStart(3, "0"))
    );

    for (const name of names) {
      await ctx.createWorkItem([name], name);
    }

    const listed = new Set((await ctx.client.listTags()).map((t) => t.name));
    const missing = names.filter((n) => !listed.has(n));

    if (missing.length > 0) {
      return {
        ok: false,
        detail: `${missing.length} of ${VOLUME_TAG_COUNT} tags missing from the list: ${missing
          .slice(0, 3)
          .join(", ")}${missing.length > 3 ? "…" : ""}`,
      };
    }

    return { ok: true, detail: `${VOLUME_TAG_COUNT} tags listed correctly` };
  });
}

export const pagingVolumeAbility: Ability = { name: NAME, run };
