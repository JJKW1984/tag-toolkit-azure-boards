import { renameTagAbility } from "./renameTag";
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

    const result = await renameTagAbility.run(contextFor(client));

    expect(result.status).toBe("fail");
    expect(result.detail).toContain("not found in the tags list");
  });

  it("fails when a work item still carries the old name", async () => {
    const client = new FakeAdoClient();
    jest.spyOn(client, "renameTag").mockResolvedValue({ id: "1", name: "x", url: "" });

    const result = await renameTagAbility.run(contextFor(client));

    expect(result.status).toBe("fail");
    expect(result.detail).toMatch(/still carries/);
  });

  it("reports a sanitized failure when renaming throws", async () => {
    const client = new FakeAdoClient();
    client.failNext("renameTag", "denied for token=abc123");

    const result = await renameTagAbility.run(contextFor(client));

    expect(result.status).toBe("fail");
    expect(result.detail).not.toContain("abc123");
  });
});
