// live-test/manifest.ts
import * as fs from "node:fs";
import * as path from "node:path";
import { RunManifest } from "./types";

export const RUNS_DIR = ".live-test-runs";

export class ManifestStore {
  private constructor(
    readonly path: string,
    private readonly data: RunManifest
  ) {}

  static create(
    dir: string,
    init: { runId: string; org: string; project: string }
  ): ManifestStore {
    fs.mkdirSync(dir, { recursive: true });
    const data: RunManifest = {
      runId: init.runId,
      org: init.org,
      project: init.project,
      status: "in-progress",
      workItems: [],
      tags: [],
    };
    const store = new ManifestStore(path.join(dir, `${init.runId}.json`), data);
    store.flush();
    return store;
  }

  static open(manifestPath: string): ManifestStore {
    const data = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as RunManifest;
    return new ManifestStore(manifestPath, data);
  }

  get manifest(): RunManifest {
    return this.data;
  }

  addWorkItem(id: number): void {
    if (!this.data.workItems.includes(id)) {
      this.data.workItems.push(id);
      this.flush();
    }
  }

  addTag(name: string): void {
    if (!this.data.tags.includes(name)) {
      this.data.tags.push(name);
      this.flush();
    }
  }

  markCleaned(): void {
    this.data.status = "cleaned";
    this.flush();
  }

  // Synchronous: a crash must never lose a record of something that now exists.
  private flush(): void {
    fs.writeFileSync(this.path, `${JSON.stringify(this.data, null, 2)}\n`, "utf8");
  }
}

export function listManifestPaths(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json") && !f.endsWith("-report.json"))
    .map((f) => path.join(dir, f));
}
