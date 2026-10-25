import { listTagsAndCountsAbility, runWithPollSettings } from "./listTagsAndCounts";
import { FAST_POLL_FOR_TESTS } from "./support";
import { FakeAdoClient } from "../test/fakeAdoClient";
import { AbilityContext } from "../types";

function contextFor(client: FakeAdoClient): AbilityContext & { tags: string[] } {
  const tags: string[] = [];
  return {
    client,
    runId: "r1",
    tags,
    createWorkItem: async (tagNames) => {
      tagNames.forEach((t) => tags.push(t));
      return client.createWorkItem("Task", "live test", tagNames);
    },
    recordTag: (name) => tags.push(name),
  };
}

describe("listTagsAndCounts ability", () => {
  it("passes when the tag is listed and Analytics agrees on the count", async () => {
    const ctx = contextFor(new FakeAdoClient());

    const result = await listTagsAndCountsAbility.run(ctx);

    expect(result.status).toBe("pass");
    expect(result.name).toBe("List tags + counts");
  });

  it("creates exactly three work items under a run-scoped tag", async () => {
    const client = new FakeAdoClient();
    const ctx = contextFor(client);

    await listTagsAndCountsAbility.run(ctx);

    expect(await client.countWorkItemsWithTag("livetest-r1-count-a")).toBe(3);
  });

  it("records every created tag so cleanup can find it", async () => {
    const ctx = contextFor(new FakeAdoClient());
    await listTagsAndCountsAbility.run(ctx);
    expect(ctx.tags).toContain("livetest-r1-count-a");
  });

  it("fails when the tag never appears in the tags list", async () => {
    const client = new FakeAdoClient();
    jest.spyOn(client, "listTags").mockResolvedValue([]);
    const ctx = contextFor(client);

    const result = await runWithPollSettings(ctx, FAST_POLL_FOR_TESTS);

    expect(result.status).toBe("fail");
    expect(result.detail).toContain("not returned by the tags list");
  });

  it("fails when the Analytics count never reaches the expected value", async () => {
    const client = new FakeAdoClient();
    jest.spyOn(client, "countWorkItemsWithTag").mockResolvedValue(1);
    const ctx = contextFor(client);

    const result = await runWithPollSettings(ctx, FAST_POLL_FOR_TESTS);

    expect(result.status).toBe("fail");
    expect(result.detail).toMatch(/expected 3/);
  });

  it("reports a sanitized failure when the client throws", async () => {
    const client = new FakeAdoClient();
    client.failNext("listTags", "boom at https://dev.azure.com/o");
    const ctx = contextFor(client);

    const result = await runWithPollSettings(ctx, FAST_POLL_FOR_TESTS);

    expect(result.status).toBe("fail");
    expect(result.detail).not.toContain("https://dev.azure.com");
  });
});
