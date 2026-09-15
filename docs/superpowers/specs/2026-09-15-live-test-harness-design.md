# Live Test Harness

**Date:** 2026-09-15
**Branch:** feature/live-test-harness

## Context

Validating the extension against a real Azure DevOps org today is manual: the README's "Private Pre-Release Testing Workflow" says to install the `-develop` extension and click through merge/rename/delete/count/paging by hand. This design adds a standalone, PAT-authenticated Node/TypeScript harness that exercises the same server-side behavior the extension relies on — creating its own test work items and tags, asserting each ability's contract, reporting pass/fail with detail, and prompting to clean up everything it created.

This spec covers three parts:
- **Phase 1 (API-level):** a PAT-authenticated harness that exercises the server-side contract directly (Tags API, Work Item Tracking, Analytics OData). Runnable both locally and unattended.
- **Phase 2 (UI-level):** Playwright automation against the actual installed `-develop` extension's UI, covering what Phase 1 structurally cannot — the real React components and the pure client-side behaviors (search, A-Z nav, pagination). Local-only, developer-run (see [Phase 2](#phase-2-playwright-ui-level-automation) for why it can't run unattended).
- **CI integration:** a GitHub Actions workflow that runs Phase 1 (only) on manual dispatch, gated by a GitHub Environment.

### Why API-level, not UI-level, for Phase 1

`TagService` and `TagCountCacheService` are built on `azure-devops-extension-api`'s `getClient()` and `SDK.getAccessToken()`/`SDK.getHost()`/`SDK.getService()`, which require the extension to be running inside an ADO iframe host handshake (`SDK.init()`). They cannot run in a standalone Node process. Reusing that code directly for a live-test script is not possible without a production refactor larger than this task warrants, so the harness re-implements the same REST semantics against the live APIs instead of importing `TagService`.

**Trade-off, stated plainly:** the harness's REST calls are a parallel implementation, not the same code path as the shipped extension. If `TagService`'s API usage changes (a new field, a different endpoint, a changed API version), this harness will not automatically reflect that — it needs a matching update. It validates the *contract* the extension depends on (Tags API, Work Item Tracking, Analytics OData), not the extension's own code.

---

## Phase 1: API-Level Harness

### Architecture

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

#### Why `azure-devops-node-api` + raw fetch, not `azure-devops-extension-api`

`azure-devops-node-api` is Microsoft's official PAT-based Node client, built for exactly this use case (unlike `azure-devops-extension-api`, which assumes an iframe host). It's added as a new devDependency and used for standard Work Item Tracking operations (create/get/update/delete work items, WIQL). The Tags API (`_apis/wit/tags`) and the Analytics OData counts endpoint aren't wrapped by a typed client method, so those two are raw `fetch` calls with PAT Basic auth (`Authorization: Basic base64(":" + pat)`), using the same URLs and `api-version=7.1` already used in [TagService.ts](../../../src/services/TagService.ts) and [TagCountCacheService.ts](../../../src/services/TagCountCacheService.ts).

---

### New Directory: `live-test/`

Sibling to `src/`, **not** included in the webpack bundle or the packaged `.vsix`. Run via `tsx` (new devDependency, added purely for local script execution — no build step needed for this tooling).

| File                             | Responsibility                                                                                                                       |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `cli.ts`                         | Flag parsing (`--org`, `--project`, `--pat`, `--yes`, `--cleanup`, `--work-item-type`), confirmation prompt, dispatch to `runner.ts` |
| `adoClient.ts`                   | PAT-authenticated calls: Tags API CRUD, Analytics OData counts, WIT create/get/update/delete/WIQL (via `azure-devops-node-api`)      |
| `manifest.ts`                    | Read/write `.live-test-runs/<runId>.json`; append-as-created semantics so a crash never loses track of what exists                   |
| `report.ts`                      | Console table renderer (live per-ability line + summary) and JSON report writer                                                      |
| `runner.ts`                      | Orchestration: confirm → run abilities sequentially, continue on failure → report → prompt cleanup → cleanup                         |
| `abilities/listTagsAndCounts.ts` | List-tags + live-count contract                                                                                                      |
| `abilities/renameTag.ts`         | Rename contract                                                                                                                      |
| `abilities/mergeTags.ts`         | Multi-source atomic merge contract                                                                                                   |
| `abilities/deleteTag.ts`         | Delete/cascade contract                                                                                                              |
| `abilities/pagingVolume.ts`      | List-API-under-volume contract                                                                                                       |

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

### Test Data & Isolation

