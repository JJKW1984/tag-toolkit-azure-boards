import { renameTagAbility, runWithPollSettings } from "./renameTag";
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

describe("renameTag ability", () => {
  it("passes when the rename propagates to every work item", async () => {
    const result = await renameTagAbility.run(contextFor(new FakeAdoClient()));
    expect(result).toMatchObject({ name: "Rename tag", status: "pass" });
  });

  it("leaves the new name on both work items and the old name nowhere", async () => {
    const client = new FakeAdoClient();
    await renameTagAbility.run(contextFor(client));

    expect(client.tagNames()).toContain("livetest-r1-rename-new");
    expect(client.tagNames()).not.toContain("livetest-r1-rename-old");
    expect(await client.countWorkItemsWithTag("livetest-r1-rename-new")).toBe(2);
  });

  it("records the post-rename name so cleanup deletes it", async () => {
    const ctx = contextFor(new FakeAdoClient());
    await renameTagAbility.run(ctx);
    expect(ctx.tags).toContain("livetest-r1-rename-new");
  });

  it("fails when the tag cannot be found after creating the work items", async () => {
    const client = new FakeAdoClient();
    jest.spyOn(client, "listTags").mockResolvedValue([]);

    const result = await runWithPollSettings(contextFor(client), FAST_POLL_FOR_TESTS);

    expect(result.status).toBe("fail");
    expect(result.detail).toContain("not found in the tags list");
  });

  it("fails when a work item still carries the old name", async () => {
    const client = new FakeAdoClient();
    jest.spyOn(client, "renameTag").mockResolvedValue({ id: "1", name: "x", url: "" });

    const result = await runWithPollSettings(contextFor(client), FAST_POLL_FOR_TESTS);

    expect(result.status).toBe("fail");
    expect(result.detail).toMatch(/still carries/);
  });

  it("reports a sanitized failure when renaming throws", async () => {
    const client = new FakeAdoClient();
    client.failNext("renameTag", "denied for token=abc123");

    const result = await runWithPollSettings(contextFor(client), FAST_POLL_FOR_TESTS);

    expect(result.status).toBe("fail");
    expect(result.detail).not.toContain("abc123");
  });

  it("fails when a work item did not receive the new name", async () => {
    const client = new FakeAdoClient();
    jest.spyOn(client, "getWorkItemTags").mockResolvedValue([
      { id: 1, tags: ["unrelated"] },
      { id: 2, tags: ["unrelated"] },
    ]);

    const result = await runWithPollSettings(contextFor(client), FAST_POLL_FOR_TESTS);

    expect(result.status).toBe("fail");
    expect(result.detail).toMatch(/did not receive/);
    expect(result.detail).toMatch(/[12]/); // names a work item id
  });

  it("fails when the old name is still present in the tags list after rename", async () => {
    const client = new FakeAdoClient();
    const oldName = "livetest-r1-rename-old";

    // Mock renameTag to succeed without actually changing the fake's state
    jest.spyOn(client, "renameTag").mockResolvedValue({ id: "1", name: "livetest-r1-rename-new", url: "" });

    // Mock getWorkItemTags to show items now have the new name (pass per-item check)
    jest.spyOn(client, "getWorkItemTags").mockResolvedValue([
      { id: 1, tags: ["livetest-r1-rename-new"] },
      { id: 2, tags: ["livetest-r1-rename-new"] },
    ]);

    // Mock listTags: first call is real, second call still has old name
    const realListTags = client.listTags.bind(client);
    let listTagsCallCount = 0;
    jest.spyOn(client, "listTags").mockImplementation(async () => {
      listTagsCallCount++;
      if (listTagsCallCount === 1) {
        // First call: real implementation
        return realListTags();
      } else {
        // Second call: mock the old tag still being there
        const tags = await realListTags();
        return tags.concat([{ id: "stale", name: oldName, url: "" }]);
      }
    });

    const result = await runWithPollSettings(contextFor(client), FAST_POLL_FOR_TESTS);

    expect(result.status).toBe("fail");
    expect(result.detail).toMatch(/still present in the tags list/);
  });
});
