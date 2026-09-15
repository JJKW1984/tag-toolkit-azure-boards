// live-test/runner.test.ts
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { buildContext, cleanupRun, runAbilities } from "./runner";
import { ManifestStore } from "./manifest";
import { FakeAdoClient } from "./test/fakeAdoClient";
import { ALL_ABILITIES } from "./abilities";
import { Ability } from "./types";

function newStore(): ManifestStore {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "live-test-runner-"));
  return ManifestStore.create(dir, { runId: "r1", org: "o", project: "p" });
}

const passing = (name: string): Ability => ({
  name,
  run: async () => ({ name, status: "pass", durationMs: 1 }),
});

const failing = (name: string): Ability => ({
  name,
  run: async () => ({ name, status: "fail", durationMs: 1, detail: "nope" }),
});

const throwing = (name: string): Ability => ({
  name,
  run: async () => {
    throw new Error("unhandled at https://dev.azure.com/o");
  },
});

describe("buildContext", () => {
  it("records created work items and their tags in the manifest", async () => {
    const client = new FakeAdoClient();
    const store = newStore();
    const ctx = buildContext({ client, store, runId: "r1", workItemType: "Task" });

    const id = await ctx.createWorkItem(["livetest-r1-x-a"]);

    expect(store.manifest.workItems).toEqual([id]);
    expect(store.manifest.tags).toEqual(["livetest-r1-x-a"]);
  });

  it("creates work items of the configured type", async () => {
    const client = new FakeAdoClient();
    const spy = jest.spyOn(client, "createWorkItem");
    const ctx = buildContext({
      client,
      store: newStore(),
      runId: "r1",
      workItemType: "Issue",
    });

    await ctx.createWorkItem(["t"]);

    expect(spy.mock.calls[0][0]).toBe("Issue");
  });

  it("records a tag registered without a work item", () => {
    const store = newStore();
    const ctx = buildContext({
      client: new FakeAdoClient(),
      store,
      runId: "r1",
      workItemType: "Task",
    });

    ctx.recordTag("livetest-r1-rename-new");

    expect(store.manifest.tags).toEqual(["livetest-r1-rename-new"]);
  });
});

describe("runAbilities", () => {
  it("runs every ability in order and returns a result each", async () => {
    const results = await runAbilities({
      client: new FakeAdoClient(),
      store: newStore(),
      runId: "r1",
      workItemType: "Task",
      abilities: [passing("one"), passing("two")],
      log: () => undefined,
    });

    expect(results.map((r) => r.name)).toEqual(["one", "two"]);
  });

  it("continues past a failing ability", async () => {
    const results = await runAbilities({
      client: new FakeAdoClient(),
      store: newStore(),
      runId: "r1",
      workItemType: "Task",
      abilities: [failing("one"), passing("two")],
      log: () => undefined,
    });

    expect(results.map((r) => r.status)).toEqual(["fail", "pass"]);
  });

  it("converts an ability that throws into a sanitized failure and keeps going", async () => {
    const results = await runAbilities({
      client: new FakeAdoClient(),
      store: newStore(),
      runId: "r1",
      workItemType: "Task",
      abilities: [throwing("one"), passing("two")],
      log: () => undefined,
    });

    expect(results[0].status).toBe("fail");
    expect(results[0].detail).not.toContain("https://dev.azure.com");
    expect(results[1].status).toBe("pass");
  });

  it("logs a line per ability as it completes", async () => {
    const lines: string[] = [];
    await runAbilities({
      client: new FakeAdoClient(),
      store: newStore(),
      runId: "r1",
      workItemType: "Task",
      abilities: [passing("one")],
      log: (m) => lines.push(m),
    });

    expect(lines.some((l) => l.includes("[PASS] one"))).toBe(true);
  });
});

