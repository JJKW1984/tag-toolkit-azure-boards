import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  allPassed,
  buildReport,
  formatResultLine,
  formatSummary,
  writeReport,
} from "./report";
import { AbilityResult, RunReport } from "./types";

const pass: AbilityResult = { name: "Rename tag", status: "pass", durationMs: 388 };
const fail: AbilityResult = {
  name: "Delete tag",
  status: "fail",
  durationMs: 10004,
  detail: "Analytics count still 1 after 10s poll",
};

describe("formatResultLine", () => {
  it("renders a passing ability with its duration", () => {
    expect(formatResultLine(pass)).toBe("[PASS] Rename tag (388ms)");
  });

  it("renders a failing ability with its detail", () => {
    expect(formatResultLine(fail)).toBe(
      "[FAIL] Delete tag (10004ms) — Analytics count still 1 after 10s poll"
    );
  });

  it("redacts secrets that leaked into a failure detail", () => {
    const leaky: AbilityResult = {
      name: "List tags + counts",
      status: "fail",
      durationMs: 12,
      detail: "GET https://dev.azure.com/o/_apis/wit/tags failed, token=abc123secret",
    };

    const line = formatResultLine(leaky);

    expect(line).not.toContain("abc123secret");
    expect(line).not.toContain("https://dev.azure.com");
  });
});

describe("formatSummary", () => {
  it("counts passes over total and points at the report", () => {
    expect(formatSummary([pass, fail], ".live-test-runs/r1-report.json")).toBe(
      "1/2 passed. Report: .live-test-runs/r1-report.json"
    );
  });
});

describe("allPassed", () => {
  it("is true only when every ability passed", () => {
    expect(allPassed([pass])).toBe(true);
    expect(allPassed([pass, fail])).toBe(false);
  });

  it("is true for an empty run", () => {
    expect(allPassed([])).toBe(true);
  });
});

describe("buildReport", () => {
  it("carries run metadata alongside the results", () => {
    const report = buildReport(
      {
        runId: "r1",
        org: "https://dev.azure.com/myorg",
        project: "Proj",
        startedAt: "2026-09-15T14:02:11.000Z",
        finishedAt: "2026-09-15T14:02:16.702Z",
      },
      [pass]
    );

    expect(report).toEqual({
      runId: "r1",
      org: "https://dev.azure.com/myorg",
      project: "Proj",
      startedAt: "2026-09-15T14:02:11.000Z",
      finishedAt: "2026-09-15T14:02:16.702Z",
      results: [pass],
    });
  });

  it("redacts secrets that leaked into a failure detail", () => {
    const leaky: AbilityResult = {
      name: "List tags + counts",
      status: "fail",
      durationMs: 12,
      detail: "GET https://dev.azure.com/o/_apis/wit/tags failed, token=abc123secret",
    };

    const report = buildReport(
      { runId: "r1", org: "o", project: "p", startedAt: "a", finishedAt: "b" },
      [leaky]
    );

    expect(report.results[0].detail).not.toContain("abc123secret");
    expect(report.results[0].detail).not.toContain("https://dev.azure.com");
  });
});

describe("writeReport", () => {
  it("writes the report next to the manifest and returns its path", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "live-test-report-"));
    const report: RunReport = {
      runId: "r1",
      org: "o",
      project: "p",
      startedAt: "a",
      finishedAt: "b",
      results: [pass],
    };

    const written = writeReport(dir, report);

    expect(path.basename(written)).toBe("r1-report.json");
    expect(JSON.parse(fs.readFileSync(written, "utf8"))).toEqual(report);
  });
});
