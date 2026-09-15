import { testTag } from "../naming";
import { pollUntil } from "../poll";
import { Ability, AbilityContext, AbilityResult } from "../types";
import { PollSettings, timed } from "./support";

const NAME = "List tags + counts";
const EXPECTED = 3;

async function run(
  ctx: AbilityContext,
  poll: PollSettings = {}
): Promise<AbilityResult> {
  return timed(NAME, async () => {
    const tag = testTag(ctx.runId, "count", "a");

    for (let i = 0; i < EXPECTED; i += 1) {
      await ctx.createWorkItem([tag], `${tag} #${i + 1}`);
    }

    const tags = await ctx.client.listTags();
    if (!tags.some((t) => t.name === tag)) {
      return { ok: false, detail: `${tag} was not returned by the tags list` };
    }

    const counted = await pollUntil({
      probe: () => ctx.client.countWorkItemsWithTag(tag),
      until: (c) => c === EXPECTED,
      ...poll,
    });

    if (!counted.ok) {
      return {
        ok: false,
        detail: `Analytics count was ${counted.last} after ${counted.elapsedMs}ms, expected ${EXPECTED}`,
      };
    }

    return {
      ok: true,
      detail: `${EXPECTED} work items; Analytics agreed after ${counted.elapsedMs}ms`,
    };
  });
}

export const listTagsAndCountsAbility: Ability = { name: NAME, run: (ctx) => run(ctx) };

/** Exported for unit tests so the poll budget can be shrunk. */
export const runWithPollSettings = run;
