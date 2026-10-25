// live-test/cli.runmode.test.ts
//
// Run-mode exit codes. Kept out of cli.test.ts because it mocks ./runner, and
// the cleanup-mode tests over there need the real one.
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

jest.mock("./runner", () => ({
  runAbilities: jest.fn(),
  cleanupRun: jest.fn(),
}));

import { main, MainIo } from "./cli";
import { ManifestStore } from "./manifest";
import { cleanupRun, runAbilities } from "./runner";
import { AbilityResult } from "./types";

const runAbilitiesMock = runAbilities as jest.MockedFunction<typeof runAbilities>;
const cleanupRunMock = cleanupRun as jest.MockedFunction<typeof cleanupRun>;

const PASSED: AbilityResult[] = [{ name: "a", status: "pass", durationMs: 1 }];

let originalCwd: string;

function io(log: string[]): MainIo {
  return { log: (m) => log.push(m), ask: async () => "", now: () => new Date() };
}

beforeEach(() => {
  originalCwd = process.cwd();
  // RUNS_DIR is relative, so run each case in a throwaway working directory.
  process.chdir(fs.mkdtempSync(path.join(os.tmpdir(), "live-test-runmode-")));
  jest.resetAllMocks();
  runAbilitiesMock.mockResolvedValue(PASSED);
});

afterEach(() => {
  process.chdir(originalCwd);
});

const ARGV = ["--org", "https://dev.azure.com/o", "--project", "P", "--pat", "x", "--yes"];

describe("main — run mode exit code", () => {
  it("returns 0 when every ability passed and cleanup completed", async () => {
    cleanupRunMock.mockImplementation(async (_client, store) => {
      store.markCleaned();
    });

    expect(await main(ARGV, io([]))).toBe(0);
  });

  it("returns non-zero when every ability passed but cleanup left resources alive", async () => {
    // cleanupRun deliberately refuses to mark a manifest cleaned when a delete
    // did not resolve. Returning 0 here would report a green run while real
    // test data is still live in the project.
    cleanupRunMock.mockResolvedValue(undefined);

    const log: string[] = [];
    const code = await main(ARGV, io(log));

    expect(code).toBe(1);
    expect(log.join("\n")).toContain("Test data may still be live");
  });

  it("leaves the manifest in-progress so a later sweep picks the run up", async () => {
    cleanupRunMock.mockResolvedValue(undefined);

    await main(ARGV, io([]));

    const [manifestPath] = fs
      .readdirSync(".live-test-runs")
      .filter((f) => !f.endsWith("-report.json"))
      .map((f) => path.join(".live-test-runs", f));
    expect(ManifestStore.open(manifestPath).manifest.status).toBe("in-progress");
  });

  it("returns non-zero when every ability passed but the user leaves data in place", async () => {
    const log: string[] = [];
    const answers = ["P", "n"];
    const code = await main(
      ["--org", "https://dev.azure.com/o", "--project", "P", "--pat", "x"],
      {
        log: (m) => log.push(m),
        ask: async () => answers.shift() as string,
        now: () => new Date(),
      }
    );

    expect(code).toBe(1);
    expect(log.join("\n")).toContain("Left in place");
    expect(cleanupRunMock).not.toHaveBeenCalled();
  });

  it("returns 1 for a failing ability even when cleanup completed", async () => {
    runAbilitiesMock.mockResolvedValue([
      { name: "a", status: "fail", durationMs: 1, detail: "nope" },
    ]);
    cleanupRunMock.mockImplementation(async (_client, store) => {
      store.markCleaned();
    });

    expect(await main(ARGV, io([]))).toBe(1);
  });
});
