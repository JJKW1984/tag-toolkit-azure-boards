# Live Test Harness (API-Level)

**Date:** 2026-09-15
**Branch:** feature/live-test-harness

## Context

Validating the extension against a real Azure DevOps org today is manual: the README's "Private Pre-Release Testing Workflow" says to install the `-develop` extension and click through merge/rename/delete/count/paging by hand. This design adds a standalone, PAT-authenticated Node/TypeScript harness that exercises the same server-side behavior the extension relies on — creating its own test work items and tags, asserting each ability's contract, reporting pass/fail with detail, and prompting to clean up everything it created.

This is **Phase 1 (API-level)** of a two-phase effort. A future, separately-specced Phase 2 would add Playwright automation against the installed `-develop` extension's actual UI. This spec covers Phase 1 only.

### Why API-level, not UI-level, for Phase 1

`TagService` and `TagCountCacheService` are built on `azure-devops-extension-api`'s `getClient()` and `SDK.getAccessToken()`/`SDK.getHost()`/`SDK.getService()`, which require the extension to be running inside an ADO iframe host handshake (`SDK.init()`). They cannot run in a standalone Node process. Reusing that code directly for a live-test script is not possible without a production refactor larger than this task warrants, so the harness re-implements the same REST semantics against the live APIs instead of importing `TagService`.

**Trade-off, stated plainly:** the harness's REST calls are a parallel implementation, not the same code path as the shipped extension. If `TagService`'s API usage changes (a new field, a different endpoint, a changed API version), this harness will not automatically reflect that — it needs a matching update. It validates the *contract* the extension depends on (Tags API, Work Item Tracking, Analytics OData), not the extension's own code.

---

## Architecture

```
pnpm live-test --org <org> --project <proj> --pat <pat> [--yes] [--work-item-type Task]
pnpm live-test --cleanup .live-test-runs/<runId>.json

cli.ts
  → parse flags
  → print resolved org/project, require typed project-name confirmation (skipped with --yes)
  → runner.ts

runner.ts (normal run)
  → manifest.ts: create manifest file for this run (status: "in-progress")
  → for each ability in abilities/*:
      → create its own scoped work items/tags (via adoClient.ts), recording each into the manifest as it's created
      → assert the ability's contract
      → record PASS/FAIL + timing + detail
      → continue to next ability regardless of outcome
  → report.ts: print console summary, write JSON report
  → prompt: "Delete N test work items and M test tags? [y/N]" (auto-yes with --yes)
  → on confirm: delete via adoClient.ts, mark manifest "cleaned"
  → on decline: leave manifest "in-progress", print its path for later --cleanup

runner.ts (--cleanup <manifest>)
  → read manifest, delete every recorded work item/tag, mark "cleaned"
```

### Why `azure-devops-node-api` + raw fetch, not `azure-devops-extension-api`

`azure-devops-node-api` is Microsoft's official PAT-based Node client, built for exactly this use case (unlike `azure-devops-extension-api`, which assumes an iframe host). It's added as a new devDependency and used for standard Work Item Tracking operations (create/get/update/delete work items, WIQL). The Tags API (`_apis/wit/tags`) and the Analytics OData counts endpoint aren't wrapped by a typed client method, so those two are raw `fetch` calls with PAT Basic auth (`Authorization: Basic base64(":" + pat)`), using the same URLs and `api-version=7.1` already used in [TagService.ts](../../../src/services/TagService.ts) and [TagCountCacheService.ts](../../../src/services/TagCountCacheService.ts).

---

## New Directory: `live-test/`

Sibling to `src/`, **not** included in the webpack bundle or the packaged `.vsix`. Run via `tsx` (new devDependency, added purely for local script execution — no build step needed for this tooling).

