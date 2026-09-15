// live-test/runner.test.ts
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { buildContext, cleanupRun, runAbilities } from "./runner";
import { ManifestStore } from "./manifest";
import { FakeAdoClient } from "./test/fakeAdoClient";
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

  it("keeps going when one delete fails and still marks the run cleaned", async () => {
    const client = new FakeAdoClient();
    const store = newStore();
    const ctx = buildContext({ client, store, runId: "r1", workItemType: "Task" });
    await ctx.createWorkItem(["livetest-r1-x-a"]);
    await ctx.createWorkItem(["livetest-r1-x-b"]);
    client.failNext("deleteWorkItem", "transient 500");

    const lines: string[] = [];
    await cleanupRun(client, store, (m) => lines.push(m));

    expect(store.manifest.status).toBe("cleaned");
    expect(lines.some((l) => l.includes("transient 500"))).toBe(true);
  });

  it("tolerates a tag that is already gone", async () => {
    const client = new FakeAdoClient();
    const store = newStore();
    store.addTag("never-created");

    await expect(cleanupRun(client, store, () => undefined)).resolves.toBeUndefined();
    expect(store.manifest.status).toBe("cleaned");
  });
});
