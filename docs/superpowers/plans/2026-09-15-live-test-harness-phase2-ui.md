# Live Test Harness — Phase 2 (Playwright UI) Implementation Plan

> **Historical status:** Implemented. The `live-test/ui/` files and the
> `pnpm live-test:ui` script are present. The unchecked task list below is
> retained as the original execution record; it is not a current work queue.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Drive the real Tag Toolkit hub, running as the installed `-develop` extension inside a live Azure Boards page, through rename / merge / delete / search / A–Z nav / pagination — covering the React components and pure client-side behaviors that the Phase 1 API harness structurally cannot reach.

**Architecture:** Playwright seeds its fixture data through Phase 1's `AdoClient` and `ManifestStore` (fast, reliable, and reuses the same manifest-driven cleanup), then asserts entirely through the browser. A persistent browser profile keeps the developer's Azure DevOps session between runs, so sign-in happens once by hand rather than being automated. Stable `data-testid` hooks are added to the components first, because targeting azure-devops-ui's rendered DOM directly would be unusably brittle.

**Tech Stack:** `@playwright/test`, Chromium persistent context, TypeScript 5, plus Phase 1's `live-test/adoClient.ts` and `live-test/manifest.ts`.

**Spec:** `docs/superpowers/specs/2026-09-15-live-test-harness-design.md` (the "Phase 2: Playwright UI-Level Automation" section)

## Prerequisites

