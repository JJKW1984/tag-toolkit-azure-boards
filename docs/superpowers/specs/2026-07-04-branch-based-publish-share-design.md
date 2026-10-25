# Branch-Based Publish/Share for build.yml

## Problem

`.github/workflows/build.yml` currently always packages, publishes, and waits
for marketplace validation regardless of which branch triggered the run. It
has no `push` trigger at all, and there is no way to distribute a development
build to a specific Azure DevOps organization without fully publishing it
publicly.

## Goals

- A PR targeting `main` builds, tests, publishes publicly to the marketplace,
  and waits for validation.
- A push to `dev`, a PR targeting `dev`, or a manual `workflow_dispatch` run
  from any non-`main` branch builds, tests, publishes privately (using the
  existing `vss-extension-dev.json`, which already has `public: false`), waits
  for validation, and then shares the extension with one or more Azure DevOps
  organizations.
- A push directly to `main` does not trigger a publish (publish is
  PR-triggered only for `main`).

## Triggers

```yaml
on:
  workflow_dispatch:
    inputs:
      initial_version:
        description: Initial version when extension does not yet exist
        required: true
        default: 0.1.0
  pull_request:
    branches:
      - main
      - dev
  push:
    branches:
      - dev
```

- `pull_request` on `main`/`dev` is unchanged from today.
- `push` on `dev` is new — today there is no push trigger.
- `workflow_dispatch` is unchanged and remains a manual escape hatch that can
  be run from any branch.

## Path resolution

The existing `resolve-manifest` step already computes `TARGET` from
`github.base_ref` (for PRs) or `github.ref_name` (for push/dispatch), and
already branches manifest/extension-id selection on `TARGET == main`:

- `TARGET == main` → **publish path**: `vss-extension.json` /
  `tag-toolkit-azure-boards` (public).
- otherwise → **share path**: `vss-extension-dev.json` /
  `tag-toolkit-azure-boards-develop` (private).

This step gains one more output, `path`, set to `publish` when
`TARGET == main` and `share` otherwise. No other logic in this step changes.

## Job steps

Steps through packaging are unchanged and run for both paths:
checkout → pnpm setup → install → build → test → query next version → package
VSIX → upload VSIX artifact.

After packaging:

1. **Publish from VSIX** (`jessehouwing/azdo-marketplace/publish@main`) runs
   for both paths, unchanged. The share path needs the extension actually
   published (privately) before it can be shared with an org.
2. **Wait for validation** (`jessehouwing/azdo-marketplace/wait-for-validation@main`)
   runs for both paths, unchanged.
3. **Share with organizations** — new step, only runs when
   `steps.resolve-manifest.outputs.path == 'share'`:

   ```yaml
   - name: Share with organizations
     if: steps.resolve-manifest.outputs.path == 'share'
     uses: jessehouwing/azdo-marketplace/share@main
     with:
       auth-type: pat
       token: ${{ secrets.MARKETPLACE_TOKEN }}
       publisher-id: ${{ env.PUBLISHER_ID }}
       extension-id: ${{ steps.resolve-manifest.outputs.extension-id }}
       accounts: ${{ vars.SHARE_ACCOUNTS }}
   ```

   `vars.SHARE_ACCOUNTS` is a new repository/environment variable holding one
   organization name, or multiple newline-separated organization names,
   passed straight through to the `share` action's `accounts` input.

## Out of scope

- No changes to the build/test steps themselves.
- No changes to version resolution (`query-version` logic is unchanged and
  applies identically to both paths).
- No unshare/cleanup automation — sharing is additive only, per this design.
