/** Every tag and work item the harness creates carries this prefix. */
export const LIVE_TEST_PREFIX = "livetest-";

/** Builds the tag name for one ability's scoped test data. */
export function testTag(runId: string, ability: string, suffix: string): string {
  return `${LIVE_TEST_PREFIX}${runId}-${ability}-${suffix}`;
}

/**
 * Marks a work item title as harness-created.
 *
 * Tags cannot carry work-item provenance on their own: the delete-tag ability
 * deletes its own tag as the very thing it asserts, and ADO cascades that off
 * the two work items it created, so by cleanup time they carry no tag at all.
 * A title is written once at creation and nothing — no ability, no cascade, no
 * cleanup retry — ever rewrites it, which makes it the one signal cleanup can
 * still trust when it has to decide whether an id is safe to delete.
 */
export function testWorkItemTitle(runId: string, title: string): string {
  return `[${LIVE_TEST_PREFIX}${runId}] ${title}`;
}

/** True when a title carries the marker `testWorkItemTitle` stamps on. */
export function isLiveTestWorkItemTitle(title: string | undefined): boolean {
  return (title ?? "").startsWith(`[${LIVE_TEST_PREFIX}`);
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
