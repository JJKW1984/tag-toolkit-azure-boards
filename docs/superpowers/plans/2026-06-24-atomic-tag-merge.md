# Atomic Tag Merge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make tag merging safe and atomic by adding the target tag to every affected work item *first*, and only deleting a source tag after all of its additions succeed.

**Architecture:** Split the merge into two phases inside `TagService`. Phase 1 (additive) adds the target tag to all work items across the whole batch of sources, removing nothing. Phase 2 (destructive) deletes only the source tags whose additions fully succeeded — Azure DevOps cascades each delete to strip that source tag from every work item. The UI calls one new batch method (`mergeTags`) and reflects per-source success/failure.

**Tech Stack:** TypeScript, React, `azure-devops-extension-api` / `-sdk`, Jest (`jest --runInBand`), pnpm, webpack.

## Global Constraints

- Tags stored in `System.Tags` as a semicolon+space string: `"bug; frontend; P1"` — use existing `parseTags` / `joinTags` helpers in [TagService.ts](src/services/TagService.ts).
- All tag-name comparisons are **case-insensitive** (`toLowerCase()`), matching existing code.
- Source-tag removal from work items comes **only** from the cascade delete (`deleteTagById`) — the per-item PATCH must never strip the source tag.
- Errors surfaced to the UI go through `sanitizeError` ([src/utils/sanitizeError.ts](src/utils/sanitizeError.ts)).
- Work items are fetched in batches of 200 (existing `applyTagUpdate` behavior — unchanged).
- Test runner: `pnpm test` runs `jest --runInBand`. Build: `pnpm build`.

---

## File Structure

- `src/types/index.ts` — add `MergeSourceResult`, `MergeSourceFailure`, `BatchMergeResult`.
- `src/services/TagService.ts` — add `mergeTags` (batch, two-phase); rewrite `mergeTag` as a thin delegate; switch the merge transform to add-only.
- `src/app/TagManagerApp.tsx` — `runMergeJobs` calls `mergeTags` once and maps per-source results to UI state.
- `src/services/TagService.test.ts` — update the existing merge test to add-first behavior; add ordering, partial-failure, and phase-2-delete-failure tests.

---

## Task 1: Merge result types

**Files:**
- Modify: `src/types/index.ts`

**Interfaces:**
- Consumes: existing `TagItem`, `TagOperationResult` (same file).
- Produces:
  - `MergeSourceResult extends TagOperationResult { source: TagItem }`
  - `MergeSourceFailure { source: TagItem; error: string }`
  - `BatchMergeResult { succeeded: MergeSourceResult[]; failed: MergeSourceFailure[] }`

- [ ] **Step 1: Add the types**

Append to `src/types/index.ts`:

```ts
/** One source tag successfully merged into the target. */
export interface MergeSourceResult extends TagOperationResult {
  source: TagItem;
}

/** One source tag that failed to merge (kept for retry). */
export interface MergeSourceFailure {
  source: TagItem;
  error: string;
}

/** Result of merging one or more source tags into a target. */
export interface BatchMergeResult {
  succeeded: MergeSourceResult[];
  failed: MergeSourceFailure[];
}
```

- [ ] **Step 2: Type-check**

Run: `pnpm exec tsc --noEmit`
Expected: PASS (no errors).

- [ ] **Step 3: Commit**

```bash
git add src/types/index.ts
git commit -m "feat: add batch merge result types"
```

---

## Task 2: Two-phase `mergeTags` in TagService

**Files:**
- Modify: `src/services/TagService.ts` (replace `mergeTag` body at lines 120-142; `applyTagUpdate` at 144-185 unchanged)
- Test: `src/services/TagService.test.ts`

