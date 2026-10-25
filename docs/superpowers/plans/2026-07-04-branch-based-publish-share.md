# Branch-Based Publish/Share Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `.github/workflows/build.yml` publish publicly on a PR into `main`, and publish privately + share with configured Azure DevOps organizations on a push/PR into `dev` (or a manual dispatch off any non-`main` branch).

**Architecture:** Extract the existing inline `resolve-manifest` bash logic out of the YAML `run:` block into a standalone, unit-testable shell script (`scripts/resolve-manifest.sh`) that also emits a new `path` output (`publish` or `share`). Add a `push` trigger for `dev`. Add a final `share` step gated on `path == 'share'`, using a new `vars.SHARE_ACCOUNTS` repository variable.

**Tech Stack:** GitHub Actions (YAML), bash, `jessehouwing/azdo-marketplace` actions (`query-version`, `package`, `publish`, `wait-for-validation`, `share`).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-04-branch-based-publish-share-design.md`
- `pull_request` trigger branches stay `main`, `dev` (unchanged).
- New `push` trigger: branch `dev` only.
- `TARGET == main` → publish path (public manifest `vss-extension.json`, id `tag-toolkit-azure-boards`).
- `TARGET != main` → share path (private manifest `vss-extension-dev.json`, id `tag-toolkit-azure-boards-develop`).
- Publish and wait-for-validation steps run for **both** paths, unchanged from today.
- Share step runs **only** on the share path, using `jessehouwing/azdo-marketplace/share@main`.
- New variable: `vars.SHARE_ACCOUNTS` (newline-separated org names), referenced but not created by this plan — repo/org variable creation is an out-of-band admin action (see Task 4 notes).
- Existing action pinning style in this repo is `@main` for all `jessehouwing/azdo-marketplace/*` actions — match it for the new `share` step.
- Repo shell for local verification is Git Bash (bash available via the Bash tool on this Windows machine).

---

### Task 1: Extract `resolve-manifest` logic into a tested script

**Files:**
- Create: `scripts/resolve-manifest.sh`
- Create: `scripts/resolve-manifest.test.sh`
- Modify: `.github/workflows/build.yml:39-51` (the `resolve-manifest` step)

**Interfaces:**
- Produces: `scripts/resolve-manifest.sh` — callable as `resolve-manifest.sh <base_ref> <ref_name>`, appends `extension-id=...`, `manifest-file=...`, `path=...` lines to `$GITHUB_OUTPUT` when run as a script. Also defines two sourceable functions: `resolve_target(base_ref, ref_name) -> stdout target`, `resolve_outputs(target) -> stdout output lines`.
- Consumes: nothing from other tasks (first task).

- [ ] **Step 1: Write the script with sourceable functions**

Create `scripts/resolve-manifest.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

# Resolves the branch name a workflow run targets: the PR base branch if
# this is a pull_request event, otherwise the ref name (push or
# workflow_dispatch).
resolve_target() {
  local base_ref="$1"
  local ref_name="$2"
  if [[ -n "$base_ref" ]]; then
    echo "$base_ref"
  else
    echo "$ref_name"
  fi
}

# Emits the manifest/extension-id/path GITHUB_OUTPUT lines for a given
# resolved target branch.
resolve_outputs() {
  local target="$1"
  if [[ "$target" == "main" ]]; then
    echo "extension-id=tag-toolkit-azure-boards"
    echo "manifest-file=vss-extension.json"
    echo "path=publish"
  else
    echo "extension-id=tag-toolkit-azure-boards-develop"
    echo "manifest-file=vss-extension-dev.json"
    echo "path=share"
  fi
}

# Only run as a script (not when sourced for testing).
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  base_ref="${1:-}"
  ref_name="${2:-}"
  target="$(resolve_target "$base_ref" "$ref_name")"
  resolve_outputs "$target" >> "${GITHUB_OUTPUT:?GITHUB_OUTPUT not set}"
fi
```

- [ ] **Step 2: Write the failing test**

Create `scripts/resolve-manifest.test.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$script_dir/resolve-manifest.sh"

failures=0

assert_eq() {
  local desc="$1" expected="$2" actual="$3"
  if [[ "$expected" != "$actual" ]]; then
    echo "FAIL: $desc"
    echo "  expected: $expected"
    echo "  actual:   $actual"
    failures=$((failures + 1))
  else
    echo "PASS: $desc"
  fi
}

# resolve_target: PR event uses base_ref over ref_name
assert_eq "resolve_target prefers base_ref" "main" "$(resolve_target "main" "some-feature-branch")"

# resolve_target: push/dispatch event has empty base_ref, falls back to ref_name
assert_eq "resolve_target falls back to ref_name" "dev" "$(resolve_target "" "dev")"

# resolve_outputs: main -> publish path
main_outputs="$(resolve_outputs "main")"
assert_eq "main extension-id" "extension-id=tag-toolkit-azure-boards" "$(echo "$main_outputs" | sed -n '1p')"
assert_eq "main manifest-file" "manifest-file=vss-extension.json" "$(echo "$main_outputs" | sed -n '2p')"
assert_eq "main path" "path=publish" "$(echo "$main_outputs" | sed -n '3p')"

# resolve_outputs: dev -> share path
dev_outputs="$(resolve_outputs "dev")"
assert_eq "dev extension-id" "extension-id=tag-toolkit-azure-boards-develop" "$(echo "$dev_outputs" | sed -n '1p')"
assert_eq "dev manifest-file" "manifest-file=vss-extension-dev.json" "$(echo "$dev_outputs" | sed -n '2p')"
assert_eq "dev path" "path=share" "$(echo "$dev_outputs" | sed -n '3p')"

# resolve_outputs: any other branch -> share path (same as dev)
feature_outputs="$(resolve_outputs "some-feature-branch")"
assert_eq "feature extension-id" "extension-id=tag-toolkit-azure-boards-develop" "$(echo "$feature_outputs" | sed -n '1p')"
assert_eq "feature path" "path=share" "$(echo "$feature_outputs" | sed -n '3p')"

if [[ "$failures" -gt 0 ]]; then
  echo "$failures assertion(s) failed"
  exit 1
fi

echo "All assertions passed"
```

- [ ] **Step 3: Run the test to verify it currently fails (script doesn't exist yet if done out of order) or passes (since Step 1 already wrote the script)**

Run: `bash scripts/resolve-manifest.test.sh`
Expected: `All assertions passed` — every `PASS:` line, `0` failures.

(Note: because Step 1 wrote the real implementation directly, this step is
confirmation rather than a red-then-green cycle. That's acceptable here
since the implementation is a pure, already-fully-specified mapping — but
run it now to catch typos before wiring it into the workflow.)

- [ ] **Step 4: Wire the workflow step to call the script**

In `.github/workflows/build.yml`, replace the `resolve-manifest` step (current lines 39-51):

```yaml
      - id: resolve-manifest
        name: Resolve manifest and extension ID
        shell: bash
        run: |
          TARGET="${{ github.base_ref }}"
          if [[ -z "$TARGET" ]]; then TARGET="${{ github.ref_name }}"; fi
          if [[ "$TARGET" == "main" ]]; then
            echo "extension-id=tag-toolkit-azure-boards"        >> "$GITHUB_OUTPUT"
            echo "manifest-file=vss-extension.json"    >> "$GITHUB_OUTPUT"
          else
            echo "extension-id=tag-toolkit-azure-boards-develop"   >> "$GITHUB_OUTPUT"
            echo "manifest-file=vss-extension-dev.json"   >> "$GITHUB_OUTPUT"
          fi
```

with:

```yaml
      - id: resolve-manifest
        name: Resolve manifest and extension ID
        shell: bash
        run: scripts/resolve-manifest.sh "${{ github.base_ref }}" "${{ github.ref_name }}"
```

- [ ] **Step 5: Validate the workflow YAML still parses**

Run: `python -c "import yaml; yaml.safe_load(open('.github/workflows/build.yml'))" && echo "YAML OK"`
Expected: `YAML OK`

- [ ] **Step 6: Commit**

```bash
git add scripts/resolve-manifest.sh scripts/resolve-manifest.test.sh .github/workflows/build.yml
git commit -m "refactor: extract resolve-manifest logic into a tested script, add path output"
```

---

### Task 2: Add `push` trigger for `dev`

**Files:**
- Modify: `.github/workflows/build.yml:1-14` (the `on:` block)

**Interfaces:**
- Consumes: nothing.
- Produces: workflow now runs on `push` events to `dev`, in addition to existing `pull_request` (main, dev) and `workflow_dispatch`.

- [ ] **Step 1: Update the trigger block**

In `.github/workflows/build.yml`, replace:

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
```

with:

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

- [ ] **Step 2: Validate the workflow YAML still parses**

Run: `python -c "import yaml; d = yaml.safe_load(open('.github/workflows/build.yml')); assert d[True]['push']['branches'] == ['dev']; print('trigger OK')"`

(Note: PyYAML parses the bare `on:` key as the boolean `True`, not the string `"on"` — this is expected and is why the assertion indexes `d[True]`.)

Expected: `trigger OK`

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/build.yml
git commit -m "feat: trigger build workflow on push to dev"
```

---

### Task 3: Add the conditional share step

**Files:**
- Modify: `.github/workflows/build.yml` (end of the `build` job, after the existing `Wait for validation` step)

**Interfaces:**
- Consumes: `steps.resolve-manifest.outputs.path` and `steps.resolve-manifest.outputs.extension-id` (produced by Task 1's script), `env.PUBLISHER_ID` (existing), `secrets.MARKETPLACE_TOKEN` (existing), `vars.SHARE_ACCOUNTS` (new repo variable, see Task 4 notes).
- Produces: nothing consumed by later tasks (last workflow step).

- [ ] **Step 1: Add the share step**

In `.github/workflows/build.yml`, after the existing final step:

```yaml
      - name: Wait for validation
        uses: jessehouwing/azdo-marketplace/wait-for-validation@main
        with:
          auth-type: pat
          token: ${{ secrets.MARKETPLACE_TOKEN }}
          vsix-file: ${{ steps.package.outputs.vsix-file }}
```

add:

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

- [ ] **Step 2: Validate the workflow YAML still parses and the new step is well-formed**

Run:
```bash
python -c "
import yaml
d = yaml.safe_load(open('.github/workflows/build.yml'))
steps = d['jobs']['build']['steps']
share_steps = [s for s in steps if s.get('name') == 'Share with organizations']
assert len(share_steps) == 1, 'expected exactly one Share with organizations step'
s = share_steps[0]
assert s['if'] == \"steps.resolve-manifest.outputs.path == 'share'\"
assert s['uses'] == 'jessehouwing/azdo-marketplace/share@main'
assert s['with']['accounts'] == '\${{ vars.SHARE_ACCOUNTS }}'
print('share step OK')
"
```
Expected: `share step OK`

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/build.yml
git commit -m "feat: share dev builds with configured orgs after publish"
```

---

### Task 4: Full-file validation and rollout notes

**Files:**
- Read only: `.github/workflows/build.yml` (final state)

**Interfaces:**
- Consumes: the complete file from Tasks 1-3.
- Produces: nothing (final verification task).

- [ ] **Step 1: Validate the complete workflow file end-to-end**

Run:
```bash
python -c "
import yaml
d = yaml.safe_load(open('.github/workflows/build.yml'))
assert d[True]['pull_request']['branches'] == ['main', 'dev']
assert d[True]['push']['branches'] == ['dev']
steps = d['jobs']['build']['steps']
names = [s.get('name') for s in steps]
assert 'Resolve manifest and extension ID' in names
assert 'Publish from VSIX' in names
assert 'Wait for validation' in names
assert 'Share with organizations' in names
print('full workflow OK')
"
```
Expected: `full workflow OK`

- [ ] **Step 2: Run the resolve-manifest unit tests one more time**

Run: `bash scripts/resolve-manifest.test.sh`
Expected: `All assertions passed`

- [ ] **Step 3: Manual verification checklist (record results, no code changes)**

This step has no automated equivalent — GitHub Actions trigger/conditional
behavior can only be fully confirmed by an actual run. After merging this
plan's branch, verify:

1. A PR opened against `main` runs the workflow, resolves `path=publish`,
   and does **not** run the `Share with organizations` step (check the
   Actions run's step list — it should show the step skipped/greyed out).
2. A PR opened against `dev`, or a push to `dev`, runs the workflow,
   resolves `path=share`, and **does** run `Share with organizations`.
3. Before relying on step 2 in production, an admin must create the
   `SHARE_ACCOUNTS` repository (or environment) variable under
   Settings → Secrets and variables → Actions → Variables, containing the
   target Azure DevOps organization name(s), one per line if more than one.
   This is an out-of-band manual action, not part of this code change.

- [ ] **Step 4: Commit (if the checklist surfaced any doc updates)**

If nothing needed changing, skip this commit. Otherwise:

```bash
git add -A
git commit -m "docs: record manual verification notes for branch-based publish/share"
```
