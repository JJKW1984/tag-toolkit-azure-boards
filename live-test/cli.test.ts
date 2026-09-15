import { confirmationMatches, CliError, parseCliArgs } from "./cli";

describe("parseCliArgs — run mode", () => {
  it("parses a full run invocation", () => {
    expect(
      parseCliArgs(["--org", "https://dev.azure.com/o", "--project", "P", "--pat", "x"])
    ).toEqual({
      mode: "run",
      org: "https://dev.azure.com/o",
      project: "P",
      pat: "x",
      yes: false,
      workItemType: "Task",
    });
  });

  it("defaults the work item type to Task", () => {
    const opts = parseCliArgs(["--org", "o", "--project", "P", "--pat", "x"]);
    expect(opts.workItemType).toBe("Task");
  });

  it("honours an explicit --work-item-type", () => {
    const opts = parseCliArgs([
      "--org", "o", "--project", "P", "--pat", "x",
      "--work-item-type", "Issue",
    ]);
    expect(opts.workItemType).toBe("Issue");
  });

  it("records --yes so the confirmation prompt is skipped", () => {
    expect(parseCliArgs(["--org", "o", "--project", "P", "--pat", "x", "--yes"]).yes).toBe(
      true
    );
  });

  it("rejects a run without --org", () => {
    expect(() => parseCliArgs(["--project", "P", "--pat", "x"])).toThrow(CliError);
  });

  it("rejects a run without --project", () => {
    expect(() => parseCliArgs(["--org", "o", "--pat", "x"])).toThrow(/--project/);
  });

  it("rejects any invocation without --pat", () => {
    expect(() => parseCliArgs(["--org", "o", "--project", "P"])).toThrow(/--pat/);
  });

  it("rejects an unknown flag instead of ignoring it", () => {
    expect(() =>
      parseCliArgs(["--org", "o", "--project", "P", "--pat", "x", "--destroy"])
    ).toThrow(CliError);
  });
});

describe("parseCliArgs — cleanup modes", () => {
  it("parses --cleanup with a manifest path", () => {
    expect(parseCliArgs(["--cleanup", ".live-test-runs/r1.json", "--pat", "x"])).toEqual({
      mode: "cleanup",
      pat: "x",
      yes: false,
      workItemType: "Task",
      manifestPath: ".live-test-runs/r1.json",
    });
  });

  it("does not require --org or --project for cleanup (the manifest has them)", () => {
    expect(() => parseCliArgs(["--cleanup", "m.json", "--pat", "x"])).not.toThrow();
  });

  it("parses --cleanup-all", () => {
    expect(parseCliArgs(["--cleanup-all", "--pat", "x"]).mode).toBe("cleanup-all");
  });

  it("rejects combining --cleanup and --cleanup-all", () => {
    expect(() => parseCliArgs(["--cleanup", "m.json", "--cleanup-all", "--pat", "x"])).toThrow(
      CliError
    );
  });
});

describe("confirmationMatches", () => {
  it("accepts the exact project name", () => {
    expect(confirmationMatches("My Project", "My Project")).toBe(true);
  });

  it("ignores surrounding whitespace", () => {
    expect(confirmationMatches("  My Project \n", "My Project")).toBe(true);
  });

  it("rejects a different project name", () => {
    expect(confirmationMatches("Other", "My Project")).toBe(false);
  });

  it("rejects a case-mismatched name — the guard is meant to be deliberate", () => {
    expect(confirmationMatches("my project", "My Project")).toBe(false);
  });

  it("rejects an empty answer", () => {
    expect(confirmationMatches("", "My Project")).toBe(false);
  });
});

// --- appended to live-test/cli.test.ts ---
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { main } from "./cli";
import { ManifestStore } from "./manifest";

describe("main — confirmation gate", () => {
  it("aborts with a non-zero code when the typed project name does not match", async () => {
    const log: string[] = [];
    const code = await main(
      ["--org", "https://dev.azure.com/o", "--project", "P", "--pat", "x"],
      { log: (m) => log.push(m), ask: async () => "wrong", now: () => new Date() }
    );

    expect(code).toBe(1);
    expect(log.join("\n")).toContain("Aborted");
  });

  it("prints usage and returns 2 for a bad invocation", async () => {
    const log: string[] = [];
    const code = await main(["--pat", "x"], {
      log: (m) => log.push(m),
      ask: async () => "",
      now: () => new Date(),
    });

    expect(code).toBe(2);
    expect(log.join("\n")).toContain("Usage:");
  });
});

describe("main — cleanup mode", () => {
  it("returns 0 and marks a manifest cleaned when there is nothing to delete", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "live-test-main-"));
    const store = ManifestStore.create(dir, {
      runId: "r1",
      org: "https://dev.azure.com/o",
      project: "P",
    });

    const code = await main(["--cleanup", store.path, "--pat", "x"], {
      log: () => undefined,
      ask: async () => "",
      now: () => new Date(),
    });

    expect(code).toBe(0);
    expect(ManifestStore.open(store.path).manifest.status).toBe("cleaned");
  });

  it("returns 1 and says so when the manifest cannot be read", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "live-test-main-"));
    const corrupt = path.join(dir, "corrupt.json");
    fs.writeFileSync(corrupt, "{ not json", "utf8");

    const log: string[] = [];
    const code = await main(["--cleanup", corrupt, "--pat", "x"], {
      log: (m) => log.push(m),
      ask: async () => "",
      now: () => new Date(),
    });

    expect(code).toBe(1);
    expect(log.join("\n")).toContain("Could not read");
  });

  it("returns 1 when a manifest's org URL cannot be used", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "live-test-main-"));
    const store = ManifestStore.create(dir, {
      runId: "r2",
      org: "not-an-azure-devops-url",
      project: "P",
    });

    const log: string[] = [];
    const code = await main(["--cleanup", store.path, "--pat", "x"], {
      log: (m) => log.push(m),
      ask: async () => "",
      now: () => new Date(),
    });

    expect(code).toBe(1);
    expect(log.join("\n")).toContain("cleanup failed");
  });
});