**Interfaces:**
- Consumes: `getWorkItemsWithTag(tag: string): Promise<number[]>`, `applyTagUpdate(ids, transform): Promise<TagOperationResult>`, `deleteTagById(id): Promise<void>` (all existing in the same file); `sanitizeError` from `../utils/sanitizeError`; types from Task 1.
- Produces:
  - `mergeTags(sources: TagItem[], targetName: string): Promise<BatchMergeResult>`
  - `mergeTag(sourceId: string, sourceName: string, targetName: string): Promise<TagOperationResult>` (delegates to `mergeTags`, throws if the single source failed)

- [ ] **Step 1: Write the failing tests**

In `src/services/TagService.test.ts`, **replace** the existing test `"merges source tags into target and deletes source tag"` (lines 95-116) with the add-first version, and add the new tests. Note `mockWorkItemTrackingClient` and `fetchMock` are already set up in this file; `createDeleteResponse` exists; the WorkItemTracking client is shared via the api mock so the same mock receives all `queryByWiql` / `getWorkItemsBatch` / `updateWorkItem` calls.

```ts
it("adds target to work items without removing source, then deletes source", async () => {
  mockWorkItemTrackingClient.queryByWiql.mockResolvedValue({
    workItems: [{ id: 10 }, { id: 11 }],
  });
  mockWorkItemTrackingClient.getWorkItemsBatch.mockResolvedValue([
    { id: 10, fields: { "System.Tags": "Old; Alpha" } },
    { id: 11, fields: { "System.Tags": "old; New" } },
  ]);
  mockWorkItemTrackingClient.updateWorkItem.mockResolvedValue({});
  fetchMock.mockResolvedValue(createDeleteResponse());

  const service = new TagService();
  const source = { id: "old-id", name: "Old", url: "u" };
  const result = await service.mergeTag(source.id, source.name, "New");

  // id 11 already has "New" (case-insensitive) -> unchanged -> skipped.
  expect(result.affectedCount).toBe(1);
  expect(result.workItemIds).toEqual([10]);
  expect(mockWorkItemTrackingClient.updateWorkItem).toHaveBeenCalledTimes(1);

  // PATCH adds target and KEEPS source ("Old" not stripped).
  const patchOps = mockWorkItemTrackingClient.updateWorkItem.mock.calls[0][0] as Array<{
    value: string;
  }>;
  const tagValue = patchOps[0].value.toLowerCase();
  expect(tagValue).toContain("old");
  expect(tagValue).toContain("new");

  // Source removal comes from the cascade delete.
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: "DELETE" });
});

it("runs all additive updates before any source delete (whole-batch atomic)", async () => {
  const order: string[] = [];
  mockWorkItemTrackingClient.queryByWiql
    .mockResolvedValueOnce({ workItems: [{ id: 1 }] })
    .mockResolvedValueOnce({ workItems: [{ id: 2 }] });
  mockWorkItemTrackingClient.getWorkItemsBatch
    .mockResolvedValueOnce([{ id: 1, fields: { "System.Tags": "A" } }])
    .mockResolvedValueOnce([{ id: 2, fields: { "System.Tags": "B" } }]);
  mockWorkItemTrackingClient.updateWorkItem.mockImplementation(async () => {
    order.push("update");
    return {};
  });
  fetchMock.mockImplementation(async () => {
    order.push("delete");
    return createDeleteResponse();
  });

  const service = new TagService();
  await service.mergeTags(
    [
      { id: "a", name: "A", url: "u" },
      { id: "b", name: "B", url: "u" },
    ],
    "Target"
  );

  // Two updates first, then two deletes — no interleaving.
  expect(order).toEqual(["update", "update", "delete", "delete"]);
});

it("does not delete a source whose additive update failed", async () => {
  mockWorkItemTrackingClient.queryByWiql
    .mockResolvedValueOnce({ workItems: [{ id: 1 }] })
    .mockResolvedValueOnce({ workItems: [{ id: 2 }] });
  mockWorkItemTrackingClient.getWorkItemsBatch
    .mockResolvedValueOnce([{ id: 1, fields: { "System.Tags": "A" } }])
    .mockResolvedValueOnce([{ id: 2, fields: { "System.Tags": "B" } }]);
  mockWorkItemTrackingClient.updateWorkItem.mockImplementation(async (_ops, id) => {
    if (id === 2) throw new Error("patch failed");
    return {};
  });
  fetchMock.mockResolvedValue(createDeleteResponse());

  const service = new TagService();
  const res = await service.mergeTags(
    [
      { id: "a", name: "A", url: "u" },
      { id: "b", name: "B", url: "u" },
    ],
    "Target"
  );

  expect(res.succeeded.map((s) => s.source.id)).toEqual(["a"]);
  expect(res.failed.map((f) => f.source.id)).toEqual(["b"]);
  // Exactly one DELETE — only for source "a".
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it("marks a source failed when its delete fails after additions succeed", async () => {
  mockWorkItemTrackingClient.queryByWiql.mockResolvedValue({ workItems: [{ id: 1 }] });
  mockWorkItemTrackingClient.getWorkItemsBatch.mockResolvedValue([
    { id: 1, fields: { "System.Tags": "A" } },
  ]);
  mockWorkItemTrackingClient.updateWorkItem.mockResolvedValue({});
  fetchMock.mockResolvedValue({
    ok: false,
    status: 500,
    statusText: "Server Error",
    json: async () => ({}),
    text: async () => "boom",
  });

  const service = new TagService();
  const res = await service.mergeTags([{ id: "a", name: "A", url: "u" }], "Target");

  expect(res.succeeded).toEqual([]);
  expect(res.failed.map((f) => f.source.id)).toEqual(["a"]);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test -- TagService`
