/** Every tag and work item the harness creates carries this prefix. */
export const LIVE_TEST_PREFIX = "livetest-";

/** Builds the tag name for one ability's scoped test data. */
export function testTag(runId: string, ability: string, suffix: string): string {
  return `${LIVE_TEST_PREFIX}${runId}-${ability}-${suffix}`;
}

/** Compact UTC run id, e.g. 20260915140211. Used for manifest/report filenames. */
export function newRunId(now: Date): string {
  const pad = (n: number): string => String(n).padStart(2, "0");
  return (
    String(now.getUTCFullYear()) +
    pad(now.getUTCMonth() + 1) +
    pad(now.getUTCDate()) +
    pad(now.getUTCHours()) +
    pad(now.getUTCMinutes()) +
    pad(now.getUTCSeconds())
  );
}
