# Tag Toolkit for Azure Boards

Developer guide for building, testing, packaging, and publishing the Tag Toolkit for Azure Boards extension.

For Marketplace listing content, see [`overview.md`](overview.md). For an index of the design and implementation records, see [`docs/README.md`](docs/README.md).

## What This Repository Contains

- Production manifest: `vss-extension.json`
- Development manifest: `vss-extension-dev.json`
- Extension UI and logic: `src/`
- Static assets: `static/`
- Webpack output: `dist/` (generated; not committed)
- API-level live-test harness: `live-test/`
- Local Playwright UI tests: `live-test/ui/`

## Features

- View all tags in the current Azure Boards project with cached organization-wide work item counts
- Rename a tag inline across all matching work items
- Merge one or more tags into a target tag
- Delete one or more tags from all matching work items
- Search and filter tags by name or first letter (A–Z)
- Refresh counts manually or automatically when the 24-hour cache is stale
- Paginate results 25 tags at a time

## Tech Stack

- Azure DevOps Extension SDK v4.2.0
- Azure DevOps Extension API v4.270.0 (Work Item Tracking)
- Azure DevOps UI v2.272.0
- React 16
- TypeScript 5
- Node.js tooling (pnpm, webpack, jest)

## Repository Structure

```text
.
|-- src/
|   |-- app/          # React components (TagManagerApp, TagTable, dialogs, etc.)
|   |-- hub/          # Extension entry point (Hub.tsx, Hub.html)
|   |-- services/     # Tag API and count cache services
|   |-- types/        # TypeScript interfaces
|   `-- utils/        # Input validation and error helpers
|-- static/           # Static assets bundled into dist/
|-- dist/             # Generated webpack build output
|-- live-test/        # PAT-authenticated API and Playwright test harnesses
|-- scripts/          # Manifest and publishing helper scripts
|-- docs/             # Documentation index and historical design records
|-- vss-extension.json
|-- vss-extension-dev.json
|-- package.json
|-- tsconfig.json
`-- README.MD
```

## Prerequisites

Install the following before local development:

1. Node.js 24 (the CI and live-test harness target)
2. pnpm 9
3. Azure DevOps organization for extension testing
4. Azure DevOps Personal Access Token (PAT) for publishing or live testing
5. Visual Studio Marketplace publisher account (for packaging/publishing)

## Development Environment Setup

### 1. Clone and install dependencies

```bash
git clone https://github.com/JJKW1984/tagtidy-azure-boards.git
cd tagtidy-azure-boards
pnpm install
```

### 2. Build and run locally

Use project scripts during development:

```bash
pnpm build
pnpm dev
```

### 3. Run tests

```bash
pnpm test
pnpm test:coverage
```

## Azure DevOps Extension Manifest

The extension definition lives in `vss-extension.json`.

Use `vss-extension-dev.json` for private pre-release validation.

At minimum, keep these fields accurate:
- `id`
- `name`
- `publisher`
- `version`
- `targets`
- `contributions`

When shipping updates, always bump `version`.

## Script Reference

- `pnpm build`: Create production bundle in `dist/`
- `pnpm dev`: Run webpack dev server (port 3000, HTTPS)
- `pnpm test`: Run Jest tests
- `pnpm test:watch`: Run Jest in watch mode
- `pnpm test:coverage`: Run tests with coverage output
- `pnpm live-test`: Run the live API test harness against a real org/project (see Live Testing)
- `pnpm live-test:ui`: Run local Playwright tests against an installed development extension (see Live Testing)
- `pnpm package`: Package production manifest (`vss-extension.json`)
- `pnpm manifest:test`: Regenerate development manifest (`vss-extension-dev.json`)
- `pnpm package:test`: Package development manifest (`vss-extension-dev.json`)

## Tag Operation Notes

Tag operations are implemented through the Work Item Tracking APIs by updating the `System.Tags` field on affected work items.

- Merge and delete show confirmation dialogs before changes are applied.
- Merge adds the target before removing each source; failed sources remain available for retry.
- Tag names are validated and duplicate rename targets are rejected in the UI.
- Tag counts are stored with `IExtensionDataService` at the organization scope and refreshed through Azure Analytics.
- Tag changes use the Azure DevOps Tags API; work-item updates use Work Item Tracking APIs.

## Packaging the Extension

Build and package the production extension:

```bash
pnpm build
npx tfx extension create --manifest-globs vss-extension.json
```

This produces a `.vsix` package.

## Publish the Extension

Publish the production extension:

```bash
npx tfx extension publish \
  --manifest-globs vss-extension.json \
  --publisher "$AZDO_PUBLISHER_ID" \
  --token "$AZDO_PAT"
```

## Private Pre-Release Testing Workflow

Use the development manifest for private validation before production updates.

This repository supports a separate development extension ID so it can coexist with production:
- Production extension ID: `tag-toolkit-azure-boards`
- Development extension ID: `tag-toolkit-azure-boards-develop`

Generate and package the development variant:

```bash
pnpm build
pnpm manifest:test
pnpm package:test
```

Publish the development variant:

```bash
npx tfx extension publish \
  --manifest-globs vss-extension-dev.json \
  --publisher "$AZDO_PUBLISHER_ID" \
  --token "$AZDO_PAT"
```

