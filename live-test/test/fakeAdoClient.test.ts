// live-test/test/fakeAdoClient.test.ts
import { FakeAdoClient } from "./fakeAdoClient";

describe("FakeAdoClient tag registry", () => {
  it("registers tags when a work item is created with them", async () => {
    const c = new FakeAdoClient();
    await c.createWorkItem("Task", "t", ["a", "b"]);
    expect(c.tagNames().sort()).toEqual(["a", "b"]);
  });

  it("assigns increasing work item ids", async () => {
    const c = new FakeAdoClient();
    const first = await c.createWorkItem("Task", "t", []);
    const second = await c.createWorkItem("Task", "t", []);
    expect(second).toBeGreaterThan(first);
  });

  it("keeps a tag registered after the last work item drops it", async () => {
    const c = new FakeAdoClient();
    const id = await c.createWorkItem("Task", "t", ["a"]);
    await c.setWorkItemTags(id, []);
    expect(c.tagNames()).toEqual(["a"]);
  });
});

describe("FakeAdoClient delete cascade", () => {
  it("removes a deleted tag from every work item carrying it", async () => {
    const c = new FakeAdoClient();
    const one = await c.createWorkItem("Task", "t", ["a", "keep"]);
    const two = await c.createWorkItem("Task", "t", ["a"]);
    const tag = (await c.listTags()).find((t) => t.name === "a");

    await c.deleteTag(tag!.id);

    expect(c.tagsOf(one)).toEqual(["keep"]);
    expect(c.tagsOf(two)).toEqual([]);
    expect(c.tagNames()).toEqual(["keep"]);
  });

  it("throws on deleting a tag that does not exist", async () => {
    const c = new FakeAdoClient();
    await expect(c.deleteTag("missing")).rejects.toThrow(/404/);
  });
});

describe("FakeAdoClient rename", () => {
  it("rewrites the tag on every work item", async () => {
    const c = new FakeAdoClient();
    const id = await c.createWorkItem("Task", "t", ["old"]);
    const tag = (await c.listTags()).find((t) => t.name === "old");

    await c.renameTag(tag!.id, "new");

    expect(c.tagsOf(id)).toEqual(["new"]);
    expect(c.tagNames()).toEqual(["new"]);
  });
});

describe("FakeAdoClient queries", () => {
  it("counts work items carrying a tag", async () => {
    const c = new FakeAdoClient();
    await c.createWorkItem("Task", "t", ["a"]);
    await c.createWorkItem("Task", "t", ["a"]);
    await c.createWorkItem("Task", "t", ["b"]);

    expect(await c.countWorkItemsWithTag("a")).toBe(2);
  });

  it("returns ids of work items carrying a tag", async () => {
    const c = new FakeAdoClient();
    const one = await c.createWorkItem("Task", "t", ["a"]);
    await c.createWorkItem("Task", "t", ["b"]);

    expect(await c.queryWorkItemIdsByTag("a")).toEqual([one]);
  });

  it("excludes deleted work items from counts", async () => {
    const c = new FakeAdoClient();
    const id = await c.createWorkItem("Task", "t", ["a"]);
    await c.deleteWorkItem(id);
    expect(await c.countWorkItemsWithTag("a")).toBe(0);
  });

  it("reads tags for a batch of ids", async () => {
    const c = new FakeAdoClient();
    const one = await c.createWorkItem("Task", "t", ["a"]);
    const two = await c.createWorkItem("Task", "t", ["b"]);

    expect(await c.getWorkItemTags([one, two])).toEqual([
      { id: one, tags: ["a"] },
      { id: two, tags: ["b"] },
    ]);
  });
});

describe("FakeAdoClient failure injection", () => {
  it("fails the next call to a chosen method, then recovers", async () => {
    const c = new FakeAdoClient();
    c.failNext("listTags", "boom");

    await expect(c.listTags()).rejects.toThrow("boom");
    await expect(c.listTags()).resolves.toEqual([]);
  });
});