| File | Responsibility |
|---|---|
| `cli.ts` | Flag parsing (`--org`, `--project`, `--pat`, `--yes`, `--cleanup`, `--work-item-type`), confirmation prompt, dispatch to `runner.ts` |
| `adoClient.ts` | PAT-authenticated calls: Tags API CRUD, Analytics OData counts, WIT create/get/update/delete/WIQL (via `azure-devops-node-api`) |
| `manifest.ts` | Read/write `.live-test-runs/<runId>.json`; append-as-created semantics so a crash never loses track of what exists |
| `report.ts` | Console table renderer (live per-ability line + summary) and JSON report writer |
| `runner.ts` | Orchestration: confirm → run abilities sequentially, continue on failure → report → prompt cleanup → cleanup |
| `abilities/listTagsAndCounts.ts` | List-tags + live-count contract |
| `abilities/renameTag.ts` | Rename contract |
| `abilities/mergeTags.ts` | Multi-source atomic merge contract |
| `abilities/deleteTag.ts` | Delete/cascade contract |
| `abilities/pagingVolume.ts` | List-API-under-volume contract |

Each ability file exports:

```typescript
interface AbilityResult {
  name: string;
  status: "pass" | "fail";
  durationMs: number;
  detail?: string;   // failure reason, or notable info on pass
}

interface AbilityContext {
  client: AdoClient;
  manifest: RunManifest;   // mutated as items are created
  runId: string;
}

async function run(ctx: AbilityContext): Promise<AbilityResult>
```

---

## Test Data & Isolation

Every ability owns a private tag namespace prefixed `livetest-<runId>-<ability>-...` (e.g. `livetest-20260915140211-merge-a`) and creates its own `Task` work items (default; overridable via `--work-item-type` for non-standard process templates). No ability depends on another's data — a failure in one doesn't block or corrupt the others, and cleanup is simply "delete everything this run's manifest recorded."

### Ability: List tags + live counts
1. Create 3 Tasks tagged `livetest-<run>-count`.
2. Call the Tags API list — assert the tag is present.
3. Call the Analytics OData counts endpoint (poll, see below) — assert count is exactly 3.

### Ability: Rename
1. Create 2 Tasks tagged `livetest-<run>-rename-old`.
2. Rename via the Tags API to `livetest-<run>-rename-new`.
3. WIQL-query both work items — assert both now carry the new tag name and not the old one.

### Ability: Merge (atomic two-phase)
1. Create Tasks across 3 source tags (`livetest-<run>-merge-a/b/c`), with at least one work item carrying two of the three sources, to exercise de-duplication.
2. Merge all 3 sources into `livetest-<run>-merge-target`.
3. Assert: every affected work item now carries the target tag exactly once; all 3 source tags no longer exist in the project; a work item that already had the target tag before merging wasn't given a duplicate.

### Ability: Delete (cascade)
1. Create 2 Tasks tagged `livetest-<run>-delete`.
2. Delete the tag via the Tags API.
3. Assert: the tag no longer appears in the Tags API list; both work items no longer carry it.

### Ability: Paging/volume
1. Create ~30 uniquely-named tags (`livetest-<run>-vol-000` … `vol-029`), one Task each.
2. Call the Tags API list.
3. Assert all 30 are present and correctly named — validates the list endpoint's behavior under a larger tag set. (This does not test the UI paging component, `AlphaNav`, or search — those remain covered by existing Jest tests against mocked data, since they involve no server round-trip.)

---

## Eventual Consistency

The Analytics OData endpoint lags behind OLTP writes by an unpredictable amount. Any assertion reading from Analytics (only the "list + counts" ability) uses a poll-with-timeout helper: retry every 2 seconds, up to 30 seconds total. A timeout is reported as a `fail` with the last observed value and elapsed time, not a hang or an exception.

---

## Manifest & Crash Recovery

Before creating anything, `runner.ts` writes `.live-test-runs/<runId>.json`:

```json
{
  "runId": "20260915140211",
  "org": "https://dev.azure.com/myorg",
  "project": "TagToolkit-Test",
  "status": "in-progress",
  "workItems": [],
  "tags": []
}
```

Every work item and tag is appended to this file **immediately after creation**, before the next step proceeds — so a crash mid-run always leaves an accurate, disk-persisted record of everything that exists. `pnpm live-test --cleanup <path>` reads a manifest and deletes every recorded work item/tag regardless of run status, then sets `status: "cleaned"`. On normal completion, declining the cleanup prompt leaves the manifest as `in-progress` and prints its path so it can be cleaned up later; confirming sets it to `cleaned`.

