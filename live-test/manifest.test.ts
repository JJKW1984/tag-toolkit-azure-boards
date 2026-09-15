// live-test/manifest.test.ts
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { listManifestPaths, ManifestStore } from "./manifest";
import { RunManifest } from "./types";

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "live-test-manifest-"));
}

function readRaw(p: string): RunManifest {
  return JSON.parse(fs.readFileSync(p, "utf8")) as RunManifest;
}

describe("ManifestStore.create", () => {
  it("writes an in-progress manifest to disk immediately", () => {
    const dir = tempDir();
    const store = ManifestStore.create(dir, {
      runId: "r1",
      org: "https://dev.azure.com/myorg",
      project: "Proj",
    });

    expect(readRaw(store.path)).toEqual({
      runId: "r1",
      org: "https://dev.azure.com/myorg",
      project: "Proj",
      status: "in-progress",
      workItems: [],
      tags: [],
    });
  });

  it("creates the runs directory when it does not exist", () => {
    const dir = path.join(tempDir(), "nested", "runs");
    const store = ManifestStore.create(dir, { runId: "r1", org: "o", project: "p" });
    expect(fs.existsSync(store.path)).toBe(true);
  });
});

describe("recording created resources", () => {
  it("persists a work item id before returning", () => {
    const dir = tempDir();
    const store = ManifestStore.create(dir, { runId: "r1", org: "o", project: "p" });

    store.addWorkItem(42);

    expect(readRaw(store.path).workItems).toEqual([42]);
  });

  it("persists a tag name before returning", () => {
    const dir = tempDir();
    const store = ManifestStore.create(dir, { runId: "r1", org: "o", project: "p" });

    store.addTag("livetest-r1-delete-a");

    expect(readRaw(store.path).tags).toEqual(["livetest-r1-delete-a"]);
  });

  it("does not record the same tag twice", () => {
    const dir = tempDir();
    const store = ManifestStore.create(dir, { runId: "r1", org: "o", project: "p" });

    store.addTag("t");
    store.addTag("t");

    expect(readRaw(store.path).tags).toEqual(["t"]);
  });
});

describe("markCleaned", () => {
  it("flips status on disk so a later sweep skips the run", () => {
    const dir = tempDir();
    const store = ManifestStore.create(dir, { runId: "r1", org: "o", project: "p" });

    store.markCleaned();

    expect(readRaw(store.path).status).toBe("cleaned");
  });
});

describe("ManifestStore.open", () => {
  it("reopens a manifest written by an earlier process", () => {
    const dir = tempDir();
    const created = ManifestStore.create(dir, { runId: "r1", org: "o", project: "p" });
    created.addWorkItem(7);

    const reopened = ManifestStore.open(created.path);

    expect(reopened.manifest.workItems).toEqual([7]);
    expect(reopened.manifest.runId).toBe("r1");
  });
});

describe("listManifestPaths", () => {
  it("returns manifests but not report files", () => {
    const dir = tempDir();
    ManifestStore.create(dir, { runId: "r1", org: "o", project: "p" });
    fs.writeFileSync(path.join(dir, "r1-report.json"), "{}", "utf8");

    expect(listManifestPaths(dir).map((p) => path.basename(p))).toEqual(["r1.json"]);
  });

  it("returns an empty list when the directory does not exist", () => {
    expect(listManifestPaths(path.join(tempDir(), "missing"))).toEqual([]);
  });
});