1. **Phase 1 is complete** on `feature/live-test-harness` — `docs/superpowers/plans/2026-09-15-live-test-harness-phase1.md`. This plan imports `AdoClient`, `ManifestStore`, `newRunId`, `testTag`, `cleanupRun`, and `RUNS_DIR` from it.

   **Phase 1 changed in ways this plan predates — reconcile before executing Task 4 (seeding):**

   - **`cleanupRun` now refuses to delete anything it cannot prove the harness created.** Tags must
     carry the `livetest-` prefix; work items must carry a `[livetest-<runId>] ` title marker or a
     live-test tag. The UI fixtures already use `testTag`-generated names, so tags are fine — but
     `seed.ts` creates work items through `AdoClient.createWorkItem` **directly**, bypassing
     `buildContext.createWorkItem`, which is what applies the title marker. As written, Task 4's
     seeded work items would be **refused at teardown** and the run left `in-progress`. Fix when
     executing: either seed through `buildContext`, or apply the same title marker in `seed.ts`.
     This is the single most important reconciliation in this list.
   - **Cleanup now reports failure.** `cleanupRun` marks a manifest `cleaned` only when nothing was
     refused and every delete resolved. `globalTeardown` should check `store.manifest.status` and
     fail loudly rather than assuming teardown worked.
   - **`getWorkItemTags` throws for the whole batch** if any requested id is unknown or soft-deleted
     (it mirrors the real batch API's default `Fail` error policy). Any fixture code reading back
     ids it may have deleted must handle that per-id.
   - **`WorkItemTags` gained a `title` field**, and `errors.ts` (`NotFoundError`, `isNotFound`) is
     new. Both are available to Phase 2.
   - **Jest's `live-test` project matches `**/*.test.ts` only**, so the Playwright `*.spec.ts` files
     under `live-test/ui/specs/` are already excluded. No config change needed — verify rather than
     re-derive.
2. **The `-develop` extension is installed in the target org** via the existing manual workflow (`pnpm build && pnpm package:test`, then `tfx extension publish --manifest-globs vss-extension-dev.json`). This plan does not automate publishing.
3. **A developer can sign in to that org interactively** in a browser on the machine running the tests.

## Global Constraints

- **Local-only.** Nothing in this plan runs in CI. Do not add Phase 2 to any GitHub Actions workflow.
- **Configuration comes from the environment, not flags**: `LIVE_TEST_ORG`, `LIVE_TEST_PROJECT`, `LIVE_TEST_PAT`. The Playwright CLI owns `argv`, so Phase 1's flags-only rule cannot apply here. Still no `.env` file reading and no `dotenv` dependency — the developer exports the variables or prefixes the command.
- **Every tag created is `livetest-<runId>-ui-<...>`** — same prefix convention as Phase 1, so the same cleanup finds it.
- **Work item deletion is always soft** (Recycle Bin), inherited from `cleanupRun`.
- **Tests run serially** (`workers: 1`, `fullyParallel: false`). They share one project's tag state; parallelism would make them flake against each other.
- **Never assert against azure-devops-ui's internal DOM structure.** Target `data-testid` hooks the project owns, or accessible roles/names.
- **Commit messages** use conventional-commit prefixes and end with a `Co-Authored-By: Claude <model> <noreply@anthropic.com>` trailer naming the model that actually authored the commit.
- **Run `pnpm test` before every commit.** It must be green.

## Deviations From The Spec

1. **Seeding/teardown lives in `live-test/ui/seed.ts`, not `fixtures.ts`.** The spec listed one `fixtures.ts` for both. Playwright needs `globalSetup`/`globalTeardown` to be standalone module entry points, while per-test fixtures are a separate concern; splitting them keeps each file to one responsibility.
2. **`live-test/ui/hub.ts` is added** for hub-URL construction from the manifest. It is the one piece of Phase 2 with logic worth unit-testing in Jest, so it is kept out of the Playwright-only files.
3. **`data-testid` attributes are added to production components (Task 1).** The spec assumed the specs could target the existing UI; they cannot do so reliably. This is a small additive change with no behavior impact.
4. **The A–Z nav spec asserts the "L" bucket and letter-availability, not cross-letter filtering.** Every tag the harness creates starts with `livetest-`, so seeding tags under other letters would violate the prefix convention that cleanup depends on. See Task 9 for what is asserted instead.

## TDD Note For This Plan

The Playwright specs *are* tests — there is no "write a failing test, then implement" cycle for them. The red/green cycle applies to Tasks 1–4 (test ids, URL building, login detection, seeding), which have real units. For the spec tasks (5–10), the cycle is: write the spec, run it against the live org, watch it pass, then deliberately break the precondition to confirm it can fail. A spec that has never been observed failing is not yet a test.

---

### Task 1: Add stable test hooks to the UI components

Playwright cannot reliably target azure-devops-ui's rendered output (`Table`, `Dialog`, `TabBar` all render wrapper DOM the project does not control). Add the project's own hooks by wrapping cell and dialog content in plain elements — never by passing `data-testid` to a library component, which may not forward it.

**Files:**
- Modify: `src/app/TagTable.tsx:95-134` (name cell and count cell renderers)
- Modify: `src/app/AlphaNav.tsx:26-36` (wrap the TabBar)
- Modify: `src/app/DeleteDialog.tsx:33-63` (wrap dialog body)
- Modify: `src/app/MergeDialog.tsx` (wrap dialog body)
- Modify: `src/app/TagManagerApp.tsx:249-310` (page content and pagination)
- Test: `src/app/TagTable.test.tsx` (append), `src/app/TagManagerApp.test.tsx` (append)

**Interfaces:**
- Consumes: nothing.
- Produces: the test id contract every later task depends on —
  - `tag-manager` — the hub root, present once the app has rendered
  - `tag-row` — one per rendered tag name cell, carrying `data-tag-name="<name>"`
  - `tag-count` — one per count cell, carrying `data-tag-name="<name>"`
  - `alpha-nav` — the A–Z tab bar wrapper
  - `pagination`, `pagination-status` — the pager and its "Page X of Y (N tags)" text
  - `delete-dialog`, `merge-dialog` — dialog bodies

- [ ] **Step 1: Write the failing tests**

Append to `src/app/TagTable.test.tsx`:

```tsx
it("exposes a test hook per row carrying the tag name", () => {
  render(
    <TagTable
      tags={[{ id: "1", name: "alpha", url: "" }]}
      selectedIds={new Set()}
      onToggle={() => {}}
      onToggleAll={() => {}}
    />
  );

  const row = document.querySelector('[data-testid="tag-row"]');
  expect(row).not.toBeNull();
  expect(row?.getAttribute("data-tag-name")).toBe("alpha");
});

it("exposes a test hook per count cell carrying the tag name", () => {
  render(
    <TagTable
      tags={[{ id: "1", name: "alpha", url: "", count: 4 }]}
      selectedIds={new Set()}
      onToggle={() => {}}
      onToggleAll={() => {}}
    />
  );

  const cell = document.querySelector('[data-testid="tag-count"][data-tag-name="alpha"]');
  expect(cell?.textContent).toBe("4");
});
```

Append to `src/app/TagManagerApp.test.tsx` (inside the existing top-level `describe`, reusing that file's established render/mock setup):

```tsx
it("exposes a root test hook once the hub has rendered", async () => {
  render(<TagManagerApp />);
  await waitFor(() =>
    expect(document.querySelector('[data-testid="tag-manager"]')).not.toBeNull()
  );
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test -- src/app/TagTable.test.tsx src/app/TagManagerApp.test.tsx`
Expected: FAIL — the queried elements are `null`.

- [ ] **Step 3: Add the hooks to `TagTable.tsx`**

In the `name` column's `renderCell`, wrap the existing conditional in a span:

```tsx
          <span data-testid="tag-row" data-tag-name={item.name}>
            {onRename ? (
              <EditableTagName
                name={item.name}
                onRename={(newName) => onRename(item.id, newName)}
                onCancel={() => {}}
                existingNames={existingNames}
              />
            ) : (
              item.name
            )}
          </span>
```

In the `ColumnFillId` column's `renderCell`, wrap the existing conditional:

```tsx
          <span data-testid="tag-count" data-tag-name={item.name}>
            {item.count === undefined ? (
              <span style={{ color: "var(--palette-neutral-30, #aaa)" }}>—</span>
            ) : (
              String(item.count)
            )}
          </span>
```

- [ ] **Step 4: Add the remaining hooks**

`AlphaNav.tsx` — wrap the returned `<TabBar>`:

```tsx
  return (
    <div data-testid="alpha-nav">
      <TabBar
        selectedTabId={activeFilter ?? "all"}
        onSelectedTabChanged={(id) => onFilter(id === "all" ? null : id)}
        tabSize={TabSize.Compact}
      >
        <Tab id="all" name="All" />
        {availableLetters.map((letter) => (
          <Tab key={letter} id={letter} name={letter} />
        ))}
      </TabBar>
    </div>
  );
```

`DeleteDialog.tsx` — wrap the three children inside `<Dialog>` in `<div data-testid="delete-dialog">…</div>`.

`MergeDialog.tsx` — wrap the dialog's children in `<div data-testid="merge-dialog">…</div>`.

`TagManagerApp.tsx` — add `data-testid="tag-manager"` to the existing `<div className="page-content">`, and in the pagination block:

```tsx
              <div className="tm-pagination" data-testid="pagination">
                <span data-testid="pagination-status">
                  Page {safePage + 1} of {totalPages}
                  {" "}({filteredTags.length} tag{filteredTags.length !== 1 ? "s" : ""})
                </span>
```

- [ ] **Step 5: Run the full suite**

Run: `pnpm test`
Expected: PASS — the new assertions pass and no existing component test regresses (the wrappers preserve text content, so `getByText` queries are unaffected).

- [ ] **Step 6: Commit**

```bash
git add src/app/TagTable.tsx src/app/AlphaNav.tsx src/app/DeleteDialog.tsx src/app/MergeDialog.tsx src/app/TagManagerApp.tsx src/app/TagTable.test.tsx src/app/TagManagerApp.test.tsx
git commit -m "feat: add stable test hooks for UI automation"
```

---

### Task 2: Playwright setup and hub URL resolution

**Files:**
- Create: `live-test/ui/hub.ts`
- Test: `live-test/ui/hub.test.ts`
- Create: `live-test/ui/playwright.config.ts`
- Modify: `package.json` (devDependency + script)
- Modify: `.gitignore`

**Interfaces:**
- Consumes: `vss-extension-dev.json`.
- Produces: `readHubContribution(manifestPath): { publisher, extensionId, contributionId }`, `hubUrl(orgUrl, project, ids): string`, `uiConfigFromEnv(): { orgUrl, project, pat }`.

- [ ] **Step 1: Install Playwright**

```bash
pnpm add -D @playwright/test
pnpm exec playwright install chromium
```

- [ ] **Step 2: Write the failing test**

```typescript
// live-test/ui/hub.test.ts
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { hubUrl, readHubContribution, uiConfigFromEnv } from "./hub";

function writeManifest(contents: object): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "live-test-hub-"));
  const file = path.join(dir, "vss-extension-dev.json");
  fs.writeFileSync(file, JSON.stringify(contents), "utf8");
  return file;
}

describe("readHubContribution", () => {
  it("reads publisher, extension id and hub contribution id from the manifest", () => {
    const file = writeManifest({
      publisher: "josephjohnkarl",
      id: "tag-toolkit-azure-boards-develop",
      contributions: [
        { id: "tag-manager-hub-develop", type: "ms.vss-web.hub" },
      ],
    });

    expect(readHubContribution(file)).toEqual({
      publisher: "josephjohnkarl",
      extensionId: "tag-toolkit-azure-boards-develop",
      contributionId: "tag-manager-hub-develop",
    });
  });

  it("picks the hub contribution when the manifest has several", () => {
    const file = writeManifest({
      publisher: "p",
      id: "e",
      contributions: [
        { id: "some-menu", type: "ms.vss-web.action" },
        { id: "the-hub", type: "ms.vss-web.hub" },
      ],
    });

    expect(readHubContribution(file).contributionId).toBe("the-hub");
  });

  it("throws a clear error when no hub contribution exists", () => {
    const file = writeManifest({ publisher: "p", id: "e", contributions: [] });
    expect(() => readHubContribution(file)).toThrow(/no ms\.vss-web\.hub contribution/);
  });
});

describe("hubUrl", () => {
  it("builds the _apps/hub URL from the three ids", () => {
    expect(
      hubUrl("https://dev.azure.com/myorg", "My Project", {
        publisher: "pub",
        extensionId: "ext",
        contributionId: "hub",
      })
    ).toBe("https://dev.azure.com/myorg/My%20Project/_apps/hub/pub.ext.hub");
  });

  it("tolerates a trailing slash on the org URL", () => {
    expect(
      hubUrl("https://dev.azure.com/myorg/", "P", {
        publisher: "pub",
        extensionId: "ext",
        contributionId: "hub",
      })
    ).toBe("https://dev.azure.com/myorg/P/_apps/hub/pub.ext.hub");
  });
});

describe("uiConfigFromEnv", () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it("reads the three required variables", () => {
    process.env.LIVE_TEST_ORG = "https://dev.azure.com/o";
    process.env.LIVE_TEST_PROJECT = "P";
    process.env.LIVE_TEST_PAT = "x";

    expect(uiConfigFromEnv()).toEqual({
      orgUrl: "https://dev.azure.com/o",
      project: "P",
      pat: "x",
    });
  });

  it("names the missing variable instead of failing obscurely later", () => {
    delete process.env.LIVE_TEST_PAT;
    process.env.LIVE_TEST_ORG = "o";
    process.env.LIVE_TEST_PROJECT = "P";

    expect(() => uiConfigFromEnv()).toThrow(/LIVE_TEST_PAT/);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm test -- live-test/ui/hub.test.ts`
Expected: FAIL — `Cannot find module './hub'`.

- [ ] **Step 4: Write the implementation**

```typescript
// live-test/ui/hub.ts
import * as fs from "node:fs";

export interface HubContribution {
  publisher: string;
  extensionId: string;
  contributionId: string;
}

export interface UiConfig {
  orgUrl: string;
  project: string;
  pat: string;
}

interface ManifestShape {
  publisher: string;
  id: string;
  contributions?: Array<{ id: string; type: string }>;
}

/**
 * Reads the ids that make up a hub URL from the dev manifest rather than
 * hardcoding them, so renaming the extension or its contribution cannot leave
 * the UI tests pointing at a dead URL.
 */
export function readHubContribution(manifestPath: string): HubContribution {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as ManifestShape;
  const hub = (manifest.contributions ?? []).find((c) => c.type === "ms.vss-web.hub");
  if (!hub) {
    throw new Error(`${manifestPath} has no ms.vss-web.hub contribution`);
  }
  return {
    publisher: manifest.publisher,
    extensionId: manifest.id,
    contributionId: hub.id,
  };
}

export function hubUrl(orgUrl: string, project: string, ids: HubContribution): string {
  const base = orgUrl.trim().replace(/\/$/, "");
  const slug = `${ids.publisher}.${ids.extensionId}.${ids.contributionId}`;
  return `${base}/${encodeURIComponent(project)}/_apps/hub/${slug}`;
}

export function uiConfigFromEnv(): UiConfig {
  const read = (name: string): string => {
    const value = process.env[name];
    if (!value) {
      throw new Error(
        `${name} is not set. Phase 2 needs LIVE_TEST_ORG, LIVE_TEST_PROJECT and LIVE_TEST_PAT.`
      );
    }
    return value;
  };
  return {
    orgUrl: read("LIVE_TEST_ORG"),
    project: read("LIVE_TEST_PROJECT"),
    pat: read("LIVE_TEST_PAT"),
  };
}
```

- [ ] **Step 5: Write the Playwright config**

```typescript
// live-test/ui/playwright.config.ts
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./specs",
  // These specs mutate one shared project's tags — they must not race.
  fullyParallel: false,
  workers: 1,
  retries: 0,
  // Generous: every action round-trips to a live Azure DevOps page.
  timeout: 120_000,
  expect: { timeout: 15_000 },
  globalSetup: require.resolve("./globalSetup"),
  globalTeardown: require.resolve("./globalTeardown"),
  reporter: [["list"], ["html", { outputFolder: "../../playwright-report", open: "never" }]],
});
```

- [ ] **Step 6: Add the script and ignore the profile**

Add to `package.json` scripts:

```json
"live-test:ui": "playwright test -c live-test/ui/playwright.config.ts"
```

`.gitignore` already contains `.live-test-runs/` and `playwright-report/` from Phase 1 Task 1 — confirm both lines are present and add them if not.

- [ ] **Step 7: Run the tests to verify they pass**

Run: `pnpm test -- live-test/ui/hub.test.ts`
Expected: PASS — all 7 tests.

- [ ] **Step 8: Commit**

```bash
git add package.json pnpm-lock.yaml .gitignore live-test/ui/hub.ts live-test/ui/hub.test.ts live-test/ui/playwright.config.ts
git commit -m "feat: add playwright config and hub URL resolution"
```

---

### Task 3: Persistent session and login detection

**Files:**
- Create: `live-test/ui/auth.ts`
- Test: `live-test/ui/auth.test.ts`

**Interfaces:**
- Consumes: `@playwright/test` (`chromium`, `BrowserContext`).
- Produces: `PROFILE_DIR: string`, `isSignInUrl(url: string): boolean`, `assertSignedIn(page): Promise<void>`, `launchProfileContext(): Promise<BrowserContext>`.

- [ ] **Step 1: Write the failing test**

Only the pure part is unit-tested; `launchProfileContext` is exercised by the specs themselves.

```typescript
// live-test/ui/auth.test.ts
import { isSignInUrl } from "./auth";

describe("isSignInUrl", () => {
  it("detects the Microsoft account sign-in host", () => {
    expect(isSignInUrl("https://login.microsoftonline.com/common/oauth2/authorize?x=1")).toBe(
      true
    );
  });

  it("detects the consumer live.com sign-in host", () => {
    expect(isSignInUrl("https://login.live.com/oauth20_authorize.srf")).toBe(true);
  });

  it("detects the Azure DevOps signin route", () => {
    expect(isSignInUrl("https://dev.azure.com/myorg/_signin?realm=x")).toBe(true);
  });

  it("does not flag the hub URL itself", () => {
    expect(
      isSignInUrl("https://dev.azure.com/myorg/P/_apps/hub/pub.ext.hub")
    ).toBe(false);
  });

  it("does not flag a tag whose name happens to contain 'signin'", () => {
    expect(isSignInUrl("https://dev.azure.com/myorg/P/_workitems?tag=signin")).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test -- live-test/ui/auth.test.ts`
Expected: FAIL — `Cannot find module './auth'`.

- [ ] **Step 3: Write the implementation**

```typescript
// live-test/ui/auth.ts
import * as path from "node:path";
import { BrowserContext, chromium, Page } from "@playwright/test";

/** Gitignored: lives under .live-test-runs/, which .gitignore already covers. */
export const PROFILE_DIR = path.resolve(
  process.cwd(),
  ".live-test-runs",
  "playwright-profile"
);

const SIGN_IN_HOSTS = ["login.microsoftonline.com", "login.live.com", "login.windows.net"];

export function isSignInUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (SIGN_IN_HOSTS.includes(parsed.hostname)) return true;
  return parsed.pathname.endsWith("/_signin");
}

/**
 * A real browser profile on disk, so the developer signs in once by hand and
 * later runs reuse the session. Headed by default — an expired session can only
 * be renewed by a human looking at the window.
 */
export async function launchProfileContext(): Promise<BrowserContext> {
  return chromium.launchPersistentContext(PROFILE_DIR, {
    headless: process.env.HEADLESS === "1",
    viewport: { width: 1440, height: 900 },
  });
}

/**
 * Fails fast and legibly when the stored session has expired, instead of
 * letting every selector time out against a login form.
 */
export async function assertSignedIn(page: Page): Promise<void> {
  if (isSignInUrl(page.url())) {
    throw new Error(
      "Azure DevOps session has expired. Re-authenticate by running " +
        "`pnpm live-test:ui` with a visible browser (HEADLESS unset) and signing in " +
        "when the window opens, then run the suite again."
    );
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test -- live-test/ui/auth.test.ts`
Expected: PASS — all 5 tests.

- [ ] **Step 5: Commit**

```bash
git add live-test/ui/auth.ts live-test/ui/auth.test.ts
git commit -m "feat: add persistent browser profile and session detection"
```

---

### Task 4: Fixture seeding, teardown, and shared page helpers

**Files:**
- Create: `live-test/ui/seed.ts`
- Test: `live-test/ui/seed.test.ts`
- Create: `live-test/ui/globalSetup.ts`
- Create: `live-test/ui/globalTeardown.ts`
- Create: `live-test/ui/fixtures.ts`

**Interfaces:**
- Consumes: `AdoClient`, `ManifestStore`, `RUNS_DIR`, `newRunId` (Phase 1); `uiConfigFromEnv`, `readHubContribution`, `hubUrl` (Task 2); `launchProfileContext`, `assertSignedIn` (Task 3).
- Produces:
  - `SeedData` — `{ runId: string; manifestPath: string; rename: { old: string; new: string }; merge: { sources: string[]; target: string }; del: string; search: { alpha: string; beta: string }; volume: string[] }`
  - `planSeed(runId): SeedData` (pure, no I/O — the names only)
  - `seedFixtures(): Promise<SeedData>`, `teardownFixtures(): Promise<void>`
  - `SEED_FILE: string`, `readSeed(): SeedData`
  - From `fixtures.ts`: `test` (extended Playwright test), `expect`, `openHub(page)`, `searchFor(page, text)`, `rowFor(page, tagName)`, `rowNames(page)`

- [ ] **Step 1: Write the failing test for the seed plan**

```typescript
// live-test/ui/seed.test.ts
import { planSeed } from "./seed";

describe("planSeed", () => {
  const seed = planSeed("r1");

  it("scopes every name to the run and the ui phase", () => {
    const all = [
      seed.rename.old,
      seed.rename.new,
      ...seed.merge.sources,
      seed.merge.target,
      seed.del,
      seed.search.alpha,
      seed.search.beta,
      ...seed.volume,
    ];
    for (const name of all) {
      expect(name.startsWith("livetest-r1-ui-")).toBe(true);
    }
  });

  it("generates 30 volume tags so pagination has two pages", () => {
    expect(seed.volume).toHaveLength(30);
  });

  it("zero-pads volume tags so they sort predictably", () => {
    expect(seed.volume[0]).toBe("livetest-r1-ui-vol-000");
    expect(seed.volume[29]).toBe("livetest-r1-ui-vol-029");
  });

  it("gives merge two distinct sources and a distinct target", () => {
    expect(new Set([...seed.merge.sources, seed.merge.target]).size).toBe(3);
  });

  it("gives search two distinguishable names", () => {
    expect(seed.search.alpha).not.toBe(seed.search.beta);
  });

  it("produces no duplicate names overall", () => {
    const all = [
      seed.rename.old,
      seed.rename.new,
      ...seed.merge.sources,
      seed.merge.target,
      seed.del,
      seed.search.alpha,
      seed.search.beta,
      ...seed.volume,
    ];
    expect(new Set(all).size).toBe(all.length);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test -- live-test/ui/seed.test.ts`
Expected: FAIL — `Cannot find module './seed'`.

- [ ] **Step 3: Write `seed.ts`**

```typescript
// live-test/ui/seed.ts
import * as fs from "node:fs";
import * as path from "node:path";
import { AdoClient } from "../adoClient";
import { ManifestStore, RUNS_DIR } from "../manifest";
import { newRunId, testTag } from "../naming";
import { cleanupRun } from "../runner";
import { uiConfigFromEnv } from "./hub";

export interface SeedData {
  runId: string;
  manifestPath: string;
  rename: { old: string; new: string };
  merge: { sources: string[]; target: string };
  del: string;
  search: { alpha: string; beta: string };
  volume: string[];
}

export const SEED_FILE = path.join(RUNS_DIR, "ui-seed.json");

/** Pure: decides every name a run will use, with no I/O. */
export function planSeed(runId: string): SeedData {
  const ui = (suffix: string): string => testTag(runId, "ui", suffix);
  return {
    runId,
    manifestPath: path.join(RUNS_DIR, `${runId}.json`),
    rename: { old: ui("rename-old"), new: ui("rename-new") },
    merge: { sources: [ui("merge-a"), ui("merge-b")], target: ui("merge-target") },
    del: ui("delete-a"),
    search: { alpha: ui("search-alpha"), beta: ui("search-beta") },
    volume: Array.from({ length: 30 }, (_, i) => ui(`vol-${String(i).padStart(3, "0")}`)),
  };
}

export function readSeed(): SeedData {
  return JSON.parse(fs.readFileSync(SEED_FILE, "utf8")) as SeedData;
}

/**
 * Creates fixture data through the REST API rather than the UI: the specs are
 * here to test the UI's behavior, not to spend minutes building state through it.
 */
export async function seedFixtures(): Promise<SeedData> {
  const config = uiConfigFromEnv();
  const runId = newRunId(new Date());
  const seed = planSeed(runId);

  const client = new AdoClient({
    orgUrl: config.orgUrl,
    project: config.project,
    pat: config.pat,
  });
  const store = ManifestStore.create(RUNS_DIR, {
    runId,
    org: config.orgUrl,
    project: config.project,
  });

  const create = async (tags: string[], title: string): Promise<void> => {
    const id = await client.createWorkItem("Task", title, tags);
    store.addWorkItem(id);
    for (const tag of tags) store.addTag(tag);
  };

  await create([seed.rename.old], "ui rename #1");
  await create([seed.rename.old], "ui rename #2");
  store.addTag(seed.rename.new); // the rename spec will bring this into existence

  await create([seed.merge.sources[0]], "ui merge a");
  await create([seed.merge.sources[1]], "ui merge b");
  store.addTag(seed.merge.target);

  await create([seed.del], "ui delete #1");
  await create([seed.del], "ui delete #2");

  await create([seed.search.alpha], "ui search alpha");
  await create([seed.search.beta], "ui search beta");

  for (const tag of seed.volume) {
    await create([tag], tag);
  }

  fs.writeFileSync(SEED_FILE, `${JSON.stringify(seed, null, 2)}\n`, "utf8");
  return seed;
}

export async function teardownFixtures(): Promise<void> {
  if (!fs.existsSync(SEED_FILE)) return;
  const seed = readSeed();
  const config = uiConfigFromEnv();
  const store = ManifestStore.open(seed.manifestPath);
  const client = new AdoClient({
    orgUrl: config.orgUrl,
    project: config.project,
    pat: config.pat,
  });

  await cleanupRun(client, store, (m) => console.log(m));
  fs.rmSync(SEED_FILE, { force: true });
}
```

- [ ] **Step 4: Write the global hooks**

```typescript
// live-test/ui/globalSetup.ts
import { seedFixtures } from "./seed";

export default async function globalSetup(): Promise<void> {
  const seed = await seedFixtures();
  console.log(`Seeded UI fixtures for run ${seed.runId}`);
}
```

```typescript
// live-test/ui/globalTeardown.ts
import { teardownFixtures } from "./seed";

export default async function globalTeardown(): Promise<void> {
  await teardownFixtures();
}
```

- [ ] **Step 5: Write the Playwright fixtures and page helpers**

```typescript
// live-test/ui/fixtures.ts
import * as path from "node:path";
import { expect, Locator, Page, test as base } from "@playwright/test";
import { assertSignedIn, launchProfileContext } from "./auth";
import { hubUrl, readHubContribution, uiConfigFromEnv } from "./hub";
import { readSeed, SeedData } from "./seed";

const DEV_MANIFEST = path.resolve(process.cwd(), "vss-extension-dev.json");

export const test = base.extend<{ page: Page; seed: SeedData }>({
  // eslint-disable-next-line no-empty-pattern
  page: async ({}, use) => {
    const context = await launchProfileContext();
    const page = context.pages()[0] ?? (await context.newPage());
    await use(page);
    await context.close();
  },
  // eslint-disable-next-line no-empty-pattern
  seed: async ({}, use) => {
    await use(readSeed());
  },
});

export { expect };

/** Navigates to the installed dev extension's hub and waits for it to render. */
export async function openHub(page: Page): Promise<void> {
  const config = uiConfigFromEnv();
  const ids = readHubContribution(DEV_MANIFEST);
  await page.goto(hubUrl(config.orgUrl, config.project, ids));
  await assertSignedIn(page);
  await page.waitForSelector('[data-testid="tag-manager"]', { timeout: 60_000 });
  // The hub loads tags asynchronously; the first row is the signal it is ready.
  await page.waitForSelector('[data-testid="tag-row"]', { timeout: 60_000 });
}

/** Types into the hub's search box and lets the table settle. */
export async function searchFor(page: Page, text: string): Promise<void> {
  const box = page.getByLabel("Search tags");
  await box.fill(text);
  await expect(page.locator('[data-testid="tag-row"]').first()).toBeVisible();
}

export function rowFor(page: Page, tagName: string): Locator {
  return page.locator(`[data-testid="tag-row"][data-tag-name="${tagName}"]`);
}

export async function rowNames(page: Page): Promise<string[]> {
  return page
    .locator('[data-testid="tag-row"]')
    .evaluateAll((els) => els.map((e) => e.getAttribute("data-tag-name") ?? ""));
}
```

- [ ] **Step 6: Run the unit tests**

Run: `pnpm test -- live-test/ui/seed.test.ts`
Expected: PASS — all 6 tests.

- [ ] **Step 7: Verify seeding against the live org**

```bash
export LIVE_TEST_ORG=https://dev.azure.com/<org>
export LIVE_TEST_PROJECT=<scratch-project>
export LIVE_TEST_PAT=<pat>
pnpm exec tsx -e "import('./live-test/ui/seed').then(m => m.seedFixtures()).then(s => console.log(s.runId))"
```

Expected: a run id prints; the project shows ~39 new Tasks; `.live-test-runs/ui-seed.json` and `.live-test-runs/<runId>.json` both exist.

Then tear it down again:

```bash
pnpm exec tsx -e "import('./live-test/ui/seed').then(m => m.teardownFixtures())"
```

Expected: cleanup lines print; the tags are gone from the project; the manifest reads `"status": "cleaned"`.

- [ ] **Step 8: Commit**

```bash
git add live-test/ui/seed.ts live-test/ui/seed.test.ts live-test/ui/globalSetup.ts live-test/ui/globalTeardown.ts live-test/ui/fixtures.ts
git commit -m "feat: add UI fixture seeding, teardown and page helpers"
```

---

### Task 5: Spec — inline rename

**Files:**
- Create: `live-test/ui/specs/renameTag.spec.ts`

**Interfaces:**
- Consumes: `test`, `expect`, `openHub`, `searchFor`, `rowFor` from `../fixtures`.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Write the spec**

`EditableTagName` renders a button with `aria-label="Rename tag <name>"` that swaps in an input labelled `Edit tag name` — both already exist in the component, so no further production changes are needed.

```typescript
// live-test/ui/specs/renameTag.spec.ts
import { expect, openHub, rowFor, searchFor, test } from "../fixtures";

test("renames a tag inline and shows the new name in the table", async ({ page, seed }) => {
  await openHub(page);
  await searchFor(page, seed.rename.old);

  await expect(rowFor(page, seed.rename.old)).toBeVisible();

  await page.getByLabel(`Rename tag ${seed.rename.old}`).click();
  const input = page.getByLabel("Edit tag name");
  await input.fill(seed.rename.new);
  await input.press("Enter");

  // The table re-sorts and re-renders from the service response.
  await expect(rowFor(page, seed.rename.new)).toBeVisible({ timeout: 30_000 });
  await expect(rowFor(page, seed.rename.old)).toHaveCount(0);
});

test("abandons a rename when the edit is cancelled", async ({ page, seed }) => {
  await openHub(page);
  // The first test already renamed it, so work against the post-rename name.
  await searchFor(page, seed.rename.new);

  await page.getByLabel(`Rename tag ${seed.rename.new}`).click();
  const input = page.getByLabel("Edit tag name");
  await input.fill("livetest-should-never-exist");
  await input.press("Escape");

  await expect(rowFor(page, seed.rename.new)).toBeVisible();
  await expect(rowFor(page, "livetest-should-never-exist")).toHaveCount(0);
});
```

Note the ordering dependency: the second test relies on the first having renamed the tag. `workers: 1` and `fullyParallel: false` make file-order execution deterministic, and both tests live in one file so they always run in sequence.

- [ ] **Step 2: Run it against the live org**

```bash
pnpm live-test:ui -- specs/renameTag.spec.ts
```

Expected: a browser window opens. On the first ever run, sign in when prompted, then re-run. Both tests pass.

- [ ] **Step 3: Confirm the spec can fail**

Temporarily change `seed.rename.new` in the first assertion to a name that is never created (e.g. `"livetest-bogus"`), re-run, and confirm the test fails with a timeout on the missing row rather than passing vacuously. Revert the change.

- [ ] **Step 4: Commit**

```bash
git add live-test/ui/specs/renameTag.spec.ts
git commit -m "test: add inline rename UI spec"
```

---

### Task 6: Spec — merge dialog

**Files:**
- Create: `live-test/ui/specs/mergeTags.spec.ts`

**Interfaces:**
- Consumes: `test`, `expect`, `openHub`, `searchFor`, `rowFor` from `../fixtures`; the `merge-dialog` test id from Task 1.

- [ ] **Step 1: Read the merge dialog's input contract**

Open `src/app/MergeDialog.tsx` and note how the target tag is chosen (a text input or a picker) and the exact label/placeholder text. The selectors below assume a text input for the target name; if the component uses a different control, adapt the two lines that set the target and leave the rest of the spec unchanged.

- [ ] **Step 2: Write the spec**

```typescript
// live-test/ui/specs/mergeTags.spec.ts
import { expect, openHub, rowFor, searchFor, test } from "../fixtures";

test("merges two selected tags into a target tag", async ({ page, seed }) => {
  await openHub(page);
  await searchFor(page, "-ui-merge-");

  // Select both source tags via their row checkboxes.
  for (const source of seed.merge.sources) {
    await expect(rowFor(page, source)).toBeVisible();
  }
  const checkboxes = page.getByRole("checkbox");
  await checkboxes.nth(1).click(); // nth(0) is the select-all header checkbox
  await checkboxes.nth(2).click();

  await page.getByRole("button", { name: /^Merge/ }).click();
  const dialog = page.locator('[data-testid="merge-dialog"]');
  await expect(dialog).toBeVisible();

  await dialog.getByRole("textbox").first().fill(seed.merge.target);
  await page.getByRole("button", { name: /^Merge/ }).last().click();

  await expect(dialog).toBeHidden({ timeout: 60_000 });

  await searchFor(page, "-ui-merge-");
  await expect(rowFor(page, seed.merge.target)).toBeVisible({ timeout: 30_000 });
  for (const source of seed.merge.sources) {
    await expect(rowFor(page, source)).toHaveCount(0);
  }
});

test("cancelling the merge dialog changes nothing", async ({ page, seed }) => {
  await openHub(page);
  await searchFor(page, seed.merge.target);

  await page.getByRole("checkbox").nth(1).click();
  await page.getByRole("button", { name: /^Merge/ }).click();

  const dialog = page.locator('[data-testid="merge-dialog"]');
  await expect(dialog).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();

  await expect(dialog).toBeHidden();
  await expect(rowFor(page, seed.merge.target)).toBeVisible();
});
```

- [ ] **Step 3: Run it against the live org**

```bash
pnpm live-test:ui -- specs/mergeTags.spec.ts
```

Expected: both tests pass. If the target-name control is not a plain textbox, the run fails on the `fill` line — fix the two selector lines identified in Step 1 and re-run.

- [ ] **Step 4: Confirm the spec can fail**

Temporarily assert that a source tag is still visible after the merge (`await expect(rowFor(page, seed.merge.sources[0])).toBeVisible()`), confirm the test fails, then revert.

- [ ] **Step 5: Commit**

```bash
git add live-test/ui/specs/mergeTags.spec.ts
git commit -m "test: add merge dialog UI spec"
```

---

### Task 7: Spec — delete dialog

**Files:**
- Create: `live-test/ui/specs/deleteTag.spec.ts`

**Interfaces:**
- Consumes: `test`, `expect`, `openHub`, `searchFor`, `rowFor`; the `delete-dialog` test id.

- [ ] **Step 1: Write the spec**

`DeleteDialog`'s confirm button text is `Delete N tag`/`Delete N tags`, so the regex below matches either.

```typescript
// live-test/ui/specs/deleteTag.spec.ts
import { expect, openHub, rowFor, searchFor, test } from "../fixtures";

test("deletes a selected tag after confirming the dialog", async ({ page, seed }) => {
  await openHub(page);
  await searchFor(page, seed.del);
  await expect(rowFor(page, seed.del)).toBeVisible();

  await page.getByRole("checkbox").nth(1).click();
  await page.getByRole("button", { name: /^Delete/ }).first().click();

  const dialog = page.locator('[data-testid="delete-dialog"]');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(seed.del);

  await page.getByRole("button", { name: /^Delete \d+ tags?$/ }).click();

  await expect(dialog).toBeHidden({ timeout: 60_000 });
  await searchFor(page, seed.del);
  await expect(rowFor(page, seed.del)).toHaveCount(0);
});

test("cancelling the delete dialog keeps the tag", async ({ page, seed }) => {
  await openHub(page);
  await searchFor(page, seed.search.alpha);

  await page.getByRole("checkbox").nth(1).click();
  await page.getByRole("button", { name: /^Delete/ }).first().click();

  const dialog = page.locator('[data-testid="delete-dialog"]');
  await expect(dialog).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();

  await expect(dialog).toBeHidden();
  await expect(rowFor(page, seed.search.alpha)).toBeVisible();
});
```

- [ ] **Step 2: Run it against the live org**

```bash
pnpm live-test:ui -- specs/deleteTag.spec.ts
```

Expected: both tests pass.

- [ ] **Step 3: Confirm the spec can fail**

Temporarily replace the confirm click with the Cancel click in the first test and confirm it then fails on the final `toHaveCount(0)` assertion. Revert.

- [ ] **Step 4: Commit**

```bash
git add live-test/ui/specs/deleteTag.spec.ts
git commit -m "test: add delete dialog UI spec"
```

---

### Task 8: Spec — search filtering

This is the first spec covering behavior Phase 1 cannot test at all: filtering happens entirely in the browser with no server round-trip.

**Files:**
- Create: `live-test/ui/specs/searchAndFilter.spec.ts`

- [ ] **Step 1: Write the spec**

```typescript
// live-test/ui/specs/searchAndFilter.spec.ts
import { expect, openHub, rowFor, rowNames, searchFor, test } from "../fixtures";

test("filters the table to matching tags as you type", async ({ page, seed }) => {
  await openHub(page);
  await searchFor(page, seed.search.alpha);

  await expect(rowFor(page, seed.search.alpha)).toBeVisible();
  await expect(rowFor(page, seed.search.beta)).toHaveCount(0);

  const names = await rowNames(page);
  expect(names.every((n) => n.includes(seed.search.alpha))).toBe(true);
});

test("matches on any part of the tag name, not just the start", async ({ page, seed }) => {
  await openHub(page);
  await searchFor(page, "search-beta");

  await expect(rowFor(page, seed.search.beta)).toBeVisible();
  await expect(rowFor(page, seed.search.alpha)).toHaveCount(0);
});

test("clearing the search restores the unfiltered table", async ({ page, seed }) => {
  await openHub(page);
  await searchFor(page, seed.search.alpha);
  const filtered = (await rowNames(page)).length;

  await page.getByLabel("Clear search").click();
  await expect(rowFor(page, seed.search.alpha)).toBeVisible();

  const restored = (await rowNames(page)).length;
  expect(restored).toBeGreaterThan(filtered);
});

test("shows no rows for a query that matches nothing", async ({ page }) => {
  await openHub(page);
  await page.getByLabel("Search tags").fill("livetest-definitely-no-such-tag");

  await expect(page.locator('[data-testid="tag-row"]')).toHaveCount(0);
});
```

- [ ] **Step 2: Run it against the live org**

```bash
pnpm live-test:ui -- specs/searchAndFilter.spec.ts
```

Expected: all four tests pass.

- [ ] **Step 3: Confirm the spec can fail**

Temporarily change the third test to assert `restored` is *less* than `filtered` and confirm it fails. Revert.

- [ ] **Step 4: Commit**

```bash
git add live-test/ui/specs/searchAndFilter.spec.ts
git commit -m "test: add search filtering UI spec"
```

---

### Task 9: Spec — A–Z navigation

**Constraint:** every tag this harness creates starts with `livetest-`, because cleanup depends on that prefix. Seeding tags under other letters would break that guarantee, so this spec asserts what can be verified without off-prefix data: that the "L" bucket exists and filters correctly, that "All" restores, and that letters with no tags are not offered. `AlphaNav` only renders letters present in the current tag set (`availableLetters` in `src/app/AlphaNav.tsx`), which is exactly what the third test pins down.

**Files:**
- Create: `live-test/ui/specs/alphaNav.spec.ts`

- [ ] **Step 1: Write the spec**

```typescript
// live-test/ui/specs/alphaNav.spec.ts
import { expect, openHub, rowNames, test } from "../fixtures";

test("filters to tags starting with the selected letter", async ({ page }) => {
  await openHub(page);

  await page.locator('[data-testid="alpha-nav"]').getByText("L", { exact: true }).click();

  const names = await rowNames(page);
  expect(names.length).toBeGreaterThan(0);
  expect(names.every((n) => n.toUpperCase().startsWith("L"))).toBe(true);
});

test("the All tab restores every tag", async ({ page }) => {
  await openHub(page);
  const nav = page.locator('[data-testid="alpha-nav"]');

  await nav.getByText("L", { exact: true }).click();
  const filtered = (await rowNames(page)).length;

  await nav.getByText("All", { exact: true }).click();
  const all = (await rowNames(page)).length;

  expect(all).toBeGreaterThanOrEqual(filtered);
});

test("offers only letters that have tags", async ({ page }) => {
  await openHub(page);
  const nav = page.locator('[data-testid="alpha-nav"]');

  // Every seeded tag starts with "l", so L is always offered.
  await expect(nav.getByText("L", { exact: true })).toBeVisible();

  // Q is offered only if the project genuinely has a tag starting with Q.
  const namesStartingWithQ = (await rowNames(page)).filter((n) =>
    n.toUpperCase().startsWith("Q")
  );
  const qVisible = await nav.getByText("Q", { exact: true }).isVisible().catch(() => false);
  expect(qVisible).toBe(namesStartingWithQ.length > 0);
});
```

- [ ] **Step 2: Run it against the live org**

```bash
pnpm live-test:ui -- specs/alphaNav.spec.ts
```

Expected: all three tests pass. Note the third test reads only the current page of rows, so it is meaningful on a scratch project and tolerant on a busy one.

- [ ] **Step 3: Confirm the spec can fail**

Temporarily change the first test's assertion to `startsWith("Z")` and confirm it fails. Revert.

- [ ] **Step 4: Commit**

```bash
git add live-test/ui/specs/alphaNav.spec.ts
git commit -m "test: add A-Z navigation UI spec"
```

---

### Task 10: Spec — pagination

The seed creates 30 volume tags specifically so a filtered view exceeds the 25-per-page size (`PAGE_SIZE = 25` in `src/app/TagManagerApp.tsx`). Searching for the volume prefix isolates them from whatever else lives in the project, which makes the page counts deterministic.

**Files:**
- Create: `live-test/ui/specs/pagination.spec.ts`

- [ ] **Step 1: Write the spec**

```typescript
// live-test/ui/specs/pagination.spec.ts
import { expect, openHub, rowNames, searchFor, test } from "../fixtures";

const VOLUME_QUERY = "-ui-vol-";

test("splits a 30-tag result into two pages of 25 and 5", async ({ page }) => {
  await openHub(page);
  await searchFor(page, VOLUME_QUERY);

  await expect(page.locator('[data-testid="pagination-status"]')).toHaveText(
    /Page 1 of 2 \(30 tags\)/
  );
  expect(await rowNames(page)).toHaveLength(25);

  await page.getByRole("button", { name: "Next" }).click();

  await expect(page.locator('[data-testid="pagination-status"]')).toHaveText(
    /Page 2 of 2 \(30 tags\)/
  );
  expect(await rowNames(page)).toHaveLength(5);
});

test("Previous returns to the first page", async ({ page }) => {
  await openHub(page);
  await searchFor(page, VOLUME_QUERY);

  await page.getByRole("button", { name: "Next" }).click();
  await expect(page.locator('[data-testid="pagination-status"]')).toHaveText(/Page 2 of 2/);

  await page.getByRole("button", { name: "Previous" }).click();
  await expect(page.locator('[data-testid="pagination-status"]')).toHaveText(/Page 1 of 2/);
});

test("Previous is disabled on the first page and Next on the last", async ({ page }) => {
  await openHub(page);
  await searchFor(page, VOLUME_QUERY);

  await expect(page.getByRole("button", { name: "Previous" })).toBeDisabled();

  await page.getByRole("button", { name: "Next" }).click();
  await expect(page.getByRole("button", { name: "Next" })).toBeDisabled();
});

test("hides the pager when a filter leaves a single page", async ({ page, seed }) => {
  await openHub(page);
  await searchFor(page, seed.volume[0]);

  await expect(page.locator('[data-testid="pagination"]')).toHaveCount(0);
});
```

- [ ] **Step 2: Run it against the live org**

```bash
pnpm live-test:ui -- specs/pagination.spec.ts
```

Expected: all four tests pass.

- [ ] **Step 3: Run the whole suite end to end**

```bash
pnpm live-test:ui
```

Expected: `globalSetup` seeds fixtures, all six spec files run in order, `globalTeardown` deletes every seeded work item and tag, and the run manifest ends as `"status": "cleaned"`. Confirm in the Azure DevOps UI that no `livetest-` tags remain.

- [ ] **Step 4: Commit**

```bash
git add live-test/ui/specs/pagination.spec.ts
git commit -m "test: add pagination UI spec"
```

---

### Task 11: Documentation

**Files:**
- Modify: `README.MD` (the "Live Testing" section added by Phase 1 Task 17)

**Interfaces:**
- Consumes: the `live-test:ui` script.
- Produces: nothing.

- [ ] **Step 1: Add a UI subsection to the README**

Insert at the end of the "Live Testing" section, before "Running it in CI":

```markdown
### UI-level tests (local only)

The Playwright suite drives the installed `-develop` extension's real hub in a
browser, covering the components and the client-side behaviors — search, A–Z
navigation, pagination — that the API harness cannot reach.

Prerequisites:

1. The `-develop` extension is installed in the target org (see Private
   Pre-Release Testing Workflow).
2. You can sign in to that org interactively on this machine.

```bash
export LIVE_TEST_ORG=https://dev.azure.com/<org>
export LIVE_TEST_PROJECT=<scratch-project>
export LIVE_TEST_PAT=<pat>
pnpm live-test:ui
```

The first run opens a browser window — sign in when prompted, then run the
command again. The session is stored in `.live-test-runs/playwright-profile/`
and reused afterwards. When it expires, the suite fails with a message telling
you to sign in again rather than hanging on a login form.

Fixture data is seeded through the REST API before the suite and removed after
it, using the same run manifest as the API harness. If a run is interrupted
before teardown, clean up with `pnpm live-test --cleanup-all --pat <pat>`.

These tests are deliberately **not** part of CI: Azure DevOps sign-in is
interactive, and automating it would need either a fragile stored session or a
tenant-admin-provisioned service principal.
```

- [ ] **Step 2: Verify the rendered section reads correctly**

Run: `grep -n "UI-level tests" README.MD`
Expected: one match, inside the Live Testing section and before the CI subsection.

- [ ] **Step 3: Run the full unit suite one last time**

Run: `pnpm test`
Expected: PASS — Jest runs the `extension` and `live-test` projects and does not attempt to execute any `*.spec.ts` Playwright file.

- [ ] **Step 4: Commit**

```bash
git add README.MD
git commit -m "docs: document the Playwright UI live test suite"
```

---

## Self-Review Notes

Checked against `docs/superpowers/specs/2026-09-15-live-test-harness-design.md`:

- **Spec coverage** — Purpose and component list (Task 1 plus Tasks 5–10), prerequisite that the dev extension is installed (Prerequisites, Task 11 docs), persistent-context authentication with fail-fast on expiry (Task 3), hub URL read from `vss-extension-dev.json` rather than hardcoded (Task 2), the specced file structure (Tasks 2–10), fixtures reusing `adoClient`/`manifest` instead of reimplementing REST logic (Task 4), Playwright's own reporters rather than Phase 1's JSON schema (Task 2 config), `pnpm live-test:ui` invocation (Task 2), and README updates (Task 11). The spec's six spec files map one-to-one onto Tasks 5–10.
- **Placeholder scan** — one intentional open variable: Task 6 Step 1 has the implementer read `MergeDialog.tsx` for the target-name control before running, because the dialog's input type determines two selector lines. The step states exactly which lines to adapt and what failure indicates a mismatch, rather than leaving the spec vague.
- **Type consistency** — `SeedData` is declared once in `seed.ts` and consumed by `fixtures.ts` and every spec via the `seed` fixture; `planSeed` is the single source of every name, so a rename there propagates without touching the specs. `openHub`/`searchFor`/`rowFor`/`rowNames` have one definition each in `fixtures.ts` and identical usage across the six spec files.
- **Cross-plan dependency** — this plan imports `AdoClient`, `ManifestStore`, `RUNS_DIR`, `newRunId`, `testTag`, and `cleanupRun` from Phase 1. Every one of those is a named export produced by a Phase 1 task (Tasks 1, 3, 6, 7, 15).
- **Known limitation, stated in the plan** — the A–Z spec cannot test cross-letter filtering without violating the `livetest-` prefix convention that cleanup depends on (Task 9).