describe("cleanupRun", () => {
  it("deletes every recorded work item and tag, then marks the manifest cleaned", async () => {
    const client = new FakeAdoClient();
    const store = newStore();
    const ctx = buildContext({ client, store, runId: "r1", workItemType: "Task" });
    const id = await ctx.createWorkItem(["livetest-r1-x-a"]);

    await cleanupRun(client, store, () => undefined);

    expect(await client.countWorkItemsWithTag("livetest-r1-x-a")).toBe(0);
    expect(client.tagNames()).not.toContain("livetest-r1-x-a");
    expect(store.manifest.status).toBe("cleaned");
    // The work item is soft-deleted, so reading it back must fail the way the
    // real batch API does (its default ErrorPolicy is Fail, not Omit).
    await expect(client.getWorkItemTags([id])).rejects.toThrow(/404/);
  });

  it("keeps going when one delete fails but leaves the run in-progress for a retry", async () => {
    const client = new FakeAdoClient();
    const store = newStore();
    const ctx = buildContext({ client, store, runId: "r1", workItemType: "Task" });
    await ctx.createWorkItem(["livetest-r1-x-a"]);
    await ctx.createWorkItem(["livetest-r1-x-b"]);
    client.failNext("deleteWorkItem", "transient 500");

    const lines: string[] = [];
    await cleanupRun(client, store, (m) => lines.push(m));

    // Marking a partially-failed run "cleaned" would make --cleanup-all skip it
    // forever, stranding the surviving resource in the live project.
    expect(store.manifest.status).toBe("in-progress");
    expect(lines.some((l) => l.includes("transient 500"))).toBe(true);
  });

  it("treats an already-gone tag as cleaned, not as a failure", async () => {
    const client = new FakeAdoClient();
    const store = newStore();
    // The rename and merge abilities record a tag before creating it, so a run
    // that fails early leaves a phantom entry here. A 404 on it means the goal
    // is already met — counting it as a failure would pin the run in-progress
    // forever and every future sweep would retry something that cannot exist.
    store.addTag("livetest-r1-never-created");

    await expect(cleanupRun(client, store, () => undefined)).resolves.toBeUndefined();
    expect(store.manifest.status).toBe("cleaned");
  });

  it("does not log a scary line for an already-gone tag", async () => {
    const client = new FakeAdoClient();
    const store = newStore();
    store.addTag("livetest-r1-never-created");

    const lines: string[] = [];
    await cleanupRun(client, store, (m) => lines.push(m));

    expect(lines.some((l) => l.includes("could not delete"))).toBe(false);
  });

  it("is safe to re-run: a second sweep over the same manifest still succeeds", async () => {
    const client = new FakeAdoClient();
    const store = newStore();
    const ctx = buildContext({ client, store, runId: "r1", workItemType: "Task" });
    await ctx.createWorkItem(["livetest-r1-x-a"]);

    await cleanupRun(client, store, () => undefined);
    // Everything is already gone, so every delete now 404s. The second pass has
    // to treat that as the goal being met, not as a failure.
    await expect(cleanupRun(client, store, () => undefined)).resolves.toBeUndefined();
    expect(store.manifest.status).toBe("cleaned");
  });
});

