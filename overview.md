# Tag Toolkit for Azure Boards

Keep your Azure Boards tags clean and consistent. Tag Toolkit gives you a single hub to view, rename, merge, and delete tags across the current project — without touching work items one by one.

## What It Does

Tag Toolkit adds a **Tag Toolkit** hub to Azure Boards. From there you can:

- **View all tags** in the current project with cached organization-wide counts of how many work items use each one
- **Rename a tag** — the change is applied to every matching work item automatically
- **Merge tags** — combine one or more tags into a single target tag, consolidating matching work items in one step
- **Delete tags** — remove one or more tags from every work item that carries them

## Finding Tags

The tag list is searchable and filterable so you can quickly find what you need:

- **Search bar** — filter by any part of the tag name
- **A–Z navigation** — jump to tags starting with a specific letter, or `#` for non-alphabetic tags
- **Pagination** — tags load 25 at a time so the page stays fast even with large tag sets

## Safe by Design

Every destructive operation (merge, delete) shows a confirmation dialog before anything changes. You see exactly which tags will be affected before you commit. Counts may be up to 24 hours old until you use **Refresh Counts**.

Rename operations apply immediately inline — useful for quick corrections without needing to open a dialog.

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

- Source code and releases: https://github.com/JJKW1984/ado-tag-manager
- Bug reports and questions: https://github.com/JJKW1984/ado-tag-manager/issues
