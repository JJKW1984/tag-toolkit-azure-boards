import * as fs from "node:fs";
import * as path from "node:path";
import { sanitizeError } from "../src/utils/sanitizeError";
import { AbilityResult, RunReport } from "./types";

export function formatResultLine(result: AbilityResult): string {
  const head = `[${result.status === "pass" ? "PASS" : "FAIL"}] ${result.name} (${result.durationMs}ms)`;
  return result.detail !== undefined ? `${head} — ${sanitizeError(result.detail)}` : head;
}

export function formatSummary(results: AbilityResult[], reportFilePath: string): string {
  const passed = results.filter((r) => r.status === "pass").length;
  return `${passed}/${results.length} passed. Report: ${reportFilePath}`;
}

export function allPassed(results: AbilityResult[]): boolean {
  return results.every((r) => r.status === "pass");
}

export function buildReport(
  meta: {
    runId: string;
    org: string;
    project: string;
    startedAt: string;
    finishedAt: string;
  },
  results: AbilityResult[]
): RunReport {
  return {
    ...meta,
    // The report is uploaded as a CI artifact — never let a raw error through.
    results: results.map((r) =>
      r.detail === undefined ? r : { ...r, detail: sanitizeError(r.detail) }
    ),
  };
}

export function reportPath(dir: string, runId: string): string {
  return path.join(dir, `${runId}-report.json`);
}

export function writeReport(dir: string, report: RunReport): string {
  fs.mkdirSync(dir, { recursive: true });
  const target = reportPath(dir, report.runId);
  fs.writeFileSync(target, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return target;
}
