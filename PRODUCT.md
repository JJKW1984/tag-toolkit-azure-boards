# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Primary: scrum masters and team leads who keep their team's backlog usable. They open Tag Toolkit a few times per quarter, typically before reporting, after a team or project merge, or when board filters and queries stop returning what they expect. Their job is to make the tag taxonomy consistent without editing work items one by one.

Other audiences (project admins, individual contributors, org-level governance owners) were not confirmed as primary; do not design for them first.

## Product Purpose

Tag Toolkit for Azure Boards is a hub inside Azure Boards where a project's tags can be viewed, renamed, merged and deleted in bulk, with the change applied to every matching work item. It exists because Azure Boards offers no good place to tidy tags, so inconsistent variants (`frontend`, `front-end`, `ui`), duplicates and obsolete tags accumulate and degrade board filters, queries and dashboards. Success is a clean, consistent tag set reached with confidence and without surprises.

## Positioning

Confirmed differentiators, all of which future work should protect:

- **Safe destructive operations.** Merge and delete always show a confirmation naming exactly the tags affected before anything changes.
- **Usage counts to find dead tags.** Organization-wide work item counts per tag (read via Azure Analytics, cached up to 24 hours, refreshable) so tags can be sorted by count and unused ones brought to the top.
- **Merge duplicates in one step.** One or more tags consolidated into a single target tag across all matching work items.
- **Native in Azure Boards.** Lives as a hub in the Boards navigation and is built on Azure DevOps UI components, so it behaves like part of the product.

## Operating Context

- Runs only inside Azure DevOps Services, as a hub in the Azure Boards left navigation (`ms.vss-work-web.work-hub-group`), rendered in an iframe through the Azure DevOps Extension SDK. It cannot be viewed standalone in a browser.
- Tags are listed per current project; counts are organization-wide.
- Typical sessions: standardize inconsistent tags, consolidate duplicate tag sets after team or project merges, remove obsolete tags, keep board filters and dashboard queries consistent as the taxonomy evolves.
- Distributed through the Visual Studio Marketplace; the listing copy lives in `overview.md`.

## Capabilities and Constraints

- Capabilities: list all project tags with cached counts; search by any part of a name; "Starts with" first-letter filter (`#` for numbers and symbols); sort by name or work item count; paginate 25 tags at a time; rename inline (applies immediately, no dialog); merge selected tags into a target tag (confirmation dialog); delete selected tags (confirmation dialog); "Refresh counts", also triggered automatically when the 24-hour cache is stale.
- Permissions requested: `vso.analytics` (read counts), `vso.work` (read work items), `vso.work_write` (update work item tags).
- Compatibility: Azure DevOps Services only. Azure DevOps Server is not targeted.
- Technical constraints: Azure DevOps Extension SDK v4 and API, `azure-devops-ui`, React 16, TypeScript.
- Terminology to keep: "tag", "work item", "Starts with", "Refresh counts", "Merge", "Delete", "Rename".
- Undecided: no internationalization, mobile or narrow-viewport requirement has been stated.

## Brand Commitments

The canonical name is **Tag Toolkit** (Marketplace name "Tag Toolkit for Azure Boards", hub label "Tag Toolkit"). `tagtidy-azure-boards` and `ado-tag-manager` appear in repository URLs and are legacy names, not user-facing. Hub icon is the Fluent Tag icon; the Marketplace logo is `static/images/logo.png`.

## Evidence on Hand

- Marketplace listing copy: `overview.md`.
- Before/after UI screenshots from the last UI review: `docs/superpowers/specs/assets/2026-10-28-ui-review/`.
- Prior design critiques of `src/app` and `src/hub`: `.impeccable/critique/`.
- No customer testimonials, install counts, reviews or usage data exist in the repo. Do not fabricate them.

## Product Principles

1. **Never act silently.** Any operation that removes or rewrites tags across work items is previewed and confirmed first, and its scope is named.
2. **Show use before asking for action.** Counts and their age sit next to every tag so the user can judge what is safe to merge or delete.
3. **Feel like Azure Boards.** Prefer the host's components, theme and conventions over custom controls; the product earns trust by not looking foreign.
4. **Consolidate in one step.** Cleanup is a small number of deliberate actions, not a per-work-item chore.
