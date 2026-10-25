import { pagingVolumeAbility, VOLUME_TAG_COUNT } from "./pagingVolume";
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

describe("pagingVolume ability", () => {
  it("passes when every generated tag comes back from the list endpoint", async () => {
    const result = await pagingVolumeAbility.run(contextFor(new FakeAdoClient()));
    expect(result).toMatchObject({ name: "Paging/volume (30 tags)", status: "pass" });
  });

  it("creates the full volume of tags", async () => {
    const client = new FakeAdoClient();
    await pagingVolumeAbility.run(contextFor(client));
    const created = client.tagNames().filter((n) => n.startsWith("livetest-r1-vol-"));
    expect(created).toHaveLength(VOLUME_TAG_COUNT);
  });

  it("zero-pads tag suffixes so ordering is stable", async () => {
    const client = new FakeAdoClient();
    await pagingVolumeAbility.run(contextFor(client));
    expect(client.tagNames()).toContain("livetest-r1-vol-000");
    expect(client.tagNames()).toContain("livetest-r1-vol-029");
  });

  it("fails and names the missing tags when the list is incomplete", async () => {
    const client = new FakeAdoClient();
    jest.spyOn(client, "listTags").mockResolvedValue([
      { id: "1", name: "livetest-r1-vol-000", url: "" },
    ]);

    const result = await pagingVolumeAbility.run(contextFor(client));

    expect(result.status).toBe("fail");
    expect(result.detail).toMatch(/29 of 30/);
    expect(result.detail).toContain("livetest-r1-vol-001");
  });

  it("reports a sanitized failure when listing throws", async () => {
    const client = new FakeAdoClient();
    client.failNext("listTags", "list failed at https://dev.azure.com/o");

    const result = await pagingVolumeAbility.run(contextFor(client));

    expect(result.status).toBe("fail");
    expect(result.detail).not.toContain("https://dev.azure.com");
  });
});
