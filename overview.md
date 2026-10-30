# Tag Toolkit for Azure Boards

Keep your Azure Boards tags clean and consistent. Tag Toolkit gives you a single hub to view, rename, merge, and delete tags across the current project — without touching work items one by one.

## What It Does

Tag Toolkit adds a **Tag Toolkit** hub to Azure Boards. From there you can:

- **View all tags** in the current project with cached organization-wide counts of how many work items use each one
- **Rename a tag** — the change is applied to every matching work item automatically
- **Merge tags** — replace one or more source tags with a target on matching work items, preserving concurrent edits with revision checks
- **Delete tags** — remove one or more tags from every work item that carries them
- **Inspect run history** — view per-card tag evidence for each rename, merge, or batch delete and export the entire run to CSV

## Finding Tags

The tag list is searchable and filterable so you can quickly find what you need:

- **Search bar** — filter by any part of the tag name
- **Starts with** — show only tags that begin with a specific letter, or `#` for numbers and symbols
- **Sorting** — order the list by tag name or by work item count; sort by count to bring unused tags to the top
- **Pagination** — tags load 25 at a time so the page stays fast even with large tag sets

## Safe by Design

Every destructive operation (merge, delete) shows a confirmation dialog before anything changes. You see exactly which tags will be affected before you commit. Counts may be up to 24 hours old until you use **Refresh counts**.

Merge updates work items individually and leaves source tags in the project catalog. Work items that acquire a source tag after enumeration keep it and may need another merge. If a merge partially fails, some items may already be updated; failed sources remain selected for a safe retry. Use **Delete** separately only when you intend to remove a tag project-wide.

Rename operations apply immediately inline — useful for quick corrections without needing to open a dialog.

## Run History and CSV Reports

Each confirmed action creates a separate run. Select **Run history** to browse
recent runs or **View latest run** after an edit. Each report includes the
initiating user, timestamps, inputs, outcome, and one row per captured card.
The table shows before/after tags, recorded additions/removals, verification
status, and failures. Expand **Change evidence** to inspect individual source
changes when several tags affected the same card.

**Export run to CSV** downloads every captured card, not just the current page,
with run context and evidence limitations. Partial, failed, and zero-card runs
can also be exported. Spreadsheet-sensitive values are escaped.

Merge reports record revision-checked direct updates. Rename and delete use
before/after observations; these can include another user's intervening edits
and are not proof that the toolkit caused every difference. Their initial
snapshot must finish before editing begins, which adds time to large runs.
Failed verification is **unverified**, and missing data is **Unknown**, not an
empty tag set. Cards acquiring tags after enumeration may not be captured.
Delete reports do not enumerate pull-request effects.

An update can commit even if its response is lost. Merge reports retain
ambiguous attempts, including intended-but-unverified tags, rather than call a
later retry a confirmed no-op. A successful retry records its own baseline
without erasing earlier uncertainty. Snapshot batches are also saved as they
are captured; a later capture failure retains earlier, not-attempted cards.

History is grouped by project in the UI, but its shared extension storage is
accessible organization-wide to users of this extension, without per-card
permission filtering. Reports can reveal tag values even when the viewer
cannot open the card. Do not treat project grouping as an authorization
boundary or the read-only UI as tamper-proof auditing.

Runs expire **90 days after starting**. Expired records are hidden and physically
deleted when that project's history is next accessed, including before a new
edit. There is no background deletion service while the extension is closed.
Export records needed longer.

If a run cannot be created, the edit is blocked. If recording fails during a
run, further edits stop and the page offers **Download recovery CSV** from the
latest report. Download it before leaving: it may contain results that could
not be saved. Edits and history cannot be committed together, so unlogged
changes are still possible. Already-issued requests are not rolled back.
Interrupted runs retain saved evidence; after five minutes without a saved
checkpoint they are labeled inactive/possibly interrupted, not definitively
abandoned. They may still be running. There is no automatic resume or undo.

History uses a 32 KiB application safety limit per stored document and refuses
potentially incomplete collections at the documented 100,000-document retrieval
ceiling. Capacity and access errors are visible; reports are never silently
truncated. These bounds are not promises about Azure DevOps storage quotas.

## Typical Use Cases

- Standardize inconsistent tags created over time (e.g. `frontend`, `front-end`, `ui`)
- Consolidate duplicate tag sets after team or project merges
- Remove obsolete tags that no longer serve a planning or reporting purpose
- Keep board filters and dashboard queries consistent as your taxonomy evolves

## Getting Started

1. Install Tag Toolkit from the Azure DevOps Marketplace.
2. Open a project in **Azure Boards** and select the **Tag Toolkit** hub from the left navigation.
3. Browse or search for the tags you want to manage.
4. Select one or more tags, then choose **Merge**, **Delete**, or click a tag name to **Rename** it inline.

## Required Permissions

Tag Toolkit requests the following Azure DevOps scopes:

| Scope            | Purpose                                   |
| ---------------- | ----------------------------------------- |
| `vso.analytics`  | Read tag usage counts via Azure Analytics |
| `vso.work`       | Read work item data                       |
| `vso.work_write` | Update work item tags                     |

## Compatibility

- Azure DevOps Services

## Support

- Source code and releases: https://github.com/JJKW1984/tag-toolkit-azure-boards
- Bug reports and questions: https://github.com/JJKW1984/tag-toolkit-azure-boards/issues
