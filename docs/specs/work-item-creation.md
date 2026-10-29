# Work Item Creation — Capability Specification

Extracted from the tag toolkit's live-test harness as a standalone capability, so it can be reused in another project. High-level only: no implementation details, language, SDK, or framework choices.

## Purpose

Create a single new work item in an Azure Boards project, seeded with a type, a title, and an initial set of tags.

## Scope

- **In scope:** creating one new work item; setting its type, title, and initial tags; returning enough information for the caller to reference the item afterward.
- **Out of scope:** updating or deleting existing items, batch/bulk creation, setting any field other than title and tags (area path, iteration, assignee, description, etc.), querying or searching for work items.

## Inputs

- **Project** — the Azure Boards project the item belongs to.
- **Work item type** — the type to create (e.g. Task, Bug, User Story). The caller supplies a type name valid for that project's process template.
- **Title** — required, non-empty display text for the item.
- **Tags** — zero or more tag names to apply at creation time.

## Output

- **Work item id** — a stable identifier the caller can use for follow-up (reads, updates, cleanup).
- Success must be unambiguous: the caller can rely on getting an id back if and only if the item was actually created.

## Behavior / Contract

- Creation is a single atomic operation: the item ends up existing with its type, title, and tags all set, or it doesn't exist at all. No partially created item (e.g. missing tags).
- Tags are treated as an unordered set at creation time; duplicates in the input are collapsed before the item is created.
- Tag matching is case-insensitive: a tag differing only by case from one that already exists in the project resolves to the existing tag rather than creating a duplicate. Tags that don't yet exist in the project are created implicitly.
- Work item type is not pre-validated by this capability. If the type isn't valid for the target project, that failure must surface clearly to the caller rather than being silently ignored.
- No default or placeholder title is invented on the caller's behalf — an empty title is a caller error, not something this capability papers over.

## Error Handling

- Any failure (invalid type, permission/auth failure, service/network failure) is surfaced to the caller as an actionable error, never swallowed.
- The caller must be able to tell "nothing was created" apart from "something was created but its id couldn't be determined" — the latter is itself a failure worth flagging, since the caller would otherwise have an untracked, unreferenceable item.
- This capability does not retry on failure. Retry policy, if any, is the caller's responsibility.

## Edge Cases

- Empty tag list → item is created with no tags, not rejected.
- Title with special characters or non-ASCII text → passed through unmodified.
- Very long tag list → no cap defined here; if the platform enforces one, its error passes through as-is.
- Duplicate tag names in the input → treated as a single tag.
- Tag name differing only by case from an existing tag → resolves to the existing tag.

## Non-Goals

- No opinion on how the caller obtains authorization or a connection to the platform — that's assumed to already exist.
- No opinion on whether or how created items are tracked or cleaned up afterward — that's a separate concern from creation itself.
- No bulk/batch creation semantics — one call creates one item.