Expected: FAIL — old behavior (2 updates / source-stripping) and missing `mergeTags` method.

- [ ] **Step 3: Implement add-only transform + `mergeTags` + delegate**

In `src/services/TagService.ts`, add the import at the top (after existing imports):

```ts
import { sanitizeError } from "../utils/sanitizeError";
import {
  TagItem,
  TagOperationResult,
  BatchMergeResult,
  MergeSourceResult,
  MergeSourceFailure,
} from "../types";
```

(Replace the existing `import { TagItem, TagOperationResult } from "../types";` line — do not duplicate it.)

Replace the current `mergeTag` method (lines 120-142) with:

```ts
  /**
   * Merges one or more source tags into targetName, atomically:
   * Phase 1 (additive) — add targetName to every affected work item across ALL
   *   sources; nothing is removed.
   * Phase 2 (destructive) — delete only the source tags whose additions all
   *   succeeded. ADO cascades each delete to strip that source tag everywhere.
   * Sources that hit any failure are returned in `failed` (not deleted) for retry.
   */
  async mergeTags(
    sources: TagItem[],
    targetName: string
  ): Promise<BatchMergeResult> {
    const addTarget = (tags: string[]): string[] =>
      tags.some((t) => t.toLowerCase() === targetName.toLowerCase())
        ? tags
        : [...tags, targetName];

    const succeeded: MergeSourceResult[] = [];
    const failed: MergeSourceFailure[] = [];

    // Phase 1 — additive across the whole batch (no deletes yet).
    for (const source of sources) {
      try {
        const ids = await this.getWorkItemsWithTag(source.name);
        const result = await this.applyTagUpdate(ids, addTarget);
        succeeded.push({ source, ...result });
      } catch (e) {
        failed.push({ source, error: sanitizeError(e) });
      }
    }

    // Phase 2 — delete only sources whose additions fully succeeded.
    for (const entry of [...succeeded]) {
      try {
        await this.deleteTagById(entry.source.id);
      } catch (e) {
        // Additions done but delete failed: treat as failed (retry is idempotent).
        succeeded.splice(succeeded.indexOf(entry), 1);
        failed.push({ source: entry.source, error: sanitizeError(e) });
      }
    }

    return { succeeded, failed };
  }

  /**
   * Single-source convenience wrapper around mergeTags.
   * Throws if the source failed to merge (preserves prior call-site semantics).
   */
  async mergeTag(
    sourceId: string,
    sourceName: string,
    targetName: string
  ): Promise<TagOperationResult> {
    const source: TagItem = { id: sourceId, name: sourceName, url: "" };
    const { succeeded, failed } = await this.mergeTags([source], targetName);
    if (failed.length > 0) {
      throw new Error(failed[0].error);
    }
    const { affectedCount, workItemIds } = succeeded[0];
    return { affectedCount, workItemIds };
  }
```

