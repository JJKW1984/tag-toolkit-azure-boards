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
    const raw: unknown = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    return new ManifestStore(manifestPath, parseRunManifest(raw));
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
  // Write-then-rename rather than a plain writeFileSync, which truncates the
  // target first: a crash between truncate and write would lose the *entire*
  // manifest, including every id recorded before this call. rename(2) is atomic
  // within a filesystem, and the temp file is a sibling so that always holds.
  private flush(): void {
    const tmp = `${this.path}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify(this.data, null, 2)}\n`, "utf8");
    fs.renameSync(tmp, this.path);
  }
}

/**
 * Validates an arbitrary parsed JSON value as a RunManifest.
 *
 * Cleanup deletes whatever the manifest names, and `--cleanup <path>` accepts
 * any path on disk, so this is the gate between "a JSON file" and "a list of
 * things to delete in a live project". Nothing here echoes a value into the
 * message: the error is logged and uploaded as a CI artifact.
 */
function parseRunManifest(raw: unknown): RunManifest {
  const reject = (why: string): never => {
    throw new Error(`Not a valid run manifest: ${why}`);
  };

  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return reject("expected a JSON object");
  }
  const m = raw as Record<string, unknown>;

  for (const key of ["runId", "org", "project"] as const) {
    if (typeof m[key] !== "string" || (m[key] as string).length === 0) {
      return reject(`"${key}" must be a non-empty string`);
    }
  }
  if (m.status !== "in-progress" && m.status !== "cleaned") {
    return reject(`"status" must be "in-progress" or "cleaned"`);
  }
  if (
    !Array.isArray(m.workItems) ||
    m.workItems.some((v) => typeof v !== "number" || !Number.isFinite(v))
  ) {
    return reject(`"workItems" must be an array of numbers`);
  }
  if (!Array.isArray(m.tags) || m.tags.some((v) => typeof v !== "string")) {
    return reject(`"tags" must be an array of strings`);
  }

  return {
    runId: m.runId as string,
    org: m.org as string,
    project: m.project as string,
    status: m.status,
    workItems: m.workItems as number[],
    tags: m.tags as string[],
  };
}

export function listManifestPaths(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json") && !f.endsWith("-report.json"))
    .map((f) => path.join(dir, f));
}