Every ability owns a private tag namespace prefixed `livetest-<runId>-<ability>-...` (e.g. `livetest-20260915140211-merge-a`) and creates its own `Task` work items (default; overridable via `--work-item-type` for non-standard process templates). No ability depends on another's data — a failure in one doesn't block or corrupt the others, and cleanup is simply "delete everything this run's manifest recorded."

#### Ability: List tags + live counts
1. Create 3 Tasks tagged `livetest-<run>-count`.
2. Call the Tags API list — assert the tag is present.
3. Call the Analytics OData counts endpoint (poll, see below) — assert count is exactly 3.

#### Ability: Rename
1. Create 2 Tasks tagged `livetest-<run>-rename-old`.
2. Rename via the Tags API to `livetest-<run>-rename-new`.
3. WIQL-query both work items — assert both now carry the new tag name and not the old one.

#### Ability: Merge (atomic two-phase)
1. Create Tasks across 3 source tags (`livetest-<run>-merge-a/b/c`), with at least one work item carrying two of the three sources, to exercise de-duplication.
2. Merge all 3 sources into `livetest-<run>-merge-target`.
3. Assert: every affected work item now carries the target tag exactly once; all 3 source tags no longer exist in the project; a work item that already had the target tag before merging wasn't given a duplicate.

#### Ability: Delete (cascade)
1. Create 2 Tasks tagged `livetest-<run>-delete`.
2. Delete the tag via the Tags API.
3. Assert: the tag no longer appears in the Tags API list; both work items no longer carry it.

#### Ability: Paging/volume
1. Create ~30 uniquely-named tags (`livetest-<run>-vol-000` … `vol-029`), one Task each.
2. Call the Tags API list.
3. Assert all 30 are present and correctly named — validates the list endpoint's behavior under a larger tag set. (This does not test the UI paging component, `AlphaNav`, or search — those are covered by Phase 2.)

---

### Eventual Consistency

The Analytics OData endpoint lags behind OLTP writes by an unpredictable amount. Any assertion reading from Analytics (only the "list + counts" ability) uses a poll-with-timeout helper: retry every 2 seconds, up to 30 seconds total. A timeout is reported as a `fail` with the last observed value and elapsed time, not a hang or an exception.

---

### Manifest & Crash Recovery

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

### Cleanup Semantics

- **Work items:** soft-deleted (ADO Recycle Bin) rather than permanently destroyed — reversible, and ADO auto-purges the Recycle Bin after 30 days. Permanent destroy is out of scope for this design.
- **Tags:** deleted via the Tags API, which cascades removal from any work item automatically (same mechanism `TagService.deleteTagById` relies on in production).

---

### Reporting

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

### Safety

- CLI flags only (`--org`, `--project`, `--pat`) — no `.env` fallback for this tool, so the operator must consciously pass a target every run rather than relying on a possibly-stale file.
- Before creating anything, the harness prints the resolved org/project and requires the operator to type the project name to proceed (skippable with `--yes` for repeat/local use).
- All test data lives under a `livetest-<runId>-` prefix, making anything the harness created trivially identifiable in the ADO UI even without the manifest.
- `cli.ts` exits non-zero if any ability reports `fail`, and zero only if every ability passed — this is load-bearing for CI (below), which relies on the process exit code to determine job success.

---

## Phase 2: Playwright UI-Level Automation

Local-only, developer-run — not part of CI. Azure DevOps sign-in is normal interactive Microsoft/AAD login, which can't be driven headlessly in an unattended pipeline without either a fragile pre-captured session or a tenant-admin-provisioned service principal; neither was worth the setup cost here, so this phase stays a manual tool.

### Purpose

Validates what Phase 1 structurally cannot reach: the actual React components (`TagTable`, `MergeDialog`, `DeleteDialog`, `EditableTagName`, `SearchBar`, `AlphaNav`) rendered inside a real ADO Boards page, plus the pure client-side behaviors that involve no server round-trip (search filtering, A-Z navigation, pagination) — today covered only by Jest tests against mocked data.

### Prerequisite

The `-develop` extension must already be installed in the target org, via the existing manual "Private Pre-Release Testing Workflow" in the README (`pnpm package:test` + `tfx extension publish --manifest-globs vss-extension-dev.json`). This design does not automate publishing or installing the extension — that stays a deliberate, separate manual step, consistent with Phase 2 being a local, human-driven tool.

### Authentication

