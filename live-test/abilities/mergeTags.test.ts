import { mergeTagsAbility } from "./mergeTags";
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

const TARGET = "livetest-r1-merge-target";
const SOURCES = [
  "livetest-r1-merge-a",
  "livetest-r1-merge-b",
  "livetest-r1-merge-c",
];

describe("mergeTags ability", () => {
  it("passes against a client with correct merge semantics", async () => {
    const result = await mergeTagsAbility.run(contextFor(new FakeAdoClient()));
    expect(result).toMatchObject({ name: "Merge tags (3->1)", status: "pass" });
  });

  it("removes every source tag from the project", async () => {
    const client = new FakeAdoClient();
    await mergeTagsAbility.run(contextFor(client));

    for (const source of SOURCES) {
      expect(client.tagNames()).not.toContain(source);
    }
    expect(client.tagNames()).toContain(TARGET);
  });

  it("moves all four work items onto the target tag", async () => {
    const client = new FakeAdoClient();
    await mergeTagsAbility.run(contextFor(client));
    expect(await client.countWorkItemsWithTag(TARGET)).toBe(4);
  });

  it("does not duplicate the target on a work item that already had it", async () => {
    const client = new FakeAdoClient();
    await mergeTagsAbility.run(contextFor(client));

    const ids = await client.queryWorkItemIdsByTag(TARGET);
    for (const id of ids) {
      const occurrences = client.tagsOf(id).filter((t) => t === TARGET).length;
      expect(occurrences).toBe(1);
    }
  });

  it("fails when a source tag survives the merge", async () => {
    const client = new FakeAdoClient();
    jest.spyOn(client, "deleteTag").mockResolvedValue(undefined);

    const result = await mergeTagsAbility.run(contextFor(client));

    expect(result.status).toBe("fail");
    // With delete stubbed out the work items still carry the source, which the
    // ability reports before it reaches the tag-list check.
    expect(result.detail).toMatch(/still carries/);
  });

  it("fails when a work item never receives the target tag", async () => {
    const client = new FakeAdoClient();
    jest.spyOn(client, "setWorkItemTags").mockResolvedValue(undefined);

    const result = await mergeTagsAbility.run(contextFor(client));

    expect(result.status).toBe("fail");
    expect(result.detail).toMatch(/did not receive/);
  });

  it("reports a sanitized failure when the client throws", async () => {
    const client = new FakeAdoClient();
    client.failNext("queryWorkItemIdsByTag", "wiql blew up at https://dev.azure.com/o");

    const result = await mergeTagsAbility.run(contextFor(client));

    expect(result.status).toBe("fail");
    expect(result.detail).not.toContain("https://dev.azure.com");
  });
});
