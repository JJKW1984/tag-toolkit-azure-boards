# Live Test Harness — Phase 1 (API-Level) + CI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a PAT-authenticated Node CLI that creates real work items and tags in a live Azure DevOps project, asserts each server-backed ability of the extension (list+counts, rename, merge, delete, volume), reports pass/fail, and cleans up after itself — plus a manually-triggered GitHub Actions workflow that runs it behind an environment approval gate.

**Architecture:** A standalone `live-test/` directory (Node-only, never bundled into the `.vsix`) built from small single-responsibility modules: a REST client (`adoClient.ts`), a crash-safe run manifest (`manifest.ts`), a poll helper for Analytics lag (`poll.ts`), a reporter (`report.ts`), a CLI front end (`cli.ts`), and an orchestrator (`runner.ts`). Five ability modules depend only on an `IAdoClient` interface, so each is unit-tested against an in-memory fake that models ADO's tag semantics, and only the final wiring task touches the network.

**Tech Stack:** TypeScript 5, Node 24 (global `fetch`, `node:util` `parseArgs`), `tsx` (run TS directly, no build step), `azure-devops-node-api` (PAT-based Work Item Tracking), Jest + ts-jest (unit tests, new `node`-environment project alongside the existing `jsdom` one).

**Spec:** `docs/superpowers/specs/2026-09-15-live-test-harness-design.md`

## Global Constraints

- **Node 24 / pnpm 9** — matches `.github/workflows/build.yml`. Global `fetch` and `node:util` `parseArgs` are available; do not add an HTTP or arg-parsing dependency.
- **Azure DevOps REST `api-version=7.1`** for every raw call — identical to `src/services/TagService.ts`.
- **Analytics OData endpoint:** `https://analytics.dev.azure.com/{org}/_odata/v4.0-preview/WorkItems` — identical base to `src/services/TagCountCacheService.ts`.
- **Tag naming:** every tag the harness creates is `livetest-<runId>-<ability>-<suffix>`. Cleanup and manual identification both depend on this prefix.
- **Work item deletion is always soft** (ADO Recycle Bin). Never pass a destroy/permanent-delete flag.
- **Credentials come from CLI flags only** (`--org`, `--project`, `--pat`). Never read `.env`, and never add a `dotenv` dependency.
- **Every error string that reaches a report, a log line, or a manifest must pass through `sanitizeError` from `src/utils/sanitizeError.ts`** — the harness holds a PAT and its reports are uploaded as CI artifacts.
- **Exit codes:** `0` only if every ability passed; non-zero otherwise. CI depends on this.
- **Commit messages** use conventional-commit prefixes (`feat:`, `fix:`, `docs:`, `test:`, `chore:`) and end with a `Co-Authored-By: Claude <model> <noreply@anthropic.com>` trailer naming the model that actually authored the commit (e.g. `Claude Haiku 4.5`, `Claude Opus 5`). Accurate authorship beats a uniform string.
- **Run `pnpm test` before every commit.** It must be green.

## Deviations From The Spec (approved as part of this plan)

1. **`live-test/types.ts` and `live-test/naming.ts` are added** beyond the spec's file list. The spec sketched the ability interfaces inline; putting shared interfaces in their own module avoids circular imports between `manifest`/`report`/`runner`, and `naming.ts` isolates the cleanup-critical tag-prefix convention so it can be tested once.
2. **`AbilityContext` exposes `createWorkItem()` / `recordTag()` callbacks instead of a raw `manifest` object.** Abilities must never write to disk directly; funnelling creation through the context is what guarantees every created item is recorded the instant it exists.
3. **A `--cleanup-all` flag is added.** The spec's CI step says `--cleanup .live-test-runs/<runId>.json`, but a workflow has no way to know the generated `runId`. `--cleanup-all` sweeps every manifest in `.live-test-runs/` still marked `in-progress`, which makes the specced CI failure-cleanup step implementable and is useful locally too.
4. **`parseTags`/`joinTags` are extracted from `TagService.ts` into `src/utils/tagString.ts`** and imported by both production code and the harness. The spec flagged "parallel implementation drift" as a known risk; sharing the single most semantically important piece (how ADO encodes the `System.Tags` string) removes the worst of that risk for a two-line production refactor.
5. **The Analytics query adds a server-side `$filter` on the tag name.** `TagCountCacheService.fetchCounts` pages through every tagged work item in the whole org, which on a real org is slow enough to make a test harness unusable. The harness uses the same endpoint, `$select` and `$expand` shape, plus `$filter=Tags/any(t: t/TagName eq '<tag>')`. It tests the same contract ("Analytics reports the right count for this tag") in one request.

---

### Task 1: Scaffolding — dependencies, TypeScript config, Jest project, tag naming

Sets up everything the rest of the plan needs, and proves the new test pipeline works by landing one real, tested module (`naming.ts`).

**Files:**
- Create: `tsconfig.live-test.json`
- Create: `live-test/naming.ts`
- Test: `live-test/naming.test.ts`
- Modify: `jest.config.cjs` (whole file — restructured into `projects`)
- Modify: `package.json` (devDependencies)
- Modify: `.gitignore`

**Interfaces:**
- Consumes: nothing.
- Produces: `testTag(runId, ability, suffix): string`, `newRunId(now: Date): string`, `LIVE_TEST_PREFIX: string`. Every ability task uses `testTag`.

- [ ] **Step 1: Install dependencies**

```bash
pnpm add -D azure-devops-node-api tsx
```

- [ ] **Step 2: Create `tsconfig.live-test.json`**

`target`/`lib` are ES2022 (not the extension's ES2017) because this code runs on Node 24, never in a browser. `types: ["node", "jest"]` is what supplies the global `fetch` typings. `src/utils` and `src/types` are included because the harness imports `sanitizeError`, `tagString`, and `TagItem` from them.

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "lib": ["ES2022"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "types": ["node", "jest"],
    "noEmit": true
  },
  "include": ["live-test/**/*", "src/utils/**/*", "src/types/**/*"]
}
```

- [ ] **Step 3: Restructure `jest.config.cjs` into two projects**

The existing config has `roots: ["<rootDir>/src"]` and `testEnvironment: "jsdom"`, so it cannot pick up Node-only tests in `live-test/`. Convert it to a two-project config. The extension project keeps every existing setting verbatim; the new project runs in `node` and uses the new tsconfig. Coverage and reporter settings stay at the root, where `projects` requires them.

```javascript
const extensionProject = {
  displayName: "extension",
  preset: "ts-jest",
  testEnvironment: "jsdom",
  roots: ["<rootDir>/src"],
  setupFilesAfterEnv: ["<rootDir>/src/test/setupTests.ts"],
  testMatch: ["**/?(*.)+(spec|test).+(ts|tsx)"],
  moduleFileExtensions: ["ts", "tsx", "js", "jsx", "json"],
  moduleNameMapper: {
    "\\.(css|scss)$": "identity-obj-proxy",
    "\\.(png|jpg|jpeg|gif|svg)$": "<rootDir>/src/test/mocks/fileMock.js",
    "^azure-devops-ui/.+$": "<rootDir>/src/test/mocks/modules/azureDevopsUi.tsx",
    "^azure-devops-extension-api/WorkItemTracking$": "<rootDir>/src/test/mocks/modules/azureDevopsApiWorkItemTracking.ts",
    "^azure-devops-extension-api/Core/CoreClient$": "<rootDir>/src/test/mocks/modules/azureDevopsApiCoreClient.ts",
    "^azure-devops-extension-api/Common/CommonServices$": "<rootDir>/src/test/mocks/modules/azureDevopsApiCommonServices.ts"
  },
  transform: {
    "^.+\\.(ts|tsx)$": [
      "ts-jest",
      {
        tsconfig: "<rootDir>/tsconfig.test.json"
      }
    ]
  }
};

const liveTestProject = {
  displayName: "live-test",
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>/live-test"],
  // Deliberately NOT matching *.spec.ts: Phase 2 puts Playwright specs under
  // live-test/ui/specs, and Jest must never try to run those.
  testMatch: ["**/*.test.ts"],
  moduleFileExtensions: ["ts", "js", "json"],
  transform: {
    "^.+\\.ts$": [
      "ts-jest",
      {
        tsconfig: "<rootDir>/tsconfig.live-test.json"
      }
    ]
  }
};

module.exports = {
  projects: [extensionProject, liveTestProject],
  collectCoverageFrom: [
    "src/**/*.{ts,tsx}",
    "live-test/**/*.ts",
    "!src/**/*.d.ts",
    "!src/test/**",
    "!live-test/test/**"
  ],
  coverageReporters: ["text", "lcov", "cobertura"],
  coverageDirectory: "coverage",
  reporters: [
    "default",
    [
      "jest-junit",
      {
        outputDirectory: "test-results",
        outputName: "junit.xml"
      }
    ]
  ]
};
```

Every key in `extensionProject` above is copied from the current `jest.config.cjs` — do not drop any of them, particularly the `moduleNameMapper` entries, which the existing component tests depend on.

- [ ] **Step 4: Add `.live-test-runs/` to `.gitignore`**

Append to the existing file (do not rewrite the other entries):

```
.live-test-runs/
playwright-report/
```

- [ ] **Step 5: Write the failing test for tag naming**

```typescript
// live-test/naming.test.ts
import { LIVE_TEST_PREFIX, newRunId, testTag } from "./naming";

describe("testTag", () => {
  it("builds a prefixed, ability-scoped tag name", () => {
    expect(testTag("20260915140211", "merge", "a")).toBe(
      "livetest-20260915140211-merge-a"
    );
  });

  it("always starts with the shared live-test prefix so cleanup can find it", () => {
    expect(testTag("r1", "delete", "x").startsWith(LIVE_TEST_PREFIX)).toBe(true);
  });

  it("keeps different abilities in separate namespaces", () => {
    expect(testTag("r1", "rename", "old")).not.toBe(testTag("r1", "delete", "old"));
  });
});

describe("newRunId", () => {
  it("formats a UTC timestamp with no separators", () => {
    expect(newRunId(new Date(Date.UTC(2026, 8, 15, 14, 2, 11)))).toBe("20260915140211");
  });

  it("zero-pads single-digit components", () => {
    expect(newRunId(new Date(Date.UTC(2026, 0, 2, 3, 4, 5)))).toBe("20260102030405");
  });
});
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `pnpm test -- live-test/naming.test.ts`
Expected: FAIL — `Cannot find module './naming'`.

- [ ] **Step 7: Write the implementation**

```typescript
// live-test/naming.ts

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
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `pnpm test`
Expected: PASS — both the `extension` and `live-test` projects run, and every pre-existing test still passes.

- [ ] **Step 9: Commit**

```bash
git add package.json pnpm-lock.yaml jest.config.cjs tsconfig.live-test.json .gitignore live-test/naming.ts live-test/naming.test.ts
git commit -m "chore: scaffold live-test harness tooling and tag naming"
```

---

### Task 2: Share tag-string encoding between production and harness

`TagService.ts` keeps `parseTags`/`joinTags` as private module-level functions. The harness needs exactly the same semicolon semantics; duplicating them is the highest-risk drift in the whole design. Extract them once.

**Files:**
- Create: `src/utils/tagString.ts`
- Test: `src/utils/tagString.test.ts`
- Modify: `src/services/TagService.ts:16-24` (delete the two private functions, import them instead)

**Interfaces:**
- Consumes: nothing.
- Produces: `parseTags(raw: string): string[]`, `joinTags(tags: string[]): string`. Used by `adoClient.ts` (Task 7) and by `TagService`.

- [ ] **Step 1: Write the failing test**

```typescript
// src/utils/tagString.test.ts
import { joinTags, parseTags } from "./tagString";

describe("parseTags", () => {
  it("splits ADO's semicolon-separated tag string", () => {
    expect(parseTags("bug; frontend; P1")).toEqual(["bug", "frontend", "P1"]);
  });

  it("trims surrounding whitespace on each tag", () => {
    expect(parseTags("bug ;  frontend")).toEqual(["bug", "frontend"]);
  });

  it("drops empty segments from trailing or doubled separators", () => {
    expect(parseTags("bug;;frontend;")).toEqual(["bug", "frontend"]);
  });

  it("returns an empty array for an empty field", () => {
    expect(parseTags("")).toEqual([]);
  });
});

