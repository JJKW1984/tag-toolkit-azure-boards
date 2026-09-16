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

describe("ManifestStore.open — shape validation", () => {
  // --cleanup takes an arbitrary path and --cleanup-all sweeps a directory, so
  // open() is the gate between "some JSON file" and "a list of things to delete
  // in a live project". A bare `as RunManifest` cast is not that gate.
  function writeRaw(body: unknown): string {
    const p = path.join(tempDir(), "m.json");
    fs.writeFileSync(p, JSON.stringify(body), "utf8");
    return p;
  }

  const good = {
    runId: "r1",
    org: "https://dev.azure.com/o",
    project: "P",
    status: "in-progress",
    workItems: [1, 2],
    tags: ["livetest-r1-x-a"],
  };

  it("accepts a well-formed manifest", () => {
    expect(ManifestStore.open(writeRaw(good)).manifest.tags).toEqual(["livetest-r1-x-a"]);
  });

  it("rejects a JSON value that is not an object", () => {
    expect(() => ManifestStore.open(writeRaw([1, 2, 3]))).toThrow(/not a valid run manifest/i);
  });

  it.each(["runId", "org", "project"] as const)(
    "rejects a manifest whose %s is missing",
    (key) => {
      const bad: Record<string, unknown> = { ...good };
      delete bad[key];
      expect(() => ManifestStore.open(writeRaw(bad))).toThrow(new RegExp(`"${key}"`));
    }
  );

  it("rejects an empty runId", () => {
    expect(() => ManifestStore.open(writeRaw({ ...good, runId: "" }))).toThrow(/runId/);
  });

  it("rejects an unknown status", () => {
    expect(() => ManifestStore.open(writeRaw({ ...good, status: "done" }))).toThrow(/status/);
  });

  it("rejects workItems that are not all numbers", () => {
    expect(() => ManifestStore.open(writeRaw({ ...good, workItems: [1, "2"] }))).toThrow(
      /workItems/
    );
  });

  it("rejects workItems that is not an array", () => {
    expect(() => ManifestStore.open(writeRaw({ ...good, workItems: 7 }))).toThrow(
      /workItems/
    );
  });

  it("rejects tags that are not all strings", () => {
    expect(() => ManifestStore.open(writeRaw({ ...good, tags: ["a", 3] }))).toThrow(/tags/);
  });

  it("does not echo a manifest value in the rejection message", () => {
    // The message is logged and uploaded as a CI artifact.
    const p = writeRaw({ ...good, status: "SECRET-LOOKING-VALUE" });
    expect(() => ManifestStore.open(p)).toThrow();
    try {
      ManifestStore.open(p);
    } catch (e) {
      expect((e as Error).message).not.toContain("SECRET-LOOKING-VALUE");
    }
  });
});

describe("flush atomicity", () => {
  it("replaces the manifest by rename and leaves no temp file behind", () => {
    const dir = tempDir();
    const store = ManifestStore.create(dir, { runId: "r1", org: "o", project: "p" });

    store.addWorkItem(1);
    store.addTag("livetest-r1-x-a");

    // writeFileSync truncates in place: a crash mid-flush would lose every id
    // recorded earlier, which is exactly what this file exists to prevent.
    expect(fs.readdirSync(dir)).toEqual(["r1.json"]);
    expect(readRaw(store.path).workItems).toEqual([1]);
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