Playwright launches a **persistent browser context** (`launchPersistentContext`) pointed at a local, gitignored profile directory (`.live-test-runs/playwright-profile/`). On first run (or after the session expires), the browser opens headed and the script pauses with an on-screen prompt for the developer to log in by hand; the session persists in the profile directory for subsequent runs. If a run detects it's been redirected to a Microsoft login page (session expired), it fails fast with a clear "re-authenticate: run with `--headed` to log in again" message rather than hanging or retrying blindly.

### Navigating to the hub

The extension hub isn't at a guessable URL by convention — it's `https://dev.azure.com/{org}/{project}/_apps/hub/{publisher}.{extensionId}.{contributionId}`. Rather than hardcoding these three IDs (and risking drift), the harness reads `publisher`, the dev `id`, and the hub's `contributions[].id` straight out of `vss-extension-dev.json`.

### Structure

```
live-test/ui/
  playwright.config.ts
  fixtures.ts               — global setup/teardown: creates scoped test work items/tags
                               via live-test/adoClient.ts + live-test/manifest.ts (reuses
                               Phase 1 infrastructure rather than duplicating REST logic),
                               tears them down after the suite via the same manifest-driven
                               cleanup
  auth.ts                    — persistent-context / login-detection helper
  specs/
    renameTag.spec.ts        — click EditableTagName, type a new name, confirm it commits
                                and the table reflects it immediately
    mergeTags.spec.ts        — select multiple tags, open MergeDialog, confirm, verify
                                resulting table state
    deleteTag.spec.ts        — select tag(s), open DeleteDialog, confirm, verify removed
    searchAndFilter.spec.ts  — type in SearchBar, verify the table filters client-side
    alphaNav.spec.ts         — click a letter, verify the table jumps/filters accordingly
    pagination.spec.ts       — with 25+ tags present, verify 25-per-page paging behavior
```

Fixture data creation/teardown reuses Phase 1's `adoClient.ts`/`manifest.ts` (same `livetest-<runId>-ui-...` prefix convention), so this phase never reimplements REST logic — Playwright specs only drive and assert against the browser.

### Reporting

Playwright's own built-in reporters (`list` for console, `html` for a browsable local report) are used as-is rather than forcing UI results into Phase 1's JSON schema — the two phases have naturally different output shapes, and Phase 2 output is never machine-consumed by CI.

### Invocation

`pnpm live-test:ui` (optionally `-- --headed` to force a visible browser, e.g. for re-authenticating).

---

## CI Integration (Phase 1 only)

Phase 2 stays local-only per the authentication constraint above; only the Phase 1 API-level harness runs in CI.

### Trigger

`.github/workflows/live-test.yml`, triggered only by `workflow_dispatch` (manual "Run workflow" in the Actions tab) — no schedule, no PR trigger. This keeps a human deliberately choosing to mutate the live org on each run.

### GitHub Environment gate

The job targets a GitHub Environment named `live-test`, configured once, manually, by a repo admin, in repository settings (outside this codebase) with:
- **Secret:** `AZDO_TEST_PAT`
- **Variables:** `AZDO_TEST_ORG_URL`, `AZDO_TEST_PROJECT`
- **Protection rule:** required reviewers, so triggering the workflow requests approval before the environment's secret/variables are exposed to the job

This approval step substitutes for the CLI's interactive "type the project name" confirmation, which has no terminal to run in during a GitHub Actions job — someone still has to deliberately let the run proceed, just earlier (approving the deployment) rather than at a prompt. The workflow always passes `--yes`.

### Workflow steps