describe("joinTags", () => {
  it("joins with the separator ADO writes back", () => {
    expect(joinTags(["bug", "frontend"])).toBe("bug; frontend");
  });

  it("round-trips through parseTags", () => {
    expect(parseTags(joinTags(["a", "b", "c"]))).toEqual(["a", "b", "c"]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test -- src/utils/tagString.test.ts`
Expected: FAIL — `Cannot find module './tagString'`.

- [ ] **Step 3: Create the module**

Move the bodies verbatim from `TagService.ts` so behavior cannot change.

```typescript
// src/utils/tagString.ts

// ADO stores tags as a semicolon+space separated string: "bug; frontend; P1"
export function parseTags(raw: string): string[] {
  if (!raw) return [];
  return raw.split(";").map((t) => t.trim()).filter(Boolean);
}

export function joinTags(tags: string[]): string {
  return tags.join("; ");
}
```

- [ ] **Step 4: Update `TagService.ts` to use it**

Delete the two private functions at the top of the file (the `parseTags` and `joinTags` declarations plus the comment above them) and add the import alongside the existing `sanitizeError` import:

```typescript
import { sanitizeError } from "../utils/sanitizeError";
import { joinTags, parseTags } from "../utils/tagString";
```

No other line in `TagService.ts` changes — the call sites in `applyTagUpdate` already use these names.

- [ ] **Step 5: Run the full suite to verify nothing regressed**

Run: `pnpm test`
Expected: PASS — including the pre-existing `src/services/TagService.test.ts`, which exercises the merge/rename paths that depend on this encoding.

- [ ] **Step 6: Commit**

```bash
git add src/utils/tagString.ts src/utils/tagString.test.ts src/services/TagService.ts
git commit -m "refactor: extract shared tag string encoding helpers"
```

---

### Task 3: Shared types and the crash-safe run manifest

**Files:**
- Create: `live-test/types.ts`
- Create: `live-test/manifest.ts`
- Test: `live-test/manifest.test.ts`

**Interfaces:**
- Consumes: `TagItem` from `src/types/index.ts`.
- Produces:
  - `RunManifest`, `AbilityResult`, `RunReport`, `WorkItemTags`, `IAdoClient`, `AbilityContext`, `Ability`, `CliOptions` (all from `types.ts`)
  - `ManifestStore` with `static create(dir, {runId, org, project}): ManifestStore`, `static open(path): ManifestStore`, `.path: string`, `.manifest: RunManifest`, `.addWorkItem(id: number): void`, `.addTag(name: string): void`, `.markCleaned(): void`
  - `listManifestPaths(dir: string): string[]`, `RUNS_DIR: string`

- [ ] **Step 1: Create the shared types module**

No test of its own — it declares types only, and every later task's tests type-check against it.

```typescript
// live-test/types.ts
import { TagItem } from "../src/types";

/** On-disk record of everything one run created, so cleanup survives a crash. */
export interface RunManifest {
  runId: string;
  /** Full org URL, e.g. https://dev.azure.com/myorg */
  org: string;
  project: string;
  status: "in-progress" | "cleaned";
  workItems: number[];
  tags: string[];
}

export interface AbilityResult {
  name: string;
  status: "pass" | "fail";
  durationMs: number;
  /** Failure reason, or a notable observation on pass. Always sanitized. */
  detail?: string;
}

export interface RunReport {
  runId: string;
  org: string;
  project: string;
  startedAt: string;
  finishedAt: string;
  results: AbilityResult[];
}

export interface WorkItemTags {
  id: number;
  tags: string[];
}

/**
 * The Azure DevOps surface the abilities depend on. Abilities are written
 * against this interface so they can be unit-tested against an in-memory fake.
 */
export interface IAdoClient {
  listTags(): Promise<TagItem[]>;
  renameTag(tagId: string, newName: string): Promise<TagItem>;
  deleteTag(tagIdOrName: string): Promise<void>;
  /** Work item count for one tag, via the Analytics OData endpoint. */
  countWorkItemsWithTag(tag: string): Promise<number>;
  createWorkItem(type: string, title: string, tags: string[]): Promise<number>;
  getWorkItemTags(ids: number[]): Promise<WorkItemTags[]>;
  setWorkItemTags(id: number, tags: string[]): Promise<void>;
  deleteWorkItem(id: number): Promise<void>;
  queryWorkItemIdsByTag(tag: string): Promise<number[]>;
}

export interface AbilityContext {
  client: IAdoClient;
  runId: string;
  /**
   * Creates a work item of the configured type, records it and its tags in the
   * run manifest, and returns its id. Abilities must create work items only
   * through this method — it is what guarantees cleanup can find them.
   */
  createWorkItem(tags: string[], title?: string): Promise<number>;
  /** Records a tag the ability is about to bring into existence by other means. */
  recordTag(name: string): void;
}

export interface Ability {
  name: string;
  run(ctx: AbilityContext): Promise<AbilityResult>;
}

export interface CliOptions {
  mode: "run" | "cleanup" | "cleanup-all";
  /** Required for mode "run". */
  org?: string;
  /** Required for mode "run". */
  project?: string;
  pat: string;
  yes: boolean;
  workItemType: string;
  /** Required for mode "cleanup". */
  manifestPath?: string;
}
```

- [ ] **Step 2: Write the failing test for the manifest store**

Every mutation must hit disk immediately — the test asserts that by re-reading the file rather than the in-memory object.

```typescript
// live-test/manifest.test.ts
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { listManifestPaths, ManifestStore } from "./manifest";
import { RunManifest } from "./types";

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "live-test-manifest-"));
}

function readRaw(p: string): RunManifest {
  return JSON.parse(fs.readFileSync(p, "utf8")) as RunManifest;
}

describe("ManifestStore.create", () => {
  it("writes an in-progress manifest to disk immediately", () => {
    const dir = tempDir();
    const store = ManifestStore.create(dir, {
      runId: "r1",
      org: "https://dev.azure.com/myorg",
      project: "Proj",
    });

    expect(readRaw(store.path)).toEqual({
      runId: "r1",
      org: "https://dev.azure.com/myorg",
      project: "Proj",
      status: "in-progress",
      workItems: [],
      tags: [],
    });
  });

  it("creates the runs directory when it does not exist", () => {
    const dir = path.join(tempDir(), "nested", "runs");
    const store = ManifestStore.create(dir, { runId: "r1", org: "o", project: "p" });
    expect(fs.existsSync(store.path)).toBe(true);
  });
});

describe("recording created resources", () => {
  it("persists a work item id before returning", () => {
    const dir = tempDir();
    const store = ManifestStore.create(dir, { runId: "r1", org: "o", project: "p" });

    store.addWorkItem(42);

    expect(readRaw(store.path).workItems).toEqual([42]);
  });

  it("persists a tag name before returning", () => {
    const dir = tempDir();
    const store = ManifestStore.create(dir, { runId: "r1", org: "o", project: "p" });

    store.addTag("livetest-r1-delete-a");

    expect(readRaw(store.path).tags).toEqual(["livetest-r1-delete-a"]);
  });

  it("does not record the same tag twice", () => {
    const dir = tempDir();
    const store = ManifestStore.create(dir, { runId: "r1", org: "o", project: "p" });

    store.addTag("t");
    store.addTag("t");

    expect(readRaw(store.path).tags).toEqual(["t"]);
  });
});

describe("markCleaned", () => {
  it("flips status on disk so a later sweep skips the run", () => {
    const dir = tempDir();
    const store = ManifestStore.create(dir, { runId: "r1", org: "o", project: "p" });

    store.markCleaned();

    expect(readRaw(store.path).status).toBe("cleaned");
  });
});

describe("ManifestStore.open", () => {
  it("reopens a manifest written by an earlier process", () => {
    const dir = tempDir();
    const created = ManifestStore.create(dir, { runId: "r1", org: "o", project: "p" });
    created.addWorkItem(7);

    const reopened = ManifestStore.open(created.path);

    expect(reopened.manifest.workItems).toEqual([7]);
    expect(reopened.manifest.runId).toBe("r1");
  });
});

describe("listManifestPaths", () => {
  it("returns manifests but not report files", () => {
    const dir = tempDir();
    ManifestStore.create(dir, { runId: "r1", org: "o", project: "p" });
    fs.writeFileSync(path.join(dir, "r1-report.json"), "{}", "utf8");

    expect(listManifestPaths(dir).map((p) => path.basename(p))).toEqual(["r1.json"]);
  });

  it("returns an empty list when the directory does not exist", () => {
    expect(listManifestPaths(path.join(tempDir(), "missing"))).toEqual([]);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm test -- live-test/manifest.test.ts`
Expected: FAIL — `Cannot find module './manifest'`.

- [ ] **Step 4: Write the implementation**

Writes are synchronous on purpose: an async write that has not flushed when the process is killed is exactly the failure this file exists to prevent.

```typescript
// live-test/manifest.ts
import * as fs from "node:fs";
import * as path from "node:path";
import { RunManifest } from "./types";

export const RUNS_DIR = ".live-test-runs";

export class ManifestStore {
  private constructor(
    readonly path: string,
    private readonly data: RunManifest
  ) {}

  static create(
    dir: string,
    init: { runId: string; org: string; project: string }
  ): ManifestStore {
    fs.mkdirSync(dir, { recursive: true });
    const data: RunManifest = {
      runId: init.runId,
      org: init.org,
      project: init.project,
      status: "in-progress",
      workItems: [],
      tags: [],
    };
    const store = new ManifestStore(path.join(dir, `${init.runId}.json`), data);
    store.flush();
    return store;
  }

  static open(manifestPath: string): ManifestStore {
    const data = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as RunManifest;
    return new ManifestStore(manifestPath, data);
  }

  get manifest(): RunManifest {
    return this.data;
  }

  addWorkItem(id: number): void {
    if (!this.data.workItems.includes(id)) {
      this.data.workItems.push(id);
      this.flush();
    }
  }

  addTag(name: string): void {
    if (!this.data.tags.includes(name)) {
      this.data.tags.push(name);
      this.flush();
    }
  }

  markCleaned(): void {
    this.data.status = "cleaned";
    this.flush();
  }

  // Synchronous: a crash must never lose a record of something that now exists.
  private flush(): void {
    fs.writeFileSync(this.path, `${JSON.stringify(this.data, null, 2)}\n`, "utf8");
  }
}

export function listManifestPaths(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json") && !f.endsWith("-report.json"))
    .map((f) => path.join(dir, f));
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm test -- live-test/manifest.test.ts`
Expected: PASS — all 9 tests.

- [ ] **Step 6: Commit**

```bash
git add live-test/types.ts live-test/manifest.ts live-test/manifest.test.ts
git commit -m "feat: add live-test shared types and crash-safe run manifest"
```

---

### Task 4: Poll helper for Analytics eventual consistency

Analytics OData lags behind work item writes. Without an injectable clock this helper is untestable and every test that touches it takes 30 seconds.

**Files:**
- Create: `live-test/poll.ts`
- Test: `live-test/poll.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `pollUntil<T>(opts: PollOptions<T>): Promise<PollResult<T>>` where `PollResult<T> = { ok: boolean; last: T; elapsedMs: number; attempts: number }`. Used by the list-counts ability (Task 10) and the delete ability (Task 13).

- [ ] **Step 1: Write the failing test**

```typescript
// live-test/poll.test.ts
import { pollUntil } from "./poll";

/** Deterministic fake clock: sleeping advances time instantly. */
function fakeClock() {
  let current = 0;
  return {
    now: () => current,
    sleep: async (ms: number) => {
      current += ms;
    },
  };
}

describe("pollUntil", () => {
  it("returns immediately when the first probe already satisfies the predicate", async () => {
    const clock = fakeClock();
    const probe = jest.fn(async () => 3);

    const result = await pollUntil({
      probe,
      until: (v) => v === 3,
      ...clock,
    });

    expect(result).toMatchObject({ ok: true, last: 3, attempts: 1, elapsedMs: 0 });
    expect(probe).toHaveBeenCalledTimes(1);
  });

  it("keeps probing until the value settles", async () => {
    const clock = fakeClock();
    const values = [0, 0, 3];
    const probe = jest.fn(async () => values.shift() ?? 3);

    const result = await pollUntil({
      probe,
      until: (v) => v === 3,
      intervalMs: 2000,
      ...clock,
    });

    expect(result.ok).toBe(true);
    expect(result.attempts).toBe(3);
    expect(result.elapsedMs).toBe(4000);
  });

  it("gives up at the timeout and reports the last value seen", async () => {
    const clock = fakeClock();
    const probe = jest.fn(async () => 1);

    const result = await pollUntil({
      probe,
      until: (v) => v === 3,
      intervalMs: 2000,
      timeoutMs: 6000,
      ...clock,
    });

    expect(result.ok).toBe(false);
    expect(result.last).toBe(1);
    expect(result.elapsedMs).toBeGreaterThanOrEqual(6000);
  });

  it("propagates a probe error instead of swallowing it", async () => {
    const clock = fakeClock();
    const probe = jest.fn(async () => {
      throw new Error("analytics exploded");
    });

    await expect(
      pollUntil({ probe, until: () => true, ...clock })
    ).rejects.toThrow("analytics exploded");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test -- live-test/poll.test.ts`
Expected: FAIL — `Cannot find module './poll'`.

- [ ] **Step 3: Write the implementation**

```typescript
// live-test/poll.ts

export interface PollOptions<T> {
  probe: () => Promise<T>;
  until: (value: T) => boolean;
  /** Total budget before giving up. Default 30s. */
  timeoutMs?: number;
  /** Delay between probes. Default 2s. */
  intervalMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export interface PollResult<T> {
  ok: boolean;
  last: T;
  elapsedMs: number;
  attempts: number;
}

const realSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export async function pollUntil<T>(opts: PollOptions<T>): Promise<PollResult<T>> {
  const timeoutMs = opts.timeoutMs ?? 30_000;
  const intervalMs = opts.intervalMs ?? 2_000;
  const now = opts.now ?? Date.now;
  const sleep = opts.sleep ?? realSleep;

  const start = now();
  let attempts = 0;
  let last = await opts.probe();
  attempts += 1;

  while (!opts.until(last)) {
    if (now() - start >= timeoutMs) {
      return { ok: false, last, elapsedMs: now() - start, attempts };
    }
    await sleep(intervalMs);
    last = await opts.probe();
    attempts += 1;
  }

  return { ok: true, last, elapsedMs: now() - start, attempts };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test -- live-test/poll.test.ts`
Expected: PASS — all 4 tests, in milliseconds (no real sleeping).

- [ ] **Step 5: Commit**

```bash
git add live-test/poll.ts live-test/poll.test.ts
git commit -m "feat: add poll helper for analytics eventual consistency"
```

---

### Task 5: Reporter — console lines and JSON report

**Files:**
- Create: `live-test/report.ts`
- Test: `live-test/report.test.ts`

**Interfaces:**
- Consumes: `AbilityResult`, `RunReport` from `./types`; `sanitizeError` from `../src/utils/sanitizeError`.
- Produces: `formatResultLine(r)`, `formatSummary(results, reportPath)`, `buildReport(meta, results)`, `writeReport(dir, report): string`, `allPassed(results): boolean`, `reportPath(dir, runId): string`.

- [ ] **Step 1: Write the failing test**

```typescript
// live-test/report.test.ts
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test -- live-test/report.test.ts`
Expected: FAIL — `Cannot find module './report'`.

- [ ] **Step 3: Write the implementation**

```typescript
// live-test/report.ts
import * as fs from "node:fs";
import * as path from "node:path";
import { sanitizeError } from "../src/utils/sanitizeError";
import { AbilityResult, RunReport } from "./types";

export function formatResultLine(result: AbilityResult): string {
  const head = `[${result.status === "pass" ? "PASS" : "FAIL"}] ${result.name} (${result.durationMs}ms)`;
  return result.detail ? `${head} — ${result.detail}` : head;
}

export function formatSummary(results: AbilityResult[], reportPath: string): string {
  const passed = results.filter((r) => r.status === "pass").length;
  return `${passed}/${results.length} passed. Report: ${reportPath}`;
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test -- live-test/report.test.ts`
Expected: PASS — all 8 tests.

- [ ] **Step 5: Commit**

```bash
git add live-test/report.ts live-test/report.test.ts
git commit -m "feat: add live-test console and JSON reporting"
```

---

### Task 6: AdoClient — URL/auth plumbing, Tags API, Analytics counts

The raw-`fetch` half of the client. Split from the Work Item Tracking half (Task 7) because the two use different mechanisms and can be reviewed independently.

**Files:**
- Create: `live-test/adoClient.ts`
- Test: `live-test/adoClient.test.ts`

**Interfaces:**
- Consumes: `TagItem` from `../src/types`; `sanitizeError` from `../src/utils/sanitizeError`.
- Produces: `orgNameFromUrl(orgUrl: string): string`; `class AdoClient` with constructor `(opts: { orgUrl: string; project: string; pat: string })` and, so far, `listTags()`, `renameTag(tagId, newName)`, `deleteTag(tagIdOrName)`, `countWorkItemsWithTag(tag)`. Task 7 adds the remaining `IAdoClient` methods.

- [ ] **Step 1: Write the failing test**

```typescript
// live-test/adoClient.test.ts
import { AdoClient, orgNameFromUrl } from "./adoClient";

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: "",
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

function newClient(): AdoClient {
  return new AdoClient({
    orgUrl: "https://dev.azure.com/myorg",
    project: "My Project",
    pat: "secret-pat",
  });
}

describe("orgNameFromUrl", () => {
  it("extracts the org name from a dev.azure.com URL", () => {
    expect(orgNameFromUrl("https://dev.azure.com/myorg")).toBe("myorg");
  });

  it("tolerates a trailing slash", () => {
    expect(orgNameFromUrl("https://dev.azure.com/myorg/")).toBe("myorg");
  });

  it("rejects a URL that is not an Azure DevOps Services org URL", () => {
    expect(() => orgNameFromUrl("https://example.com")).toThrow(
      /expected https:\/\/dev\.azure\.com\/<org>/
    );
  });
});

describe("listTags", () => {
  it("calls the project tags endpoint with Basic PAT auth", async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValue(jsonResponse({ value: [{ id: "1", name: "bug", url: "u" }] }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const tags = await newClient().listTags();

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(
      "https://dev.azure.com/myorg/My%20Project/_apis/wit/tags?api-version=7.1"
    );
    expect(init.method).toBe("GET");
    expect(init.headers.Authorization).toBe(
      `Basic ${Buffer.from(":secret-pat").toString("base64")}`
    );
    expect(tags).toEqual([{ id: "1", name: "bug", url: "u" }]);
  });

  it("returns an empty array when the project has no tags", async () => {
    global.fetch = jest.fn().mockResolvedValue(jsonResponse({})) as unknown as typeof fetch;
    expect(await newClient().listTags()).toEqual([]);
  });

  it("throws a sanitized error on a non-OK response", async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue(jsonResponse({ message: "nope" }, 403)) as unknown as typeof fetch;

    await expect(newClient().listTags()).rejects.toThrow(/403/);
  });
});

describe("renameTag", () => {
  it("PATCHes the tag by id with the new name", async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValue(jsonResponse({ id: "1", name: "new", url: "u" }));
    global.fetch = fetchMock as unknown as typeof fetch;

    await newClient().renameTag("1", "new");

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(
      "https://dev.azure.com/myorg/My%20Project/_apis/wit/tags/1?api-version=7.1"
    );
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body)).toEqual({ name: "new" });
  });
});

describe("deleteTag", () => {
  it("DELETEs the tag and tolerates an empty 204 body", async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 204,
      statusText: "No Content",
      json: async () => {
        throw new Error("no body");
      },
      text: async () => "",
    } as unknown as Response);
    global.fetch = fetchMock as unknown as typeof fetch;

    await expect(newClient().deleteTag("1")).resolves.toBeUndefined();
    expect(fetchMock.mock.calls[0][1].method).toBe("DELETE");
  });
});

describe("countWorkItemsWithTag", () => {
  it("filters the Analytics query server-side and counts the rows", async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValue(jsonResponse({ value: [{ WorkItemId: 1 }, { WorkItemId: 2 }] }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const count = await newClient().countWorkItemsWithTag("livetest-r1-count-a");

    expect(count).toBe(2);
    const [url] = fetchMock.mock.calls[0];
    expect(url).toContain("https://analytics.dev.azure.com/myorg/_odata/v4.0-preview/WorkItems");
    expect(decodeURIComponent(url as string)).toContain(
      "$filter=Tags/any(t: t/TagName eq 'livetest-r1-count-a')"
    );
  });

  it("follows @odata.nextLink and sums every page", async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ value: [{ WorkItemId: 1 }], "@odata.nextLink": "https://next" })
      )
      .mockResolvedValueOnce(jsonResponse({ value: [{ WorkItemId: 2 }] }));
    global.fetch = fetchMock as unknown as typeof fetch;

    expect(await newClient().countWorkItemsWithTag("t")).toBe(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("escapes single quotes in the tag name", async () => {
    const fetchMock = jest.fn().mockResolvedValue(jsonResponse({ value: [] }));
    global.fetch = fetchMock as unknown as typeof fetch;

    await newClient().countWorkItemsWithTag("it's");

    expect(decodeURIComponent(fetchMock.mock.calls[0][0] as string)).toContain("'it''s'");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test -- live-test/adoClient.test.ts`
Expected: FAIL — `Cannot find module './adoClient'`.

- [ ] **Step 3: Write the implementation**

```typescript
// live-test/adoClient.ts
import { TagItem } from "../src/types";
import { sanitizeError } from "../src/utils/sanitizeError";

export interface AdoClientOptions {
  /** Full org URL, e.g. https://dev.azure.com/myorg */
  orgUrl: string;
  project: string;
  pat: string;
}

/** Azure DevOps Services org URLs are https://dev.azure.com/<org>. */
export function orgNameFromUrl(orgUrl: string): string {
  const match = /^https:\/\/dev\.azure\.com\/([^/]+)\/?$/.exec(orgUrl.trim());
  if (!match) {
    throw new Error(
      `Unsupported org URL "${orgUrl}" — expected https://dev.azure.com/<org>`
    );
  }
  return match[1];
}

export class AdoClient {
  private readonly orgUrl: string;
  private readonly orgName: string;
  private readonly project: string;
  private readonly authHeader: string;

  constructor(opts: AdoClientOptions) {
    this.orgUrl = opts.orgUrl.trim().replace(/\/$/, "");
    this.orgName = orgNameFromUrl(opts.orgUrl);
    this.project = opts.project;
    this.authHeader = `Basic ${Buffer.from(`:${opts.pat}`).toString("base64")}`;
  }

  private async request<T>(
    method: string,
    url: string,
    body?: object
  ): Promise<T | undefined> {
    const res = await fetch(url, {
      method,
      headers: {
        Authorization: this.authHeader,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      throw new Error(sanitizeError(`${method} failed: ${res.status} ${text}`));
    }

    if (res.status === 204) return undefined;
    return (await res.json()) as T;
  }

  private tagsUrl(suffix = ""): string {
    return `${this.orgUrl}/${encodeURIComponent(this.project)}/_apis/wit/tags${suffix}?api-version=7.1`;
  }

  async listTags(): Promise<TagItem[]> {
    const data = await this.request<{ value?: TagItem[] }>("GET", this.tagsUrl());
    return data?.value ?? [];
  }

  async renameTag(tagId: string, newName: string): Promise<TagItem> {
    const updated = await this.request<TagItem>(
      "PATCH",
      this.tagsUrl(`/${encodeURIComponent(tagId)}`),
      { name: newName }
    );
    return updated as TagItem;
  }

  async deleteTag(tagIdOrName: string): Promise<void> {
    await this.request<void>(
      "DELETE",
      this.tagsUrl(`/${encodeURIComponent(tagIdOrName)}`)
    );
  }

  /**
   * Counts work items carrying one tag via Analytics OData. Same endpoint and
   * $expand shape as TagCountCacheService, plus a server-side $filter so a
   * single tag lookup does not page through every tagged item in the org.
   */
  async countWorkItemsWithTag(tag: string): Promise<number> {
    const escaped = tag.replace(/'/g, "''");
    const query =
      `$select=WorkItemId&$expand=Tags($select=TagName)` +
      `&$filter=Tags/any(t: t/TagName eq '${escaped}')`;
    let url: string | null =
      `https://analytics.dev.azure.com/${encodeURIComponent(this.orgName)}` +
      `/_odata/v4.0-preview/WorkItems?${encodeURI(query)}`;

    let total = 0;
    while (url) {
      const page = await this.request<{
        value?: unknown[];
        "@odata.nextLink"?: string;
      }>("GET", url);
      total += page?.value?.length ?? 0;
      url = page?.["@odata.nextLink"] ?? null;
    }
    return total;
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test -- live-test/adoClient.test.ts`
Expected: PASS — all 10 tests.

- [ ] **Step 5: Commit**

```bash
git add live-test/adoClient.ts live-test/adoClient.test.ts
git commit -m "feat: add live-test ADO client tags and analytics calls"
```

---

### Task 7: AdoClient — Work Item Tracking operations

Adds the `azure-devops-node-api` half so `AdoClient` satisfies the full `IAdoClient` interface.

**Files:**
- Modify: `live-test/adoClient.ts` (add imports, lazy API accessor, five methods, `implements IAdoClient`)
- Modify: `live-test/adoClient.test.ts` (append a new describe block)

**Interfaces:**
- Consumes: `IAdoClient`, `WorkItemTags` from `./types`; `joinTags`, `parseTags` from `../src/utils/tagString`.
- Produces: `AdoClient` now implements the complete `IAdoClient` — `createWorkItem(type, title, tags)`, `getWorkItemTags(ids)`, `setWorkItemTags(id, tags)`, `deleteWorkItem(id)`, `queryWorkItemIdsByTag(tag)`.

- [ ] **Step 1: Write the failing test**

Append to `live-test/adoClient.test.ts`. The library is mocked at module level — these tests verify the harness calls it with the right shapes, not that the library works.

```typescript
// --- appended to live-test/adoClient.test.ts ---

const mockWit = {
  createWorkItem: jest.fn(),
  getWorkItemsBatch: jest.fn(),
  updateWorkItem: jest.fn(),
  deleteWorkItem: jest.fn(),
  queryByWiql: jest.fn(),
};

jest.mock("azure-devops-node-api", () => ({
  getPersonalAccessTokenHandler: jest.fn(() => ({})),
  WebApi: jest.fn().mockImplementation(() => ({
    getWorkItemTrackingApi: async () => mockWit,
  })),
}));

describe("work item operations", () => {
  beforeEach(() => {
    Object.values(mockWit).forEach((fn) => fn.mockReset());
  });

  it("creates a work item with a title and joined tags, returning its id", async () => {
    mockWit.createWorkItem.mockResolvedValue({ id: 101 });

    const id = await newClient().createWorkItem("Task", "live test", ["a", "b"]);

    expect(id).toBe(101);
    const [, patch, project, type] = mockWit.createWorkItem.mock.calls[0];
    expect(project).toBe("My Project");
    expect(type).toBe("Task");
    expect(patch).toEqual([
      { op: "add", path: "/fields/System.Title", value: "live test" },
      { op: "add", path: "/fields/System.Tags", value: "a; b" },
    ]);
  });

  it("throws when the API returns a work item without an id", async () => {
    mockWit.createWorkItem.mockResolvedValue({});
    await expect(newClient().createWorkItem("Task", "t", [])).rejects.toThrow(
      /did not return an id/
    );
  });

  it("reads tags for a batch of work items", async () => {
    mockWit.getWorkItemsBatch.mockResolvedValue([
      { id: 1, fields: { "System.Tags": "a; b" } },
      { id: 2, fields: {} },
    ]);

    const result = await newClient().getWorkItemTags([1, 2]);

    expect(result).toEqual([
      { id: 1, tags: ["a", "b"] },
      { id: 2, tags: [] },
    ]);
    const [request, project] = mockWit.getWorkItemsBatch.mock.calls[0];
    expect(request).toEqual({ ids: [1, 2], fields: ["System.Tags"] });
    expect(project).toBe("My Project");
  });

  it("returns an empty array without calling the API for an empty id list", async () => {
    expect(await newClient().getWorkItemTags([])).toEqual([]);
    expect(mockWit.getWorkItemsBatch).not.toHaveBeenCalled();
  });

  it("chunks batch reads at 200 ids", async () => {
    mockWit.getWorkItemsBatch.mockResolvedValue([]);
    await newClient().getWorkItemTags(Array.from({ length: 250 }, (_, i) => i + 1));
    expect(mockWit.getWorkItemsBatch).toHaveBeenCalledTimes(2);
    expect(mockWit.getWorkItemsBatch.mock.calls[0][0].ids).toHaveLength(200);
    expect(mockWit.getWorkItemsBatch.mock.calls[1][0].ids).toHaveLength(50);
  });

  it("writes tags back as a joined string", async () => {
    mockWit.updateWorkItem.mockResolvedValue({});

    await newClient().setWorkItemTags(7, ["a", "b"]);

    const [, patch, id, project] = mockWit.updateWorkItem.mock.calls[0];
    expect(patch).toEqual([
      { op: "add", path: "/fields/System.Tags", value: "a; b" },
    ]);
    expect(id).toBe(7);
    expect(project).toBe("My Project");
  });

  it("soft-deletes a work item", async () => {
    mockWit.deleteWorkItem.mockResolvedValue({});
    await newClient().deleteWorkItem(7);
    expect(mockWit.deleteWorkItem).toHaveBeenCalledWith(7, "My Project");
  });

  it("queries work item ids by tag with an escaped WIQL literal", async () => {
    mockWit.queryByWiql.mockResolvedValue({ workItems: [{ id: 3 }, { id: 4 }] });

    const ids = await newClient().queryWorkItemIdsByTag("it's");

    expect(ids).toEqual([3, 4]);
    const [wiql, teamContext] = mockWit.queryByWiql.mock.calls[0];
    expect(wiql.query).toContain("'it''s'");
    expect(teamContext).toEqual({ project: "My Project" });
  });

  it("returns an empty array when the query matches nothing", async () => {
    mockWit.queryByWiql.mockResolvedValue({});
    expect(await newClient().queryWorkItemIdsByTag("x")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test -- live-test/adoClient.test.ts`
Expected: FAIL — `client.createWorkItem is not a function`.

- [ ] **Step 3: Extend the implementation**

Add these imports at the top of `live-test/adoClient.ts`:

```typescript
import * as azdev from "azure-devops-node-api";
import { IWorkItemTrackingApi } from "azure-devops-node-api/WorkItemTrackingApi";
import { joinTags, parseTags } from "../src/utils/tagString";
import { IAdoClient, WorkItemTags } from "./types";
```

Change the class declaration to `export class AdoClient implements IAdoClient {`, add a private field and lazy accessor, and add the five methods:

```typescript
  private readonly connection: azdev.WebApi;
  private witApi?: IWorkItemTrackingApi;
```

Add to the constructor body, after the existing assignments:

```typescript
    this.connection = new azdev.WebApi(
      this.orgUrl,
      azdev.getPersonalAccessTokenHandler(opts.pat)
    );
```

Add the methods:

```typescript
  private async wit(): Promise<IWorkItemTrackingApi> {
    if (!this.witApi) {
      this.witApi = await this.connection.getWorkItemTrackingApi();
    }
    return this.witApi;
  }

  async createWorkItem(type: string, title: string, tags: string[]): Promise<number> {
    const wit = await this.wit();
    const patch = [
      { op: "add", path: "/fields/System.Title", value: title },
      { op: "add", path: "/fields/System.Tags", value: joinTags(tags) },
    ];
    const created = await wit.createWorkItem(null, patch, this.project, type);
    if (typeof created?.id !== "number") {
      throw new Error(`Creating a ${type} did not return an id`);
    }
    return created.id;
  }

  async getWorkItemTags(ids: number[]): Promise<WorkItemTags[]> {
    if (ids.length === 0) return [];
    const wit = await this.wit();
    const out: WorkItemTags[] = [];
    for (let i = 0; i < ids.length; i += 200) {
      const batch = await wit.getWorkItemsBatch(
        { ids: ids.slice(i, i + 200), fields: ["System.Tags"] },
        this.project
      );
      for (const item of batch ?? []) {
        out.push({
          id: item.id as number,
          tags: parseTags((item.fields?.["System.Tags"] as string) ?? ""),
        });
      }
    }
    return out;
  }

  async setWorkItemTags(id: number, tags: string[]): Promise<void> {
    const wit = await this.wit();
    await wit.updateWorkItem(
      null,
      [{ op: "add", path: "/fields/System.Tags", value: joinTags(tags) }],
      id,
      this.project
    );
  }

  /** Soft delete — the work item goes to the project Recycle Bin. */
  async deleteWorkItem(id: number): Promise<void> {
    const wit = await this.wit();
    await wit.deleteWorkItem(id, this.project);
  }

  async queryWorkItemIdsByTag(tag: string): Promise<number[]> {
    const wit = await this.wit();
    const escaped = tag.replace(/'/g, "''");
    const result = await wit.queryByWiql(
      {
        query:
          `SELECT [System.Id] FROM WorkItems ` +
          `WHERE [System.Tags] CONTAINS '${escaped}' ` +
          `AND [System.TeamProject] = @project ORDER BY [System.Id]`,
      },
      { project: this.project }
    );
    return (result?.workItems ?? []).map((wi) => wi.id as number);
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test -- live-test/adoClient.test.ts`
Expected: PASS — all 19 tests.

- [ ] **Step 5: Commit**

```bash
git add live-test/adoClient.ts live-test/adoClient.test.ts
git commit -m "feat: add work item tracking operations to live-test client"
```

---

### Task 8: CLI argument parsing and the confirmation gate

Pure functions only — `main()` is wired in Task 16 once the runner and abilities exist.

**Files:**
- Create: `live-test/cli.ts`
- Test: `live-test/cli.test.ts`

**Interfaces:**
- Consumes: `CliOptions` from `./types`.
- Produces: `parseCliArgs(argv: string[]): CliOptions`, `class CliError extends Error`, `USAGE: string`, `confirmationMatches(input: string, project: string): boolean`.

- [ ] **Step 1: Write the failing test**

```typescript
// live-test/cli.test.ts
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test -- live-test/cli.test.ts`
Expected: FAIL — `Cannot find module './cli'`.

- [ ] **Step 3: Write the implementation**

```typescript
// live-test/cli.ts
import { parseArgs } from "node:util";
import { CliOptions } from "./types";

export class CliError extends Error {}

export const USAGE = `Usage:
  pnpm live-test --org <url> --project <name> --pat <pat> [--yes] [--work-item-type Task]
  pnpm live-test --cleanup <manifest.json> --pat <pat>
  pnpm live-test --cleanup-all --pat <pat>

Flags:
  --org              Org URL, e.g. https://dev.azure.com/myorg
  --project          Project to create test data in
  --pat              Personal access token (Work Items read/write + Analytics read)
  --yes              Skip the typed project-name confirmation
  --work-item-type   Work item type to create (default: Task)
  --cleanup          Delete everything recorded in one manifest
  --cleanup-all      Delete everything in every manifest still marked in-progress`;

export function parseCliArgs(argv: string[]): CliOptions {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      options: {
        org: { type: "string" },
        project: { type: "string" },
        pat: { type: "string" },
        yes: { type: "boolean", default: false },
        "work-item-type": { type: "string", default: "Task" },
        cleanup: { type: "string" },
        "cleanup-all": { type: "boolean", default: false },
      },
      strict: true,
      allowPositionals: false,
    });
  } catch (e) {
    throw new CliError(`${(e as Error).message}\n\n${USAGE}`);
  }

  const v = parsed.values;
  if (!v.pat) throw new CliError(`--pat is required\n\n${USAGE}`);
  if (v.cleanup && v["cleanup-all"]) {
    throw new CliError(`--cleanup and --cleanup-all are mutually exclusive\n\n${USAGE}`);
  }

  const base = {
    pat: v.pat,
    yes: v.yes ?? false,
    workItemType: v["work-item-type"] ?? "Task",
  };

  if (v.cleanup) {
    return { mode: "cleanup", ...base, manifestPath: v.cleanup };
  }
  if (v["cleanup-all"]) {
    return { mode: "cleanup-all", ...base };
  }
  if (!v.org) throw new CliError(`--org is required\n\n${USAGE}`);
  if (!v.project) throw new CliError(`--project is required\n\n${USAGE}`);

  return { mode: "run", ...base, org: v.org, project: v.project };
}

/** The typed-confirmation guard: an exact, deliberate match of the project name. */
export function confirmationMatches(input: string, project: string): boolean {
  return input.trim() === project;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test -- live-test/cli.test.ts`
Expected: PASS — all 17 tests.

- [ ] **Step 5: Commit**

```bash
git add live-test/cli.ts live-test/cli.test.ts
git commit -m "feat: add live-test CLI argument parsing and confirmation guard"
```

---

### Task 9: In-memory fake AdoClient

The test double every ability is tested against. It must model ADO's real semantics — most importantly that deleting a tag cascades it off work items, and that renaming rewrites it in place — or the ability tests prove nothing.

**Files:**
- Create: `live-test/test/fakeAdoClient.ts`
- Test: `live-test/test/fakeAdoClient.test.ts`

**Interfaces:**
- Consumes: `IAdoClient`, `WorkItemTags`, `TagItem`.
- Produces: `class FakeAdoClient implements IAdoClient` with extra test affordances: `constructor()`, `seedWorkItem(tags: string[]): number`, `tagNames(): string[]`, `tagsOf(id: number): string[]`, `failNext(method: keyof IAdoClient, message: string): void`.

- [ ] **Step 1: Write the failing test**

```typescript
// live-test/test/fakeAdoClient.test.ts
import { FakeAdoClient } from "./fakeAdoClient";

describe("FakeAdoClient tag registry", () => {
  it("registers tags when a work item is created with them", async () => {
    const c = new FakeAdoClient();
    await c.createWorkItem("Task", "t", ["a", "b"]);
    expect(c.tagNames().sort()).toEqual(["a", "b"]);
  });

  it("assigns increasing work item ids", async () => {
    const c = new FakeAdoClient();
    const first = await c.createWorkItem("Task", "t", []);
    const second = await c.createWorkItem("Task", "t", []);
    expect(second).toBeGreaterThan(first);
  });

  it("keeps a tag registered after the last work item drops it", async () => {
    const c = new FakeAdoClient();
    const id = await c.createWorkItem("Task", "t", ["a"]);
    await c.setWorkItemTags(id, []);
    expect(c.tagNames()).toEqual(["a"]);
  });
});

describe("FakeAdoClient delete cascade", () => {
  it("removes a deleted tag from every work item carrying it", async () => {
    const c = new FakeAdoClient();
    const one = await c.createWorkItem("Task", "t", ["a", "keep"]);
    const two = await c.createWorkItem("Task", "t", ["a"]);
    const tag = (await c.listTags()).find((t) => t.name === "a");

    await c.deleteTag(tag!.id);

    expect(c.tagsOf(one)).toEqual(["keep"]);
    expect(c.tagsOf(two)).toEqual([]);
    expect(c.tagNames()).toEqual(["keep"]);
  });

  it("throws on deleting a tag that does not exist", async () => {
    const c = new FakeAdoClient();
    await expect(c.deleteTag("missing")).rejects.toThrow(/404/);
  });
});

describe("FakeAdoClient rename", () => {
  it("rewrites the tag on every work item", async () => {
    const c = new FakeAdoClient();
    const id = await c.createWorkItem("Task", "t", ["old"]);
    const tag = (await c.listTags()).find((t) => t.name === "old");

    await c.renameTag(tag!.id, "new");

    expect(c.tagsOf(id)).toEqual(["new"]);
    expect(c.tagNames()).toEqual(["new"]);
  });
});

describe("FakeAdoClient queries", () => {
  it("counts work items carrying a tag", async () => {
    const c = new FakeAdoClient();
    await c.createWorkItem("Task", "t", ["a"]);
    await c.createWorkItem("Task", "t", ["a"]);
    await c.createWorkItem("Task", "t", ["b"]);

    expect(await c.countWorkItemsWithTag("a")).toBe(2);
  });

  it("returns ids of work items carrying a tag", async () => {
    const c = new FakeAdoClient();
    const one = await c.createWorkItem("Task", "t", ["a"]);
    await c.createWorkItem("Task", "t", ["b"]);

    expect(await c.queryWorkItemIdsByTag("a")).toEqual([one]);
  });

  it("excludes deleted work items from counts", async () => {
    const c = new FakeAdoClient();
    const id = await c.createWorkItem("Task", "t", ["a"]);
    await c.deleteWorkItem(id);
    expect(await c.countWorkItemsWithTag("a")).toBe(0);
  });

  it("reads tags for a batch of ids", async () => {
    const c = new FakeAdoClient();
    const one = await c.createWorkItem("Task", "t", ["a"]);
    const two = await c.createWorkItem("Task", "t", ["b"]);

    expect(await c.getWorkItemTags([one, two])).toEqual([
      { id: one, tags: ["a"] },
      { id: two, tags: ["b"] },
    ]);
  });
});

describe("FakeAdoClient failure injection", () => {
  it("fails the next call to a chosen method, then recovers", async () => {
    const c = new FakeAdoClient();
    c.failNext("listTags", "boom");

    await expect(c.listTags()).rejects.toThrow("boom");
    await expect(c.listTags()).resolves.toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test -- live-test/test/fakeAdoClient.test.ts`
Expected: FAIL — `Cannot find module './fakeAdoClient'`.

- [ ] **Step 3: Write the implementation**

```typescript
// live-test/test/fakeAdoClient.ts
import { TagItem } from "../../src/types";
import { IAdoClient, WorkItemTags } from "../types";

interface FakeWorkItem {
  id: number;
  tags: string[];
  deleted: boolean;
}

/**
 * In-memory stand-in for Azure DevOps. Models the two behaviors the abilities
 * assert on: deleting a tag cascades it off every work item, and renaming a tag
 * rewrites it in place everywhere.
 */
export class FakeAdoClient implements IAdoClient {
  private nextId = 100;
  private readonly items = new Map<number, FakeWorkItem>();
  /** tag id -> tag name */
  private readonly tags = new Map<string, string>();
  private nextTagId = 1;
  private readonly failures = new Map<string, string>();

  private maybeFail(method: string): void {
    const message = this.failures.get(method);
    if (message) {
      this.failures.delete(method);
      throw new Error(message);
    }
  }

  failNext(method: keyof IAdoClient, message: string): void {
    this.failures.set(method, message);
  }

  seedWorkItem(tags: string[]): number {
    const id = this.nextId++;
    this.items.set(id, { id, tags: [...tags], deleted: false });
    for (const t of tags) this.registerTag(t);
    return id;
  }

  tagNames(): string[] {
    return [...this.tags.values()];
  }

  tagsOf(id: number): string[] {
    return [...(this.items.get(id)?.tags ?? [])];
  }

  private registerTag(name: string): void {
    if (![...this.tags.values()].includes(name)) {
      this.tags.set(String(this.nextTagId++), name);
    }
  }

  private live(): FakeWorkItem[] {
    return [...this.items.values()].filter((i) => !i.deleted);
  }

  async listTags(): Promise<TagItem[]> {
    this.maybeFail("listTags");
    return [...this.tags.entries()].map(([id, name]) => ({ id, name, url: "" }));
  }

  async renameTag(tagId: string, newName: string): Promise<TagItem> {
    this.maybeFail("renameTag");
    const current = this.tags.get(tagId);
    if (!current) throw new Error(`404 no tag ${tagId}`);
    this.tags.set(tagId, newName);
    for (const item of this.items.values()) {
      item.tags = item.tags.map((t) => (t === current ? newName : t));
    }
    return { id: tagId, name: newName, url: "" };
  }

  async deleteTag(tagIdOrName: string): Promise<void> {
    this.maybeFail("deleteTag");
    let id = this.tags.has(tagIdOrName) ? tagIdOrName : undefined;
    if (!id) {
      id = [...this.tags.entries()].find(([, name]) => name === tagIdOrName)?.[0];
    }
    if (!id) throw new Error(`404 no tag ${tagIdOrName}`);
    const name = this.tags.get(id) as string;
    this.tags.delete(id);
    for (const item of this.items.values()) {
      item.tags = item.tags.filter((t) => t !== name);
    }
  }

  async countWorkItemsWithTag(tag: string): Promise<number> {
    this.maybeFail("countWorkItemsWithTag");
    return this.live().filter((i) => i.tags.includes(tag)).length;
  }

  async createWorkItem(_type: string, _title: string, tags: string[]): Promise<number> {
    this.maybeFail("createWorkItem");
    return this.seedWorkItem(tags);
  }

  async getWorkItemTags(ids: number[]): Promise<WorkItemTags[]> {
    this.maybeFail("getWorkItemTags");
    return ids
      .map((id) => this.items.get(id))
      .filter((i): i is FakeWorkItem => Boolean(i) && !i!.deleted)
      .map((i) => ({ id: i.id, tags: [...i.tags] }));
  }

  async setWorkItemTags(id: number, tags: string[]): Promise<void> {
    this.maybeFail("setWorkItemTags");
    const item = this.items.get(id);
    if (!item) throw new Error(`404 no work item ${id}`);
    item.tags = [...tags];
    for (const t of tags) this.registerTag(t);
  }

  async deleteWorkItem(id: number): Promise<void> {
    this.maybeFail("deleteWorkItem");
    const item = this.items.get(id);
    if (!item) throw new Error(`404 no work item ${id}`);
    item.deleted = true;
  }

  async queryWorkItemIdsByTag(tag: string): Promise<number[]> {
    this.maybeFail("queryWorkItemIdsByTag");
    return this.live()
      .filter((i) => i.tags.includes(tag))
      .map((i) => i.id);
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test -- live-test/test/fakeAdoClient.test.ts`
Expected: PASS — all 11 tests.

- [ ] **Step 5: Commit**

```bash
git add live-test/test/fakeAdoClient.ts live-test/test/fakeAdoClient.test.ts
git commit -m "test: add in-memory fake ADO client for ability tests"
```

---

### Task 10: Ability — list tags + live counts

**Files:**
- Create: `live-test/abilities/support.ts`
- Create: `live-test/abilities/listTagsAndCounts.ts`
- Test: `live-test/abilities/listTagsAndCounts.test.ts`

**Interfaces:**
- Consumes: `Ability`, `AbilityContext`, `AbilityResult`, `IAdoClient`; `testTag`; `pollUntil`; `FakeAdoClient`.
- Produces:
  - From `support.ts`: `timed(name, fn): Promise<AbilityResult>` where `fn: () => Promise<{ ok: boolean; detail?: string }>`, and `makeContext(client, opts)` is **not** here (the runner builds contexts).
  - From `listTagsAndCounts.ts`: `export const listTagsAndCountsAbility: Ability` (name `"List tags + counts"`).

- [ ] **Step 1: Write the failing test**

The ability exposes `runWithPollSettings` so tests can shrink the 30-second poll budget to milliseconds; the happy-path test calls the real `.run()` because the fake satisfies the predicate on the first probe and never sleeps.

```typescript
// live-test/abilities/listTagsAndCounts.test.ts
import { listTagsAndCountsAbility, runWithPollSettings } from "./listTagsAndCounts";
import { FAST_POLL_FOR_TESTS } from "./support";
import { FakeAdoClient } from "../test/fakeAdoClient";
import { AbilityContext } from "../types";

function contextFor(client: FakeAdoClient): AbilityContext & { tags: string[] } {
  const tags: string[] = [];
  return {
    client,
    runId: "r1",
    tags,
    createWorkItem: async (tagNames) => {
      tagNames.forEach((t) => tags.push(t));
      return client.createWorkItem("Task", "live test", tagNames);
    },
    recordTag: (name) => tags.push(name),
  };
}

describe("listTagsAndCounts ability", () => {
  it("passes when the tag is listed and Analytics agrees on the count", async () => {
    const ctx = contextFor(new FakeAdoClient());

    const result = await listTagsAndCountsAbility.run(ctx);

    expect(result.status).toBe("pass");
    expect(result.name).toBe("List tags + counts");
  });

  it("creates exactly three work items under a run-scoped tag", async () => {
    const client = new FakeAdoClient();
    const ctx = contextFor(client);

    await listTagsAndCountsAbility.run(ctx);

    expect(await client.countWorkItemsWithTag("livetest-r1-count-a")).toBe(3);
  });

  it("records every created tag so cleanup can find it", async () => {
    const ctx = contextFor(new FakeAdoClient());
    await listTagsAndCountsAbility.run(ctx);
    expect(ctx.tags).toContain("livetest-r1-count-a");
  });

  it("fails when the tag never appears in the tags list", async () => {
    const client = new FakeAdoClient();
    jest.spyOn(client, "listTags").mockResolvedValue([]);
    const ctx = contextFor(client);

    const result = await runWithPollSettings(ctx, FAST_POLL_FOR_TESTS);

    expect(result.status).toBe("fail");
    expect(result.detail).toContain("not returned by the tags list");
  });

  it("fails when the Analytics count never reaches the expected value", async () => {
    const client = new FakeAdoClient();
    jest.spyOn(client, "countWorkItemsWithTag").mockResolvedValue(1);
    const ctx = contextFor(client);

    const result = await runWithPollSettings(ctx, FAST_POLL_FOR_TESTS);

    expect(result.status).toBe("fail");
    expect(result.detail).toMatch(/expected 3/);
  });

  it("reports a sanitized failure when the client throws", async () => {
    const client = new FakeAdoClient();
    client.failNext("listTags", "boom at https://dev.azure.com/o");
    const ctx = contextFor(client);

    const result = await runWithPollSettings(ctx, FAST_POLL_FOR_TESTS);

    expect(result.status).toBe("fail");
    expect(result.detail).not.toContain("https://dev.azure.com");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test -- live-test/abilities/listTagsAndCounts.test.ts`
Expected: FAIL — `Cannot find module './listTagsAndCounts'`.

- [ ] **Step 3: Write the shared ability helper**

```typescript
// live-test/abilities/support.ts
import { sanitizeError } from "../../src/utils/sanitizeError";
import { AbilityResult } from "../types";

export interface AbilityOutcome {
  ok: boolean;
  detail?: string;
}

/**
 * Times one ability, converts a thrown error into a sanitized failure, and
 * guarantees every ability returns a result rather than rejecting — the runner
 * must always be able to continue to the next ability.
 */
export async function timed(
  name: string,
  fn: () => Promise<AbilityOutcome>
): Promise<AbilityResult> {
  const start = Date.now();
  try {
    const outcome = await fn();
    return {
      name,
      status: outcome.ok ? "pass" : "fail",
      durationMs: Date.now() - start,
      detail: outcome.detail,
    };
  } catch (e) {
    return {
      name,
      status: "fail",
      durationMs: Date.now() - start,
      detail: sanitizeError(e),
    };
  }
}

/** Poll settings an ability uses; overridable so unit tests run instantly. */
export interface PollSettings {
  timeoutMs?: number;
  intervalMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

export const FAST_POLL_FOR_TESTS: PollSettings = {
  timeoutMs: 10,
  intervalMs: 1,
  sleep: async () => undefined,
};
```

- [ ] **Step 4: Write the ability**

```typescript
// live-test/abilities/listTagsAndCounts.ts
import { testTag } from "../naming";
import { pollUntil } from "../poll";
import { Ability, AbilityContext, AbilityResult } from "../types";
import { PollSettings, timed } from "./support";

const NAME = "List tags + counts";
const EXPECTED = 3;

async function run(
  ctx: AbilityContext,
  poll: PollSettings = {}
): Promise<AbilityResult> {
  return timed(NAME, async () => {
    const tag = testTag(ctx.runId, "count", "a");

    for (let i = 0; i < EXPECTED; i += 1) {
      await ctx.createWorkItem([tag], `${tag} #${i + 1}`);
    }

    const tags = await ctx.client.listTags();
    if (!tags.some((t) => t.name === tag)) {
      return { ok: false, detail: `${tag} was not returned by the tags list` };
    }

    const counted = await pollUntil({
      probe: () => ctx.client.countWorkItemsWithTag(tag),
      until: (c) => c === EXPECTED,
      ...poll,
    });

    if (!counted.ok) {
      return {
        ok: false,
        detail: `Analytics count was ${counted.last} after ${counted.elapsedMs}ms, expected ${EXPECTED}`,
      };
    }

    return {
      ok: true,
      detail: `${EXPECTED} work items; Analytics agreed after ${counted.elapsedMs}ms`,
    };
  });
}

export const listTagsAndCountsAbility: Ability = { name: NAME, run: (ctx) => run(ctx) };

/** Exported for unit tests so the poll budget can be shrunk. */
export const runWithPollSettings = run;
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm test -- live-test/abilities/listTagsAndCounts.test.ts`
Expected: PASS — all 6 tests, in under a second.

- [ ] **Step 6: Commit**

```bash
git add live-test/abilities/support.ts live-test/abilities/listTagsAndCounts.ts live-test/abilities/listTagsAndCounts.test.ts
git commit -m "feat: add list tags and counts live-test ability"
```

---

### Task 11: Ability — rename

**Files:**
- Create: `live-test/abilities/renameTag.ts`
- Test: `live-test/abilities/renameTag.test.ts`

**Interfaces:**
- Consumes: `timed` from `./support`; `testTag`; `Ability`, `AbilityContext`.
- Produces: `export const renameTagAbility: Ability` (name `"Rename tag"`).

- [ ] **Step 1: Write the failing test**

```typescript
// live-test/abilities/renameTag.test.ts
import { renameTagAbility } from "./renameTag";
import { FakeAdoClient } from "../test/fakeAdoClient";
import { AbilityContext } from "../types";

function contextFor(client: FakeAdoClient): AbilityContext & { tags: string[] } {
  const tags: string[] = [];
  return {
    client,
    runId: "r1",
    tags,
    createWorkItem: async (tagNames) => {
      tagNames.forEach((t) => tags.push(t));
      return client.createWorkItem("Task", "live test", tagNames);
    },
    recordTag: (name) => tags.push(name),
  };
}

describe("renameTag ability", () => {
  it("passes when the rename propagates to every work item", async () => {
    const result = await renameTagAbility.run(contextFor(new FakeAdoClient()));
    expect(result).toMatchObject({ name: "Rename tag", status: "pass" });
  });

  it("leaves the new name on both work items and the old name nowhere", async () => {
    const client = new FakeAdoClient();
    await renameTagAbility.run(contextFor(client));

    expect(client.tagNames()).toContain("livetest-r1-rename-new");
    expect(client.tagNames()).not.toContain("livetest-r1-rename-old");
    expect(await client.countWorkItemsWithTag("livetest-r1-rename-new")).toBe(2);
  });

  it("records the post-rename name so cleanup deletes it", async () => {
    const ctx = contextFor(new FakeAdoClient());
    await renameTagAbility.run(ctx);
    expect(ctx.tags).toContain("livetest-r1-rename-new");
  });

  it("fails when the tag cannot be found after creating the work items", async () => {
    const client = new FakeAdoClient();
    jest.spyOn(client, "listTags").mockResolvedValue([]);

    const result = await renameTagAbility.run(contextFor(client));

    expect(result.status).toBe("fail");
    expect(result.detail).toContain("not found in the tags list");
  });

  it("fails when a work item still carries the old name", async () => {
    const client = new FakeAdoClient();
    jest.spyOn(client, "renameTag").mockResolvedValue({ id: "1", name: "x", url: "" });

    const result = await renameTagAbility.run(contextFor(client));

    expect(result.status).toBe("fail");
    expect(result.detail).toMatch(/still carries/);
  });

  it("reports a sanitized failure when renaming throws", async () => {
    const client = new FakeAdoClient();
    client.failNext("renameTag", "denied for token=abc123");

    const result = await renameTagAbility.run(contextFor(client));

    expect(result.status).toBe("fail");
    expect(result.detail).not.toContain("abc123");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test -- live-test/abilities/renameTag.test.ts`
Expected: FAIL — `Cannot find module './renameTag'`.

- [ ] **Step 3: Write the implementation**

```typescript
// live-test/abilities/renameTag.ts
import { testTag } from "../naming";
import { Ability, AbilityContext, AbilityResult } from "../types";
import { timed } from "./support";

const NAME = "Rename tag";

async function run(ctx: AbilityContext): Promise<AbilityResult> {
  return timed(NAME, async () => {
    const oldName = testTag(ctx.runId, "rename", "old");
    const newName = testTag(ctx.runId, "rename", "new");

    const ids = [
      await ctx.createWorkItem([oldName], `${oldName} #1`),
      await ctx.createWorkItem([oldName], `${oldName} #2`),
    ];

    const before = await ctx.client.listTags();
    const target = before.find((t) => t.name === oldName);
    if (!target) {
      return { ok: false, detail: `${oldName} not found in the tags list` };
    }

    // Record before renaming: if the rename succeeds and a later step throws,
    // cleanup still has to know about the new name.
    ctx.recordTag(newName);
    await ctx.client.renameTag(target.id, newName);

    const after = await ctx.client.getWorkItemTags(ids);
    const stale = after.find((wi) => wi.tags.includes(oldName));
    if (stale) {
      return { ok: false, detail: `work item ${stale.id} still carries ${oldName}` };
    }

    const missing = after.find((wi) => !wi.tags.includes(newName));
    if (missing) {
      return { ok: false, detail: `work item ${missing.id} did not receive ${newName}` };
    }

    const listed = await ctx.client.listTags();
    if (listed.some((t) => t.name === oldName)) {
      return { ok: false, detail: `${oldName} is still present in the tags list` };
    }

    return { ok: true, detail: `renamed across ${ids.length} work items` };
  });
}

export const renameTagAbility: Ability = { name: NAME, run };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test -- live-test/abilities/renameTag.test.ts`
Expected: PASS — all 6 tests.

- [ ] **Step 5: Commit**

```bash
git add live-test/abilities/renameTag.ts live-test/abilities/renameTag.test.ts
git commit -m "feat: add rename tag live-test ability"
```

---

### Task 12: Ability — merge (atomic two-phase)

Mirrors `TagService.mergeTags`: add the target everywhere first, delete sources only afterwards.

**Files:**
- Create: `live-test/abilities/mergeTags.ts`
- Test: `live-test/abilities/mergeTags.test.ts`

**Interfaces:**
- Consumes: `timed`; `testTag`; `Ability`, `AbilityContext`.
- Produces: `export const mergeTagsAbility: Ability` (name `"Merge tags (3->1)"`).

- [ ] **Step 1: Write the failing test**

```typescript
// live-test/abilities/mergeTags.test.ts
import { mergeTagsAbility } from "./mergeTags";
import { FakeAdoClient } from "../test/fakeAdoClient";
import { AbilityContext } from "../types";

function contextFor(client: FakeAdoClient): AbilityContext & { tags: string[] } {
  const tags: string[] = [];
  return {
    client,
    runId: "r1",
    tags,
    createWorkItem: async (tagNames) => {
      tagNames.forEach((t) => tags.push(t));
      return client.createWorkItem("Task", "live test", tagNames);
    },
    recordTag: (name) => tags.push(name),
  };
}

const TARGET = "livetest-r1-merge-target";
const SOURCES = [
  "livetest-r1-merge-a",
  "livetest-r1-merge-b",
  "livetest-r1-merge-c",
];

describe("mergeTags ability", () => {
  it("passes against a client with correct merge semantics", async () => {
    const result = await mergeTagsAbility.run(contextFor(new FakeAdoClient()));
    expect(result).toMatchObject({ name: "Merge tags (3->1)", status: "pass" });
  });

  it("removes every source tag from the project", async () => {
    const client = new FakeAdoClient();
    await mergeTagsAbility.run(contextFor(client));

    for (const source of SOURCES) {
      expect(client.tagNames()).not.toContain(source);
    }
    expect(client.tagNames()).toContain(TARGET);
  });

  it("moves all four work items onto the target tag", async () => {
    const client = new FakeAdoClient();
    await mergeTagsAbility.run(contextFor(client));
    expect(await client.countWorkItemsWithTag(TARGET)).toBe(4);
  });

  it("does not duplicate the target on a work item that already had it", async () => {
    const client = new FakeAdoClient();
    await mergeTagsAbility.run(contextFor(client));

    const ids = await client.queryWorkItemIdsByTag(TARGET);
    for (const id of ids) {
      const occurrences = client.tagsOf(id).filter((t) => t === TARGET).length;
      expect(occurrences).toBe(1);
    }
  });

  it("fails when a source tag survives the merge", async () => {
    const client = new FakeAdoClient();
    jest.spyOn(client, "deleteTag").mockResolvedValue(undefined);

    const result = await mergeTagsAbility.run(contextFor(client));

    expect(result.status).toBe("fail");
    // With delete stubbed out the work items still carry the source, which the
    // ability reports before it reaches the tag-list check.
    expect(result.detail).toMatch(/still carries/);
  });

  it("fails when a work item never receives the target tag", async () => {
    const client = new FakeAdoClient();
    jest.spyOn(client, "setWorkItemTags").mockResolvedValue(undefined);

    const result = await mergeTagsAbility.run(contextFor(client));

    expect(result.status).toBe("fail");
    expect(result.detail).toMatch(/did not receive/);
  });

  it("reports a sanitized failure when the client throws", async () => {
    const client = new FakeAdoClient();
    client.failNext("queryWorkItemIdsByTag", "wiql blew up at https://dev.azure.com/o");

    const result = await mergeTagsAbility.run(contextFor(client));

    expect(result.status).toBe("fail");
    expect(result.detail).not.toContain("https://dev.azure.com");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test -- live-test/abilities/mergeTags.test.ts`
Expected: FAIL — `Cannot find module './mergeTags'`.

- [ ] **Step 3: Write the implementation**

```typescript
// live-test/abilities/mergeTags.ts
import { testTag } from "../naming";
import { Ability, AbilityContext, AbilityResult } from "../types";
import { timed } from "./support";

const NAME = "Merge tags (3->1)";

async function run(ctx: AbilityContext): Promise<AbilityResult> {
  return timed(NAME, async () => {
    const a = testTag(ctx.runId, "merge", "a");
    const b = testTag(ctx.runId, "merge", "b");
    const c = testTag(ctx.runId, "merge", "c");
    const target = testTag(ctx.runId, "merge", "target");
    const sources = [a, b, c];

    const ids = [
      await ctx.createWorkItem([a], `${a} only`),
      await ctx.createWorkItem([a, b], `${a} and ${b}`),
      await ctx.createWorkItem([c], `${c} only`),
      // Already carries the target — proves the merge does not duplicate it.
      await ctx.createWorkItem([c, target], `${c} and target`),
    ];
    ctx.recordTag(target);

    // Phase 1 — additive across every source, nothing removed yet.
    for (const source of sources) {
      const candidates = await ctx.client.queryWorkItemIdsByTag(source);
      const current = await ctx.client.getWorkItemTags(candidates);
      for (const item of current) {
        if (!item.tags.includes(source)) continue; // WIQL CONTAINS is substring-ish
        if (item.tags.includes(target)) continue;
        await ctx.client.setWorkItemTags(item.id, [...item.tags, target]);
      }
    }

    // Phase 2 — delete sources; ADO cascades each off its work items.
    const listed = await ctx.client.listTags();
    for (const source of sources) {
      const tag = listed.find((t) => t.name === source);
      if (!tag) {
        return { ok: false, detail: `${source} disappeared before it could be deleted` };
      }
      await ctx.client.deleteTag(tag.id);
    }

    const after = await ctx.client.getWorkItemTags(ids);
    for (const item of after) {
      const occurrences = item.tags.filter((t) => t === target).length;
      if (occurrences === 0) {
        return { ok: false, detail: `work item ${item.id} did not receive ${target}` };
      }
      if (occurrences > 1) {
        return { ok: false, detail: `work item ${item.id} carries ${target} ${occurrences} times` };
      }
      const leftover = item.tags.find((t) => sources.includes(t));
      if (leftover) {
        return { ok: false, detail: `work item ${item.id} still carries ${leftover}` };
      }
    }

    const finalTags = (await ctx.client.listTags()).map((t) => t.name);
    const survivor = sources.find((s) => finalTags.includes(s));
    if (survivor) {
      return { ok: false, detail: `${survivor} is still present in the tags list` };
    }
    if (!finalTags.includes(target)) {
      return { ok: false, detail: `${target} is missing from the tags list` };
    }

    return { ok: true, detail: `3 sources merged into ${target} across ${ids.length} work items` };
  });
}

export const mergeTagsAbility: Ability = { name: NAME, run };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test -- live-test/abilities/mergeTags.test.ts`
Expected: PASS — all 7 tests.

- [ ] **Step 5: Commit**

```bash
git add live-test/abilities/mergeTags.ts live-test/abilities/mergeTags.test.ts
git commit -m "feat: add atomic merge live-test ability"
```

---

### Task 13: Ability — delete (cascade)

**Files:**
- Create: `live-test/abilities/deleteTag.ts`
- Test: `live-test/abilities/deleteTag.test.ts`

**Interfaces:**
- Consumes: `timed`, `PollSettings`, `FAST_POLL_FOR_TESTS` from `./support`; `pollUntil`; `testTag`.
- Produces: `export const deleteTagAbility: Ability` (name `"Delete tag"`), plus `runWithPollSettings(ctx, poll)` for tests.

- [ ] **Step 1: Write the failing test**

```typescript
// live-test/abilities/deleteTag.test.ts
import { deleteTagAbility, runWithPollSettings } from "./deleteTag";
import { FAST_POLL_FOR_TESTS } from "./support";
import { FakeAdoClient } from "../test/fakeAdoClient";
import { AbilityContext } from "../types";

function contextFor(client: FakeAdoClient): AbilityContext & { tags: string[] } {
  const tags: string[] = [];
  return {
    client,
    runId: "r1",
    tags,
    createWorkItem: async (tagNames) => {
      tagNames.forEach((t) => tags.push(t));
      return client.createWorkItem("Task", "live test", tagNames);
    },
    recordTag: (name) => tags.push(name),
  };
}

describe("deleteTag ability", () => {
  it("passes when the tag is gone and cascaded off every work item", async () => {
    const result = await deleteTagAbility.run(contextFor(new FakeAdoClient()));
    expect(result).toMatchObject({ name: "Delete tag", status: "pass" });
  });

  it("leaves no work item carrying the deleted tag", async () => {
    const client = new FakeAdoClient();
    await deleteTagAbility.run(contextFor(client));
    expect(await client.countWorkItemsWithTag("livetest-r1-delete-a")).toBe(0);
  });

  it("fails when the tag is still listed after deletion", async () => {
    const client = new FakeAdoClient();
    jest.spyOn(client, "deleteTag").mockResolvedValue(undefined);

    const result = await runWithPollSettings(contextFor(client), FAST_POLL_FOR_TESTS);

    expect(result.status).toBe("fail");
    expect(result.detail).toMatch(/still present in the tags list/);
  });

  it("fails when the cascade never reaches the work items", async () => {
    const client = new FakeAdoClient();
    // deleteTag behaves normally (so the tag leaves the list), but the work
    // items are reported as still carrying it — the cascade never lands.
    jest.spyOn(client, "getWorkItemTags").mockResolvedValue([
      { id: 100, tags: ["livetest-r1-delete-a"] },
    ]);

    const result = await runWithPollSettings(contextFor(client), FAST_POLL_FOR_TESTS);

    expect(result.status).toBe("fail");
    expect(result.detail).toMatch(/still carries/);
  });

  it("fails when the tag cannot be found before deletion", async () => {
    const client = new FakeAdoClient();
    jest.spyOn(client, "listTags").mockResolvedValue([]);

    const result = await runWithPollSettings(contextFor(client), FAST_POLL_FOR_TESTS);

    expect(result.status).toBe("fail");
    expect(result.detail).toContain("not found in the tags list");
  });

  it("reports a sanitized failure when deleting throws", async () => {
    const client = new FakeAdoClient();
    client.failNext("deleteTag", "denied, pat=abc123");

    const result = await runWithPollSettings(contextFor(client), FAST_POLL_FOR_TESTS);

    expect(result.status).toBe("fail");
    expect(result.detail).not.toContain("abc123");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test -- live-test/abilities/deleteTag.test.ts`
Expected: FAIL — `Cannot find module './deleteTag'`.

- [ ] **Step 3: Write the implementation**

```typescript
// live-test/abilities/deleteTag.ts
import { testTag } from "../naming";
import { pollUntil } from "../poll";
import { Ability, AbilityContext, AbilityResult } from "../types";
import { PollSettings, timed } from "./support";

const NAME = "Delete tag";

async function run(
  ctx: AbilityContext,
  poll: PollSettings = {}
): Promise<AbilityResult> {
  return timed(NAME, async () => {
    const tag = testTag(ctx.runId, "delete", "a");

    const ids = [
      await ctx.createWorkItem([tag], `${tag} #1`),
      await ctx.createWorkItem([tag], `${tag} #2`),
    ];

    const before = await ctx.client.listTags();
    const target = before.find((t) => t.name === tag);
    if (!target) {
      return { ok: false, detail: `${tag} not found in the tags list` };
    }

    await ctx.client.deleteTag(target.id);

    const listed = await ctx.client.listTags();
    if (listed.some((t) => t.name === tag)) {
      return { ok: false, detail: `${tag} is still present in the tags list after delete` };
    }

    // The cascade onto work items is not guaranteed to be synchronous.
    const cascaded = await pollUntil({
      probe: async () => await ctx.client.getWorkItemTags(ids),
      until: (items) => items.every((wi) => !wi.tags.includes(tag)),
      ...poll,
    });

    if (!cascaded.ok) {
      const stale = cascaded.last.find((wi) => wi.tags.includes(tag));
      return {
        ok: false,
        detail: `work item ${stale?.id} still carries ${tag} after ${cascaded.elapsedMs}ms`,
      };
    }

    return { ok: true, detail: `cascaded off ${ids.length} work items in ${cascaded.elapsedMs}ms` };
  });
}

export const deleteTagAbility: Ability = { name: NAME, run: (ctx) => run(ctx) };

/** Exported for unit tests so the poll budget can be shrunk. */
export const runWithPollSettings = run;
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test -- live-test/abilities/deleteTag.test.ts`
Expected: PASS — all 6 tests.

- [ ] **Step 5: Commit**

```bash
git add live-test/abilities/deleteTag.ts live-test/abilities/deleteTag.test.ts
git commit -m "feat: add delete tag cascade live-test ability"
```

---

### Task 14: Ability — paging/volume

**Files:**
- Create: `live-test/abilities/pagingVolume.ts`
- Test: `live-test/abilities/pagingVolume.test.ts`

**Interfaces:**
- Consumes: `timed`; `testTag`.
- Produces: `export const pagingVolumeAbility: Ability` (name `"Paging/volume (30 tags)"`), `VOLUME_TAG_COUNT = 30`.

- [ ] **Step 1: Write the failing test**

```typescript
// live-test/abilities/pagingVolume.test.ts
import { pagingVolumeAbility, VOLUME_TAG_COUNT } from "./pagingVolume";
import { FakeAdoClient } from "../test/fakeAdoClient";
import { AbilityContext } from "../types";

function contextFor(client: FakeAdoClient): AbilityContext & { tags: string[] } {
  const tags: string[] = [];
  return {
    client,
    runId: "r1",
    tags,
    createWorkItem: async (tagNames) => {
      tagNames.forEach((t) => tags.push(t));
      return client.createWorkItem("Task", "live test", tagNames);
    },
    recordTag: (name) => tags.push(name),
  };
}

describe("pagingVolume ability", () => {
  it("passes when every generated tag comes back from the list endpoint", async () => {
    const result = await pagingVolumeAbility.run(contextFor(new FakeAdoClient()));
    expect(result).toMatchObject({ name: "Paging/volume (30 tags)", status: "pass" });
  });

  it("creates the full volume of tags", async () => {
    const client = new FakeAdoClient();
    await pagingVolumeAbility.run(contextFor(client));
    const created = client.tagNames().filter((n) => n.startsWith("livetest-r1-vol-"));
    expect(created).toHaveLength(VOLUME_TAG_COUNT);
  });

  it("zero-pads tag suffixes so ordering is stable", async () => {
    const client = new FakeAdoClient();
    await pagingVolumeAbility.run(contextFor(client));
    expect(client.tagNames()).toContain("livetest-r1-vol-000");
    expect(client.tagNames()).toContain("livetest-r1-vol-029");
  });

  it("fails and names the missing tags when the list is incomplete", async () => {
    const client = new FakeAdoClient();
    jest.spyOn(client, "listTags").mockResolvedValue([
      { id: "1", name: "livetest-r1-vol-000", url: "" },
    ]);

    const result = await pagingVolumeAbility.run(contextFor(client));

    expect(result.status).toBe("fail");
    expect(result.detail).toMatch(/29 of 30/);
    expect(result.detail).toContain("livetest-r1-vol-001");
  });

  it("reports a sanitized failure when listing throws", async () => {
    const client = new FakeAdoClient();
    client.failNext("listTags", "list failed at https://dev.azure.com/o");

    const result = await pagingVolumeAbility.run(contextFor(client));

    expect(result.status).toBe("fail");
    expect(result.detail).not.toContain("https://dev.azure.com");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test -- live-test/abilities/pagingVolume.test.ts`
Expected: FAIL — `Cannot find module './pagingVolume'`.

- [ ] **Step 3: Write the implementation**

```typescript
// live-test/abilities/pagingVolume.ts
import { testTag } from "../naming";
import { Ability, AbilityContext, AbilityResult } from "../types";
import { timed } from "./support";

const NAME = "Paging/volume (30 tags)";

/** Enough tags to exceed the UI's 25-per-page size. */
export const VOLUME_TAG_COUNT = 30;

async function run(ctx: AbilityContext): Promise<AbilityResult> {
  return timed(NAME, async () => {
    const names = Array.from({ length: VOLUME_TAG_COUNT }, (_, i) =>
      testTag(ctx.runId, "vol", String(i).padStart(3, "0"))
    );

    for (const name of names) {
      await ctx.createWorkItem([name], name);
    }

    const listed = new Set((await ctx.client.listTags()).map((t) => t.name));
    const missing = names.filter((n) => !listed.has(n));

    if (missing.length > 0) {
      return {
        ok: false,
        detail: `${missing.length} of ${VOLUME_TAG_COUNT} tags missing from the list: ${missing
          .slice(0, 3)
          .join(", ")}${missing.length > 3 ? "…" : ""}`,
      };
    }

    return { ok: true, detail: `${VOLUME_TAG_COUNT} tags listed correctly` };
  });
}

export const pagingVolumeAbility: Ability = { name: NAME, run };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test -- live-test/abilities/pagingVolume.test.ts`
Expected: PASS — all 5 tests.

- [ ] **Step 5: Commit**

```bash
git add live-test/abilities/pagingVolume.ts live-test/abilities/pagingVolume.test.ts
git commit -m "feat: add paging volume live-test ability"
```

---

### Task 15: Runner — orchestration and cleanup

**Files:**
- Create: `live-test/runner.ts`
- Test: `live-test/runner.test.ts`

**Interfaces:**
- Consumes: `Ability`, `AbilityContext`, `AbilityResult`, `IAdoClient`; `ManifestStore`; `sanitizeError`.
- Produces:
  - `buildContext(deps: { client, store, runId, workItemType }): AbilityContext`
  - `runAbilities(deps: { client, store, runId, workItemType, abilities, log }): Promise<AbilityResult[]>`
  - `cleanupRun(client: IAdoClient, store: ManifestStore, log: (m: string) => void): Promise<void>`

- [ ] **Step 1: Write the failing test**

```typescript
// live-test/runner.test.ts
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { buildContext, cleanupRun, runAbilities } from "./runner";
import { ManifestStore } from "./manifest";
import { FakeAdoClient } from "./test/fakeAdoClient";
import { Ability } from "./types";

function newStore(): ManifestStore {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "live-test-runner-"));
  return ManifestStore.create(dir, { runId: "r1", org: "o", project: "p" });
}

const passing = (name: string): Ability => ({
  name,
  run: async () => ({ name, status: "pass", durationMs: 1 }),
});

const failing = (name: string): Ability => ({
  name,
  run: async () => ({ name, status: "fail", durationMs: 1, detail: "nope" }),
});

const throwing = (name: string): Ability => ({
  name,
  run: async () => {
    throw new Error("unhandled at https://dev.azure.com/o");
  },
});

describe("buildContext", () => {
  it("records created work items and their tags in the manifest", async () => {
    const client = new FakeAdoClient();
    const store = newStore();
    const ctx = buildContext({ client, store, runId: "r1", workItemType: "Task" });

    const id = await ctx.createWorkItem(["livetest-r1-x-a"]);

    expect(store.manifest.workItems).toEqual([id]);
    expect(store.manifest.tags).toEqual(["livetest-r1-x-a"]);
  });

  it("creates work items of the configured type", async () => {
    const client = new FakeAdoClient();
    const spy = jest.spyOn(client, "createWorkItem");
    const ctx = buildContext({
      client,
      store: newStore(),
      runId: "r1",
      workItemType: "Issue",
    });

    await ctx.createWorkItem(["t"]);

    expect(spy.mock.calls[0][0]).toBe("Issue");
  });

  it("records a tag registered without a work item", () => {
    const store = newStore();
    const ctx = buildContext({
      client: new FakeAdoClient(),
      store,
      runId: "r1",
      workItemType: "Task",
    });

    ctx.recordTag("livetest-r1-rename-new");

    expect(store.manifest.tags).toEqual(["livetest-r1-rename-new"]);
  });
});

describe("runAbilities", () => {
  it("runs every ability in order and returns a result each", async () => {
    const results = await runAbilities({
      client: new FakeAdoClient(),
      store: newStore(),
      runId: "r1",
      workItemType: "Task",
      abilities: [passing("one"), passing("two")],
      log: () => undefined,
    });

    expect(results.map((r) => r.name)).toEqual(["one", "two"]);
  });

  it("continues past a failing ability", async () => {
    const results = await runAbilities({
      client: new FakeAdoClient(),
      store: newStore(),
      runId: "r1",
      workItemType: "Task",
      abilities: [failing("one"), passing("two")],
      log: () => undefined,
    });

    expect(results.map((r) => r.status)).toEqual(["fail", "pass"]);
  });

  it("converts an ability that throws into a sanitized failure and keeps going", async () => {
    const results = await runAbilities({
      client: new FakeAdoClient(),
      store: newStore(),
      runId: "r1",
      workItemType: "Task",
      abilities: [throwing("one"), passing("two")],
      log: () => undefined,
    });

    expect(results[0].status).toBe("fail");
    expect(results[0].detail).not.toContain("https://dev.azure.com");
    expect(results[1].status).toBe("pass");
  });

  it("logs a line per ability as it completes", async () => {
    const lines: string[] = [];
    await runAbilities({
      client: new FakeAdoClient(),
      store: newStore(),
      runId: "r1",
      workItemType: "Task",
      abilities: [passing("one")],
      log: (m) => lines.push(m),
    });

    expect(lines.some((l) => l.includes("[PASS] one"))).toBe(true);
  });
});

describe("cleanupRun", () => {
  it("deletes every recorded work item and tag, then marks the manifest cleaned", async () => {
    const client = new FakeAdoClient();
    const store = newStore();
    const ctx = buildContext({ client, store, runId: "r1", workItemType: "Task" });
    const id = await ctx.createWorkItem(["livetest-r1-x-a"]);

    await cleanupRun(client, store, () => undefined);

    expect(await client.countWorkItemsWithTag("livetest-r1-x-a")).toBe(0);
    expect(client.tagNames()).not.toContain("livetest-r1-x-a");
    expect(store.manifest.status).toBe("cleaned");
    // The work item is soft-deleted, so reading it back must fail the way the
    // real batch API does (its default ErrorPolicy is Fail, not Omit).
    await expect(client.getWorkItemTags([id])).rejects.toThrow(/404/);
  });

  it("keeps going when one delete fails and still marks the run cleaned", async () => {
    const client = new FakeAdoClient();
    const store = newStore();
    const ctx = buildContext({ client, store, runId: "r1", workItemType: "Task" });
    await ctx.createWorkItem(["livetest-r1-x-a"]);
    await ctx.createWorkItem(["livetest-r1-x-b"]);
    client.failNext("deleteWorkItem", "transient 500");

    const lines: string[] = [];
    await cleanupRun(client, store, (m) => lines.push(m));

    expect(store.manifest.status).toBe("cleaned");
    expect(lines.some((l) => l.includes("transient 500"))).toBe(true);
  });

  it("tolerates a tag that is already gone", async () => {
    const client = new FakeAdoClient();
    const store = newStore();
    store.addTag("never-created");

    await expect(cleanupRun(client, store, () => undefined)).resolves.toBeUndefined();
    expect(store.manifest.status).toBe("cleaned");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test -- live-test/runner.test.ts`
Expected: FAIL — `Cannot find module './runner'`.

- [ ] **Step 3: Write the implementation**

```typescript
// live-test/runner.ts
import { sanitizeError } from "../src/utils/sanitizeError";
import { ManifestStore } from "./manifest";
import { formatResultLine } from "./report";
import { Ability, AbilityContext, AbilityResult, IAdoClient } from "./types";

export interface ContextDeps {
  client: IAdoClient;
  store: ManifestStore;
  runId: string;
  workItemType: string;
}

export function buildContext(deps: ContextDeps): AbilityContext {
  return {
    client: deps.client,
    runId: deps.runId,
    createWorkItem: async (tags, title) => {
      const id = await deps.client.createWorkItem(
        deps.workItemType,
        title ?? `live test ${deps.runId}`,
        tags
      );
      deps.store.addWorkItem(id);
      for (const tag of tags) deps.store.addTag(tag);
      return id;
    },
    recordTag: (name) => deps.store.addTag(name),
  };
}

export interface RunDeps extends ContextDeps {
  abilities: Ability[];
  log: (message: string) => void;
}

export async function runAbilities(deps: RunDeps): Promise<AbilityResult[]> {
  const ctx = buildContext(deps);
  const results: AbilityResult[] = [];

  for (const ability of deps.abilities) {
    const start = Date.now();
    let result: AbilityResult;
    try {
      result = await ability.run(ctx);
    } catch (e) {
      // Abilities are expected to return failures rather than throw, but a bug
      // in one must never stop the remaining abilities from running.
      result = {
        name: ability.name,
        status: "fail",
        durationMs: Date.now() - start,
        detail: sanitizeError(e),
      };
    }
    results.push(result);
    deps.log(formatResultLine(result));
  }

  return results;
}

/**
 * Best-effort teardown: every work item is soft-deleted and every tag removed.
 * Individual failures are logged and skipped — a 404 on something already gone
 * must not strand the rest of the run's data.
 */
export async function cleanupRun(
  client: IAdoClient,
  store: ManifestStore,
  log: (message: string) => void
): Promise<void> {
  const { workItems, tags } = store.manifest;
  log(`Cleaning up ${workItems.length} work items and ${tags.length} tags…`);

  for (const id of workItems) {
    try {
      await client.deleteWorkItem(id);
    } catch (e) {
      log(`  could not delete work item ${id}: ${sanitizeError(e)}`);
    }
  }

  for (const tag of tags) {
    try {
      await client.deleteTag(tag);
    } catch (e) {
      log(`  could not delete tag ${tag}: ${sanitizeError(e)}`);
    }
  }

  store.markCleaned();
  log("Cleanup complete.");
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test -- live-test/runner.test.ts`
Expected: PASS — all 10 tests.

- [ ] **Step 5: Commit**

```bash
git add live-test/runner.ts live-test/runner.test.ts
git commit -m "feat: add live-test runner orchestration and cleanup"
```

---

### Task 16: Wire the entry point and run it against a real project

**Files:**
- Create: `live-test/abilities/index.ts`
- Modify: `live-test/cli.ts` (add `main()` and the module entry guard)
- Modify: `live-test/cli.test.ts` (append tests for the cleanup dispatch)
- Modify: `package.json` (add the `live-test` script)

**Interfaces:**
- Consumes: everything built so far.
- Produces: `ALL_ABILITIES: Ability[]`, `main(argv: string[], io?: MainIo): Promise<number>` where `MainIo = { log: (m: string) => void; ask: (q: string) => Promise<string>; now: () => Date }`.

- [ ] **Step 1: Create the ability registry**

Order matters only for readability — each ability is independent.

```typescript
// live-test/abilities/index.ts
import { Ability } from "../types";
import { deleteTagAbility } from "./deleteTag";
import { listTagsAndCountsAbility } from "./listTagsAndCounts";
import { mergeTagsAbility } from "./mergeTags";
import { pagingVolumeAbility } from "./pagingVolume";
import { renameTagAbility } from "./renameTag";

export const ALL_ABILITIES: Ability[] = [
  listTagsAndCountsAbility,
  renameTagAbility,
  mergeTagsAbility,
  deleteTagAbility,
  pagingVolumeAbility,
];
```

- [ ] **Step 2: Write the failing test for `main()`**

Append to `live-test/cli.test.ts`:

```typescript
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
});
```

The `--cleanup` test exercises real `AdoClient` construction but never reaches the
network, because the manifest carries no work items or tags.

Do **not** add a unit test for `--cleanup-all` here: it reads the repo's real
`.live-test-runs/` directory, so a leftover in-progress manifest from a local run would
make the test attempt live deletes against a real org with a bogus PAT. The flag's parsing
is covered by the Task 8 tests, and its behaviour is exercised by the CI sweep step in
Task 17.

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm test -- live-test/cli.test.ts`
Expected: FAIL — `main is not a function`.

- [ ] **Step 4: Implement `main()`**

Append to `live-test/cli.ts` (and add the imports at the top of the file):

```typescript
import * as readline from "node:readline/promises";
import { AdoClient } from "./adoClient";
import { ALL_ABILITIES } from "./abilities";
import { ManifestStore, listManifestPaths, RUNS_DIR } from "./manifest";
import { newRunId } from "./naming";
import { allPassed, buildReport, formatSummary, writeReport } from "./report";
import { cleanupRun, runAbilities } from "./runner";
```

```typescript
export interface MainIo {
  log: (message: string) => void;
  ask: (question: string) => Promise<string>;
  now: () => Date;
}

const defaultIo: MainIo = {
  log: (m) => console.log(m),
  ask: async (question) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    try {
      return await rl.question(question);
    } finally {
      rl.close();
    }
  },
  now: () => new Date(),
};

export async function main(argv: string[], io: MainIo = defaultIo): Promise<number> {
  let opts;
  try {
    opts = parseCliArgs(argv);
  } catch (e) {
    io.log(e instanceof CliError ? e.message : String(e));
    return 2;
  }

  if (opts.mode === "cleanup" || opts.mode === "cleanup-all") {
    const paths =
      opts.mode === "cleanup"
        ? [opts.manifestPath as string]
        : listManifestPaths(RUNS_DIR).filter(
            (p) => ManifestStore.open(p).manifest.status === "in-progress"
          );

    for (const manifestPath of paths) {
      const store = ManifestStore.open(manifestPath);
      io.log(`Cleaning ${manifestPath} (${store.manifest.project})`);
      const client = new AdoClient({
        orgUrl: store.manifest.org,
        project: store.manifest.project,
        pat: opts.pat,
      });
      await cleanupRun(client, store, io.log);
    }
    if (paths.length === 0) io.log("Nothing to clean up.");
    return 0;
  }

  const org = opts.org as string;
  const project = opts.project as string;

  io.log(`Live Test Harness\nOrg:      ${org}\nProject:  ${project}\n`);
  io.log("This will create work items and tags in the above project, modify them, and delete them.\n");

  if (!opts.yes) {
    const answer = await io.ask(`Type the project name to continue: `);
    if (!confirmationMatches(answer, project)) {
      io.log("Aborted — the name entered did not match the target project.");
      return 1;
    }
  }

  const startedAt = io.now();
  const runId = newRunId(startedAt);
  const client = new AdoClient({ orgUrl: org, project, pat: opts.pat });
  const store = ManifestStore.create(RUNS_DIR, { runId, org, project });
  io.log(`Run ${runId} — manifest: ${store.path}\n`);

  const results = await runAbilities({
    client,
    store,
    runId,
    workItemType: opts.workItemType,
    abilities: ALL_ABILITIES,
    log: io.log,
  });

  const report = buildReport(
    {
      runId,
      org,
      project,
      startedAt: startedAt.toISOString(),
      finishedAt: io.now().toISOString(),
    },
    results
  );
  const written = writeReport(RUNS_DIR, report);
  io.log(`\n${formatSummary(results, written)}`);

  const shouldClean =
    opts.yes ||
    confirmYes(
      await io.ask(
        `\nDelete ${store.manifest.workItems.length} test work items and ${store.manifest.tags.length} test tags? [y/N] `
      )
    );

  if (shouldClean) {
    await cleanupRun(client, store, io.log);
  } else {
    io.log(`\nLeft in place. Clean up later with:\n  pnpm live-test --cleanup ${store.path} --pat <pat>`);
  }

  return allPassed(results) ? 0 : 1;
}

function confirmYes(answer: string): boolean {
  return /^y(es)?$/i.test(answer.trim());
}

// Entry point when run via `tsx live-test/cli.ts`.
if (require.main === module) {
  void main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
```

- [ ] **Step 5: Add the package.json script**

Add to `"scripts"`:

```json
"live-test": "tsx live-test/cli.ts"
```

- [ ] **Step 6: Run the full suite**

Run: `pnpm test`
Expected: PASS — every project, every test.

- [ ] **Step 7: Verify the CLI surface without touching a real org**

Run: `pnpm live-test --pat x`
Expected: usage text printed, exit code 2.

Run: `pnpm live-test --cleanup-all --pat x`
Expected: `Nothing to clean up.`, exit code 0.

- [ ] **Step 8: Run once against a real Azure DevOps project**

This is the first step that touches the network. It needs a scratch project and a PAT with Work Items (read & write) and Analytics (read).

Run:
```bash
pnpm live-test --org https://dev.azure.com/<your-org> --project <scratch-project> --pat <pat>
```

Expected: the confirmation prompt appears; after typing the project name, five ability lines print, a summary and report path print, and the cleanup prompt appears. Answer `y` and confirm the manifest ends as `"status": "cleaned"`.

**If no real org is available to the implementer, stop here and report that Step 8 could not be executed** — do not mark the task complete on unit tests alone.

- [ ] **Step 9: Commit**

```bash
git add live-test/abilities/index.ts live-test/cli.ts live-test/cli.test.ts package.json
git commit -m "feat: wire live-test CLI entry point and ability registry"
```

---

### Task 17: CI workflow and documentation

**Files:**
- Create: `.github/workflows/live-test.yml`
- Modify: `README.MD` (Script Reference, Private Pre-Release Testing Workflow, new CI section)

**Interfaces:**
- Consumes: the `live-test` npm script and its exit-code contract.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Write the workflow**

Action versions match the existing `.github/workflows/build.yml`. The `environment:` key is what gates the secret behind approval.

```yaml
name: Live Test

on:
  workflow_dispatch:
    inputs:
      work_item_type:
        description: Work item type to create for test data
        required: false
        default: Task

permissions:
  contents: read

jobs:
  live-test:
    name: Run live test harness
    runs-on: ubuntu-latest
    # Secrets are exposed only after this environment's protection rules pass.
    # That approval replaces the CLI's interactive confirmation, which has no
    # terminal to run in here.
    environment: live-test

    steps:
      - uses: actions/checkout@v6

      - uses: pnpm/action-setup@v5
        with:
          version: 9

      - name: Setup Node.js
        uses: actions/setup-node@v6
        with:
          node-version: 24
          cache: "pnpm"

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Run live test harness
        env:
          AZDO_TEST_ORG_URL: ${{ vars.AZDO_TEST_ORG_URL }}
          AZDO_TEST_PROJECT: ${{ vars.AZDO_TEST_PROJECT }}
          AZDO_TEST_PAT: ${{ secrets.AZDO_TEST_PAT }}
          # Passed via env, never interpolated into the script body: a `${{ }}`
          # expression inside `run:` lets a crafted input execute as shell.
          WORK_ITEM_TYPE: ${{ inputs.work_item_type }}
        run: |
          pnpm live-test \
            --org "$AZDO_TEST_ORG_URL" \
            --project "$AZDO_TEST_PROJECT" \
            --pat "$AZDO_TEST_PAT" \
            --work-item-type "$WORK_ITEM_TYPE" \
            --yes

      - name: Sweep up any data left by a failed run
        if: failure()
        env:
          AZDO_TEST_PAT: ${{ secrets.AZDO_TEST_PAT }}
        run: pnpm live-test --cleanup-all --pat "$AZDO_TEST_PAT"

      - name: Upload run manifest and report
        if: always()
        # SHA-pinned to match build.yml's existing style — this workflow handles a PAT.
        uses: actions/upload-artifact@b7c566a772e6b6bfb58ed0dc250532a479d7789f #v6.0.0
        with:
          name: live-test-run
          path: .live-test-runs/
          if-no-files-found: warn
```

- [ ] **Step 2: Validate the workflow parses**

Run: `python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/live-test.yml'))" && echo OK`
Expected: `OK`.

- [ ] **Step 3: Update the README Script Reference**

Add to the bullet list in the "Script Reference" section, after the existing `pnpm test:coverage` line:

```markdown
- `pnpm live-test`: Run the live API test harness against a real org/project (see Live Testing)
```

- [ ] **Step 4: Replace the manual validation step**

In the "Private Pre-Release Testing Workflow" section, replace the recommended-rollout item that reads `2. Validate core scenarios (merge, rename, delete, count, paging, alpha filter).` with:

```markdown
2. Validate the server-backed scenarios automatically: `pnpm live-test --org <url> --project <project> --pat <pat>`
```

- [ ] **Step 5: Add a Live Testing section to the README**

Insert a new section immediately before "Continuous Integration Quality Gates":

```markdown
## Live Testing

The live test harness creates real work items and tags in a target project,
exercises every server-backed ability of the extension, reports pass/fail per
ability, and offers to delete everything it created.

```bash
pnpm live-test --org https://dev.azure.com/<org> --project <project> --pat <pat>
```

The PAT needs Work Items (Read & Write) and Analytics (Read).

Flags:

- `--yes` — skip the typed project-name confirmation and auto-clean afterwards
- `--work-item-type <type>` — override the default `Task`
- `--cleanup <manifest.json>` — delete everything recorded in one run manifest
- `--cleanup-all` — delete everything in every manifest still marked in-progress

Every run writes `.live-test-runs/<runId>.json` (a manifest of everything it
created) and `.live-test-runs/<runId>-report.json`. If a run is interrupted, the
manifest is what lets a later `--cleanup` remove the leftovers. Work items are
soft-deleted to the project Recycle Bin, never destroyed.

### Running it in CI

`.github/workflows/live-test.yml` runs the harness on manual dispatch only. It
targets the `live-test` GitHub Environment, which a repository admin must create
once under **Settings → Environments** with:

| Kind | Name | Value |
|---|---|---|
| Secret | `AZDO_TEST_PAT` | PAT with Work Items (Read & Write) + Analytics (Read) |
| Variable | `AZDO_TEST_ORG_URL` | `https://dev.azure.com/<org>` |
| Variable | `AZDO_TEST_PROJECT` | Scratch project name |

Add **required reviewers** to that environment. The approval is what replaces
the interactive confirmation prompt, which cannot run in a workflow — it is the
only thing standing between a mistyped variable and churn in a real project.
```

- [ ] **Step 6: Run the full suite one more time**

Run: `pnpm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add .github/workflows/live-test.yml README.MD
git commit -m "feat: add manually-triggered live test workflow and docs"
```

---

## Self-Review Notes

Checked against `docs/superpowers/specs/2026-09-15-live-test-harness-design.md`:

- **Spec coverage** — Phase 1 architecture (Tasks 3–8, 15, 16), the five abilities and their exact assertions (Tasks 10–14), eventual consistency (Task 4, used in Tasks 10 and 13), manifest/crash recovery (Task 3), cleanup semantics incl. soft delete (Tasks 15, 16), console + JSON reporting (Task 5), safety incl. typed confirmation and the exit-code contract (Tasks 8, 16), CI integration (Task 17), and both "Files to Modify" entries for Phase 1 (`package.json`, `.gitignore`, `README.MD`). Phase 2 files are deliberately absent — they are in the Phase 2 plan.
- **Type consistency** — `IAdoClient` is declared once (Task 3) and implemented by both `AdoClient` (Tasks 6–7) and `FakeAdoClient` (Task 9); `AbilityContext.createWorkItem`/`recordTag` have the same signature in the type, the runner's `buildContext`, and every ability test helper; `pollUntil` returns `{ ok, last, elapsedMs, attempts }` everywhere it is consumed.
- **Known gap accepted by the spec** — the merge ability re-implements `TagService.mergeTags`'s two-phase sequence rather than calling it, because `TagService` cannot run outside an ADO iframe. Task 2 removes the riskiest part of that duplication (tag string encoding) but the sequencing itself is duplicated by design.
