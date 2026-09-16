import { deleteTagAbility, runWithPollSettings } from "./deleteTag";
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

describe("deleteTag ability", () => {
  it("passes when the tag is gone and cascaded off every work item", async () => {
    const result = await deleteTagAbility.run(contextFor(new FakeAdoClient()));
    expect(result).toMatchObject({ name: "Delete tag", status: "pass" });
  });

  it("leaves no work item carrying the deleted tag", async () => {
    const client = new FakeAdoClient();
    await deleteTagAbility.run(contextFor(client));
    expect(await client.countWorkItemsWithTag("livetest-r1-delete-a")).toBe(0);
  });

  it("fails when the tag is still listed after deletion", async () => {
    const client = new FakeAdoClient();
    jest.spyOn(client, "deleteTag").mockResolvedValue(undefined);

    const result = await runWithPollSettings(contextFor(client), FAST_POLL_FOR_TESTS);

    expect(result.status).toBe("fail");
    expect(result.detail).toMatch(/still present in the tags list/);
  });

  it("fails when the cascade never reaches the work items", async () => {
    const client = new FakeAdoClient();
    // deleteTag behaves normally (so the tag leaves the list), but the work
    // items are reported as still carrying it — the cascade never lands.
    jest.spyOn(client, "getWorkItemTags").mockResolvedValue([
      { id: 100, tags: ["livetest-r1-delete-a"] },
    ]);

    const result = await runWithPollSettings(contextFor(client), FAST_POLL_FOR_TESTS);

    expect(result.status).toBe("fail");
    expect(result.detail).toMatch(/still carries/);
  });

  it("fails when the tag cannot be found before deletion", async () => {
    const client = new FakeAdoClient();
    jest.spyOn(client, "listTags").mockResolvedValue([]);

    const result = await runWithPollSettings(contextFor(client), FAST_POLL_FOR_TESTS);

    expect(result.status).toBe("fail");
    expect(result.detail).toContain("not found in the tags list");
  });

  it("reports a sanitized failure when deleting throws", async () => {
    const client = new FakeAdoClient();
    client.failNext("deleteTag", "denied, pat=abc123");

    const result = await runWithPollSettings(contextFor(client), FAST_POLL_FOR_TESTS);

    expect(result.status).toBe("fail");
    expect(result.detail).not.toContain("abc123");
  });
});