`applyTagUpdate` (lines 144-185) is unchanged.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test -- TagService`
Expected: PASS (all TagService tests green).

- [ ] **Step 5: Commit**

```bash
git add src/services/TagService.ts src/services/TagService.test.ts
git commit -m "feat: atomic two-phase tag merge (add-first, delete-last)"
```

---

## Task 3: Wire `runMergeJobs` to the batch method

**Files:**
- Modify: `src/app/TagManagerApp.tsx` (replace `runMergeJobs`, lines 155-178)

**Interfaces:**
- Consumes: `tagService.mergeTags(sources, targetName)` (Task 2); existing `setTags`, `setSelectedIds`, `setError`, `setDialog`, `loadTags`.
- Produces: updated `runMergeJobs` (same signature: `(sources: TagItem[], targetName: string) => Promise<void>`).

- [ ] **Step 1: Replace `runMergeJobs`**

Replace lines 155-178 of `src/app/TagManagerApp.tsx` with:

```tsx
  const runMergeJobs = async (sources: TagItem[], targetName: string) => {
    setDialog(null);
    const { succeeded, failed } = await tagService.mergeTags(sources, targetName);

    // Remove fully-merged sources from the table immediately.
    const removedIds = new Set(succeeded.map((s) => s.source.id));
    setTags((prev) => prev.filter((t) => !removedIds.has(t.id)));

    if (failed.length > 0) {
      setError(failed.map((f) => `${f.source.name}: ${f.error}`).join("; "));
    }

    // Reload to pick up the new target tag if it was created.
    await loadTags(); // resets selectedIds to empty

    // Re-select any sources that failed to merge so the user can retry.
    if (failed.length > 0) {
      setSelectedIds(new Set(failed.map((f) => f.source.id)));
    }
  };
```

- [ ] **Step 2: Type-check + build**

Run: `pnpm exec tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/app/TagManagerApp.tsx
git commit -m "feat: use atomic batch merge in tag manager UI"
```

---

## Task 4: Full verification

- [ ] **Step 1: Run the whole test suite**

Run: `pnpm test`
Expected: PASS — all suites green.

- [ ] **Step 2: Production build**

Run: `pnpm build`
Expected: webpack production build completes with no type errors.

- [ ] **Step 3 (optional): Manual sanity in Azure DevOps**

Merge two source tags into one target where some work items already carry the target. Confirm: every affected work item gains the target tag; both source tags disappear from the project; and (by forcing a failure, e.g. revoking permission mid-run) a failed source's tag remains intact and is re-selected in the table for retry.

---

## Self-Review

**Spec coverage:**
- Add-first / delete-last → Task 2 (`addTarget` transform + two-phase `mergeTags`). ✅
- Whole-batch atomic (no interleaving) → Task 2 Phase 1 loop completes before Phase 2; covered by the ordering test. ✅
- Delete only fully-added sources → Task 2 Phase 2 iterates `succeeded`; partial-failure test. ✅
- Source removal via cascade only (PATCH never strips source) → add-only transform; asserted in the first test. ✅
- Phase-2 delete failure marks source failed → Task 2 catch in Phase 2; dedicated test. ✅
- UI reflects per-source outcomes + retry → Task 3. ✅

**Placeholder scan:** none — all steps contain concrete code/commands.

**Type consistency:** `mergeTags` / `mergeTag` signatures, `BatchMergeResult.{succeeded,failed}`, `MergeSourceResult.source`, and `MergeSourceFailure.{source,error}` are used identically across Tasks 1-3.