What this does:
- Creates `vss-extension-dev.json` from the base manifest
- Marks the test variant as `public: false` and `galleryFlags: ["Preview"]`
- Suffixes contribution IDs so the test variant can coexist safely

Recommended rollout:
1. Publish private variant to a test organization/canary org.
2. Validate the server-backed scenarios automatically with `pnpm live-test --org <url> --project <project> --pat <pat>`.
3. Validate the installed UI locally with `pnpm live-test:ui`.
4. Publish public extension only after private validation passes.

## Automated publishing

`.github/workflows/build.yml` builds and tests pull requests targeting `main` or
`dev`, pushes to `dev`, and manual dispatches. The workflow selects the
manifest from the target branch:

- `main`: public manifest `vss-extension.json`, then marketplace publish.
- Any other target: private manifest `vss-extension-dev.json`, then marketplace
  publish and optional sharing with the newline-separated `SHARE_ACCOUNTS`
  repository/environment variable.

The workflow requires `PUBLISHER_ID` and `MARKETPLACE_TOKEN` to be configured
in the repository or organization settings. It uses Node 24 and pnpm 9.

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
manifest is what lets a later `--cleanup` remove the leftovers. Cleanup checks
run-specific provenance before deleting anything. Work items are soft-deleted
to the project Recycle Bin, never destroyed.

**Known limitation — the counts check is not production's counts code.** For
speed, the harness asks Analytics for one tag at a time
(`$filter=Tags/any(t: t/TagName eq '…')`, then counts the returned rows), while
production's `TagCountCacheService.fetchCounts` pages every tagged work item in
the org with `$filter=Tags/any()` and aggregates client-side over lowercased tag
names. A green "List tags + counts" therefore proves that Analytics reports the
right number for a known tag; it does **not** exercise production's filter, its
paging, or its case-folding, so do not read it as coverage of the count feature.

### UI-level tests (local only)

The Playwright suite drives the installed `-develop` extension's real hub in a
browser, covering the components and the client-side behaviors — search, A–Z
navigation, pagination — that the API harness cannot reach.

Prerequisites:

1. The `-develop` extension is installed in the target org (see Private
   Pre-Release Testing Workflow).
2. You can sign in to that org interactively on this machine.
3. The Playwright browser binary is installed: `pnpm exec playwright install
   chromium` (one-time per machine/checkout).

```bash
export LIVE_TEST_ORG=https://dev.azure.com/<org>
export LIVE_TEST_PROJECT=<scratch-project>
export LIVE_TEST_PAT=<pat>
pnpm live-test:ui
```

The first run opens a browser window — sign in when prompted, then the suite
continues automatically (it waits up to 5 minutes for the sign-in to
complete). The session is stored in `.live-test-runs/playwright-profile/` and
reused afterwards. When it expires, the suite fails with a message telling
you to sign in again rather than hanging on a login form.

Set `HEADLESS=1` to run without a visible window (useful for scripted runs
once a session is already stored). It cannot complete an interactive
first-time sign-in, though, since there's no window for a human to sign in
through — leave `HEADLESS` unset for the very first run.

Fixture data is seeded through the REST API before the suite and removed after
it, using the same run manifest as the API harness. If a run is interrupted
before teardown, clean up with `pnpm live-test --cleanup-all --pat <pat>`.

These tests are deliberately **not** part of CI: Azure DevOps sign-in is
interactive, and automating it would need either a fragile stored session or a
tenant-admin-provisioned service principal.

### Running it in CI

`.github/workflows/live-test.yml` runs the harness on manual dispatch only. It
targets the `live-test` GitHub Environment, which a repository admin must create
once under **Settings → Environments** with:

| Kind     | Name                | Value                                                 |
| -------- | ------------------- | ----------------------------------------------------- |
| Secret   | `AZDO_TEST_PAT`     | PAT with Work Items (Read & Write) + Analytics (Read) |
| Variable | `AZDO_TEST_ORG_URL` | `https://dev.azure.com/<org>`                         |
| Variable | `AZDO_TEST_PROJECT` | Scratch project name                                  |

Add **required reviewers** to that environment. The approval is what replaces
the interactive confirmation prompt, which cannot run in a workflow — it is the
only thing standing between a mistyped variable and churn in a real project.

## Continuous Integration Quality Gates

GitHub Actions is defined in `.github/workflows/`. The build workflow installs
dependencies, builds, runs the Jest suite, packages a VSIX, and publishes or
shares it according to the target branch. The live-test workflow is manual and
requires the protected `live-test` environment; it runs the API harness and
always attempts cleanup.

## Update an Existing Extension

For every update:

1. Update code and tests
2. Bump version in `vss-extension.json` (semantic versioning recommended)
3. Rebuild and republish

```bash
pnpm build
npx tfx extension publish \
  --manifest-globs vss-extension.json \
  --publisher "$AZDO_PUBLISHER_ID" \
  --token "$AZDO_PAT"
```

If an installed extension does not update as expected:
- Verify version was incremented
- Confirm publish succeeded to the same publisher/id
- Re-check organization sharing/install permissions

## Security and Safety

- Never commit PATs or secrets
- Use least-privilege PAT scopes
- Validate tag name input before applying bulk updates
- Prefer preview + confirmation for destructive actions (especially delete)

## Contributing

1. Create a feature branch
2. Implement and test changes
3. Open a pull request with clear before/after behavior

## License

MIT