1. Checkout, setup Node + pnpm, `pnpm install --frozen-lockfile`
2. `pnpm live-test --org "$AZDO_TEST_ORG_URL" --project "$AZDO_TEST_PROJECT" --pat "$AZDO_TEST_PAT" --yes`
3. `if: always()` — upload the run's JSON report and manifest (`.live-test-runs/*`) as workflow artifacts, so failures are inspectable without re-running
4. `if: failure()` — re-run `pnpm live-test --cleanup .live-test-runs/<runId>.json` so a mid-run failure (network blip, one ability's assertion timing out) still cleans up test data, since there's no one to see an interactive prompt

### Exit codes

Relies on the `cli.ts` exit-code contract noted under [Safety](#safety): non-zero if any ability failed, so the GitHub Actions job goes red on a real regression, not just on a crash.

---

## Files to Create

| File                                         | Purpose                                                                   |
| -------------------------------------------- | ------------------------------------------------------------------------- |
| `live-test/cli.ts`                           | Entry point, flag parsing, confirmation                                   |
| `live-test/adoClient.ts`                     | PAT-authenticated REST calls                                              |
| `live-test/manifest.ts`                      | Run manifest read/write                                                   |
| `live-test/report.ts`                        | Console + JSON reporting                                                  |
| `live-test/runner.ts`                        | Orchestration                                                             |
| `live-test/abilities/listTagsAndCounts.ts`   | Ability test                                                              |
| `live-test/abilities/renameTag.ts`           | Ability test                                                              |
| `live-test/abilities/mergeTags.ts`           | Ability test                                                              |
| `live-test/abilities/deleteTag.ts`           | Ability test                                                              |
| `live-test/abilities/pagingVolume.ts`        | Ability test                                                              |
| `live-test/ui/playwright.config.ts`          | Playwright project config (Phase 2)                                       |
| `live-test/ui/fixtures.ts`                   | Global setup/teardown, reusing `adoClient.ts`/`manifest.ts` (Phase 2)     |
| `live-test/ui/auth.ts`                       | Persistent-context login/session-expiry handling (Phase 2)                |
| `live-test/ui/specs/renameTag.spec.ts`       | UI ability test (Phase 2)                                                 |
| `live-test/ui/specs/mergeTags.spec.ts`       | UI ability test (Phase 2)                                                 |
| `live-test/ui/specs/deleteTag.spec.ts`       | UI ability test (Phase 2)                                                 |
| `live-test/ui/specs/searchAndFilter.spec.ts` | UI ability test (Phase 2)                                                 |
| `live-test/ui/specs/alphaNav.spec.ts`        | UI ability test (Phase 2)                                                 |
| `live-test/ui/specs/pagination.spec.ts`      | UI ability test (Phase 2)                                                 |
| `.github/workflows/live-test.yml`            | CI workflow: manual dispatch, gated by the `live-test` GitHub Environment |

## Files to Modify

| File           | Changes                                                                                                                                                                                                                                    |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `package.json` | Add `live-test` and `live-test:ui` scripts; add `azure-devops-node-api`, `tsx`, and `@playwright/test` devDependencies                                                                                                                     |
| `.gitignore`   | Add `.live-test-runs/` (covers the run manifests/reports and the Playwright persistent profile) and the Playwright HTML report output dir                                                                                                  |
| `README.MD`    | Replace the manual "Validate core scenarios" step in the Private Pre-Release Testing Workflow section with instructions to run `pnpm live-test` and `pnpm live-test:ui`; document the one-time `live-test` GitHub Environment setup for CI |

## Out of Scope

- CI integration for Phase 2 (Playwright) — AAD-backed org sign-in isn't headless-friendly without disproportionate setup cost; stays a manually-run local tool.
- Automated publishing/installation of the `-develop` extension into the target org — remains the existing manual README workflow; Phase 2 assumes it's already installed.
- Permanent (non-recoverable) deletion of test work items — cleanup always soft-deletes to the Recycle Bin.
- Creation of the GitHub Environment and its protection rules — a one-time manual repo-settings action, not something this codebase configures.

---

## Verification

### Phase 1
1. Run `pnpm live-test --org <test-org> --project <test-project> --pat <pat>` against a scratch ADO project — confirmation prompt appears, requires typing the project name.
2. All 5 abilities run and report PASS against a clean project.
3. Console summary and `.live-test-runs/<runId>-report.json` both reflect the same results.
4. Decline the cleanup prompt — manifest remains `in-progress`, test work items/tags remain visible in ADO.
5. Run `pnpm live-test --cleanup .live-test-runs/<runId>.json` — all recorded work items/tags are removed, manifest becomes `cleaned`.
6. Kill the process mid-run (e.g. after the merge ability starts) — confirm the manifest on disk reflects everything created up to that point, and `--cleanup` against it removes all of it.
7. Deliberately break one ability's assertion (e.g. point it at a nonexistent tag) — confirm the run continues through the remaining abilities and reports the failure with detail, rather than aborting.

### Phase 2
8. Run `pnpm live-test:ui` locally against an org with the `-develop` extension installed — first run pauses for manual login; subsequent runs reuse the persisted session without prompting.
9. Each spec (rename, merge, delete, search, A-Z nav, pagination) passes against a project seeded via the shared Phase 1 fixture infrastructure, and fixture data is cleaned up after the suite via the same manifest mechanism.
10. Manually expire the session (clear the profile directory) — confirm the next run fails fast with the re-authenticate message instead of hanging.

### CI
11. Trigger `.github/workflows/live-test.yml` manually in GitHub Actions — the job waits for `live-test` environment approval, then runs, uploads the report/manifest as artifacts, and goes red if an ability fails.
12. Force a mid-run failure in the CI job — confirm the `if: failure()` step still runs `--cleanup` against the manifest and removes test data.