describe("cleanupRun — provenance", () => {
  it("refuses to delete a work item id the harness did not create", async () => {
    const client = new FakeAdoClient();
    // A real production work item: no live-test marker in its title, no
    // live-test tag. A manifest naming {"workItems":[id],"tags":[]} passes
    // shape validation, so this check is the only thing between it and the
    // recycle bin.
    const production = client.seedWorkItem(["Bug"], "Customer cannot log in");
    const store = newStore();
    store.addWorkItem(production);

    const lines: string[] = [];
    await cleanupRun(client, store, (m) => lines.push(m));

    expect(client.tagsOf(production)).toEqual(["Bug"]);
    expect(lines.some((l) => l.includes(`REFUSING to delete work item ${production}`))).toBe(
      true
    );
    expect(store.manifest.status).toBe("in-progress");
  });

  it("scans the whole manifest before deleting anything", async () => {
    const client = new FakeAdoClient();
    const production = client.seedWorkItem(["Bug"], "Customer cannot log in");
    const store = newStore();
    const ctx = buildContext({ client, store, runId: "r1", workItemType: "Task" });
    const owned = await ctx.createWorkItem(["livetest-r1-x-a"]);
    // The foreign id is recorded last, so a delete-as-you-go loop would already
    // have destroyed the owned item before noticing the manifest is corrupt.
    store.addWorkItem(production);

    const lines: string[] = [];
    await cleanupRun(client, store, (m) => lines.push(m));

    const refusalAt = lines.findIndex((l) => l.includes("REFUSING"));
    const deletionAt = lines.findIndex((l) => l.includes("Cleanup refused"));
    expect(refusalAt).toBeGreaterThanOrEqual(0);
    expect(deletionAt).toBeGreaterThan(refusalAt);
    expect(client.tagsOf(production)).toEqual(["Bug"]);
    // The harness's own item is still cleaned up.
    expect(client.tagsOf(owned)).toEqual([]);
  });

  it("still deletes a work item whose tags were all cascaded off it", async () => {
    const client = new FakeAdoClient();
    const store = newStore();
    const ctx = buildContext({ client, store, runId: "r1", workItemType: "Task" });
    const id = await ctx.createWorkItem(["livetest-r1-delete-a"]);
    // Exactly what the delete-tag ability leaves behind: deleting the tag is
    // the assertion, and ADO cascades it off the work item. A tags-only
    // ownership check would refuse this item on every green run and pin the
    // manifest in-progress forever.
    await client.deleteTag("livetest-r1-delete-a");
    expect(client.tagsOf(id)).toEqual([]);

    await cleanupRun(client, store, () => undefined);

    expect(store.manifest.status).toBe("cleaned");
    await expect(client.getWorkItemTags([id])).rejects.toThrow(/404/);
  });

  it("cleans up completely after a full green run of every real ability", async () => {
    // End-to-end guard on the ownership predicate. A tags-only check passes
    // every unit test above and still refuses 2 of the 41 work items here —
    // the delete-tag ability's pair, whose tag it deleted as its assertion —
    // which would leave every green run in-progress and exiting non-zero.
    const client = new FakeAdoClient();
    const store = newStore();
    const results = await runAbilities({
      client,
      store,
      runId: "r1",
      workItemType: "Task",
      abilities: ALL_ABILITIES,
      log: () => undefined,
    });
    expect(results.every((r) => r.status === "pass")).toBe(true);

    const lines: string[] = [];
    await cleanupRun(client, store, (m) => lines.push(m));

    expect(lines.some((l) => l.includes("REFUSING"))).toBe(false);
    expect(store.manifest.status).toBe("cleaned");
    expect(client.tagNames()).toEqual([]);
  });

  it("refuses to delete a tag that is not a live-test tag", async () => {
    const client = new FakeAdoClient();
    client.seedWorkItem(["Bug"]);
    const store = newStore();
    // A stale, hand-edited, misplaced or planted manifest. Without a prefix
    // check this deletes a real production tag and reports a clean sweep.
    store.addTag("Bug");

    const lines: string[] = [];
    await cleanupRun(client, store, (m) => lines.push(m));

    expect(client.tagNames()).toContain("Bug");
    expect(lines.some((l) => l.includes("REFUSING to delete tag"))).toBe(true);
  });

  it("does not log a refusal for an id that is simply already gone", async () => {
    const client = new FakeAdoClient();
    const store = newStore();
    const ctx = buildContext({ client, store, runId: "r1", workItemType: "Task" });
    const id = await ctx.createWorkItem(["livetest-r1-x-a"]);
    await client.deleteWorkItem(id);

    const lines: string[] = [];
    await cleanupRun(client, store, (m) => lines.push(m));

    // The provenance read 404s on an already-deleted item. That is the goal
    // being met, not a refusal and not a failure.
    expect(lines.some((l) => l.includes("REFUSING"))).toBe(false);
    expect(store.manifest.status).toBe("cleaned");
  });

  it("does not mark a manifest naming a foreign tag as cleaned", async () => {
    const client = new FakeAdoClient();
    client.seedWorkItem(["Bug"]);
    const store = newStore();
    store.addTag("Bug");

    await cleanupRun(client, store, () => undefined);

    // A manifest naming tags the harness did not create is corrupt; reporting a
    // clean sweep would hide that from the human who needs to look at it.
    expect(store.manifest.status).toBe("in-progress");
  });

  it("still deletes the harness's own tags alongside a refused one", async () => {
    const client = new FakeAdoClient();
    client.seedWorkItem(["Bug"]);
    const store = newStore();
    const ctx = buildContext({ client, store, runId: "r1", workItemType: "Task" });
    await ctx.createWorkItem(["livetest-r1-x-a"]);
    store.addTag("Bug");

    await cleanupRun(client, store, () => undefined);

    expect(client.tagNames()).not.toContain("livetest-r1-x-a");
    expect(client.tagNames()).toContain("Bug");
  });
});