`.live-test-runs/` is added to `.gitignore`.

---

## Cleanup Semantics

- **Work items:** soft-deleted (ADO Recycle Bin) rather than permanently destroyed — reversible, and ADO auto-purges the Recycle Bin after 30 days. Permanent destroy is out of scope for this design.
- **Tags:** deleted via the Tags API, which cascades removal from any work item automatically (same mechanism `TagService.deleteTagById` relies on in production).

---

## Reporting

**Console**, printed as each ability completes:

```
== Live Test Report ==
[PASS] List tags + counts      (412ms)
[PASS] Rename tag              (388ms)
[PASS] Merge tags (3->1)       (901ms)
[FAIL] Delete tag              (Analytics count still 1 after 10s poll)
[PASS] Paging/volume (30 tags) (2100ms)

4/5 passed. Report: .live-test-runs/20260915140211-report.json
```

**JSON**, written to `.live-test-runs/<runId>-report.json`:

```json
{
  "runId": "20260915140211",
  "org": "https://dev.azure.com/myorg",
  "project": "TagToolkit-Test",
  "startedAt": "2026-09-15T14:02:11.000Z",
  "finishedAt": "2026-09-15T14:02:16.702Z",
  "results": [
    { "name": "List tags + counts", "status": "pass", "durationMs": 412 },
    { "name": "Delete tag", "status": "fail", "durationMs": 10004, "detail": "Analytics count still 1 after 10s poll" }
  ]
}
```

---

## Safety

- CLI flags only (`--org`, `--project`, `--pat`) — no `.env` fallback for this tool, so the operator must consciously pass a target every run rather than relying on a possibly-stale file.
- Before creating anything, the harness prints the resolved org/project and requires the operator to type the project name to proceed (skippable with `--yes` for repeat/local use).
- All test data lives under a `livetest-<runId>-` prefix, making anything the harness created trivially identifiable in the ADO UI even without the manifest.

---

## Files to Create

| File | Purpose |
|---|---|
| `live-test/cli.ts` | Entry point, flag parsing, confirmation |
| `live-test/adoClient.ts` | PAT-authenticated REST calls |
| `live-test/manifest.ts` | Run manifest read/write |
| `live-test/report.ts` | Console + JSON reporting |
| `live-test/runner.ts` | Orchestration |
| `live-test/abilities/listTagsAndCounts.ts` | Ability test |
| `live-test/abilities/renameTag.ts` | Ability test |
| `live-test/abilities/mergeTags.ts` | Ability test |
| `live-test/abilities/deleteTag.ts` | Ability test |
| `live-test/abilities/pagingVolume.ts` | Ability test |

## Files to Modify

| File | Changes |
|---|---|
| `package.json` | Add `live-test` script; add `azure-devops-node-api` and `tsx` devDependencies |
| `.gitignore` | Add `.live-test-runs/` |
| `README.MD` | Replace the manual "Validate core scenarios" step in the Private Pre-Release Testing Workflow section with instructions to run `pnpm live-test` |

## Out of Scope

- Playwright/UI-level automation against the installed `-develop` extension (Phase 2, separate spec).
- CI integration — this mutates a real Azure DevOps org, so it stays a manually-invoked dev tool, not a pipeline gate.
- Permanent (non-recoverable) deletion of test work items.

---

## Verification

1. Run `pnpm live-test --org <test-org> --project <test-project> --pat <pat>` against a scratch ADO project — confirmation prompt appears, requires typing the project name.
2. All 5 abilities run and report PASS against a clean project.
3. Console summary and `.live-test-runs/<runId>-report.json` both reflect the same results.
4. Decline the cleanup prompt — manifest remains `in-progress`, test work items/tags remain visible in ADO.
5. Run `pnpm live-test --cleanup .live-test-runs/<runId>.json` — all recorded work items/tags are removed, manifest becomes `cleaned`.
6. Kill the process mid-run (e.g. after the merge ability starts) — confirm the manifest on disk reflects everything created up to that point, and `--cleanup` against it removes all of it.
7. Deliberately break one ability's assertion (e.g. point it at a nonexistent tag) — confirm the run continues through the remaining abilities and reports the failure with detail, rather than aborting.
