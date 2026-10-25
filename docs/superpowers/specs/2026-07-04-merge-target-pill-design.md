# Merge Dialog — Click-to-Select Target — Design Spec

**Date:** 2026-07-04
**Status:** Approved

## Context

In the Merge Tags dialog (`src/app/MergeDialog.tsx`), the selected tags to merge are shown as a static row of pills (e.g. `1`, `2`), and the user must separately type or pick the destination tag name in the "Target tag" search field below. There is no way to say "merge tag 2 into tag 1" by simply clicking tag 1 — the user has to type its name even though it's already visible right above.

This spec adds click-to-select: clicking one of the source pills sets it as the merge target directly, while keeping the existing search/create-new field for merging into a different existing tag or a brand-new one.

## Behaviour

- Every pill in the "N tags will be merged" row becomes clickable (`cursor: pointer`, hover highlight, `role="button"`, `tabIndex={0}`, Enter/Space activates it — same accessibility treatment as the existing suggestion rows).
- Clicking a source pill calls the existing `selectSuggestion(name)` (sets `targetName` to that tag's name), the same code path already used when picking a suggestion from the list below.
- Clicking the pill that is *already* the current target deselects it (clears `targetName` back to `""`).
- Typing in the text field, or picking a suggestion from the list below, still works exactly as today and overrides any pill-selected target — both read/write the same `targetName` state, so only one can be "the" target at a time.
- A pill is rendered as **selected** when `t.name.toLowerCase() === trimmed.toLowerCase()`. Selected style: switch `PillVariant.outlined` → `PillVariant.standard` (filled) and add a checkmark `iconProps` (or an adjacent small check glyph) plus a tooltip: "Target — other tags will be merged into this one". Unselected pills keep the current outlined style.
- The count label above the pill row changes from a static "N tags will be merged" to a computed count that **excludes** the pill currently selected as target (if any): `sources.length - (isSourceSelectedAsTarget ? 1 : 0)`. Example: 2 sources, one clicked as target → label reads "1 tag will be merged".
- The pill stays in place in the row (it is not moved to a separate area or removed from the row) — only its style and the count label change.

## Bug fix bundled in

`TagService.mergeTags` (`src/services/TagService.ts:135`) takes a `sources: TagItem[]` array and a `targetName: string`. If `targetName` matches the name of one of the entries in `sources`, `addTarget` correctly skips re-adding it to work item tags (already present), but **Phase 2 still deletes it**, because it's in `sources` and its add succeeded — i.e. the destination tag itself gets deleted. This bug already exists today (reachable by manually typing a source's exact name into the target field) and becomes directly reachable via a single click once pills are selectable.

**Fix:** immediately before calling `runMergeJobs`/`tagService.mergeTags`, filter out any entry from `sources` whose name matches `targetName` case-insensitively. This belongs in `TagManagerApp.tsx` at the `onConfirm` call site (`src/app/TagManagerApp.tsx:325`), since that's where `dialog.sources` and the confirmed `targetName` are both available:

```tsx
onConfirm={(targetName) =>
  runMergeJobs(
    dialog.sources.filter(
      (s) => s.name.toLowerCase() !== targetName.toLowerCase()
    ),
    targetName
  )
}
```

## Edge cases

- If the user deselects the only chosen target (clicks the selected pill again) and the field is now empty, `isValid` is `false` and the Merge button remains disabled, same as today's empty-input behavior.
- If, after filtering, zero sources remain (e.g. user selected only one tag total and clicked it as target), the Merge button should still be disabled — merging requires at least one other tag to fold in. `isValid` needs to additionally check that at least one source remains after the target-name filter, not just that `trimmed.length > 0`.
- Suggestions list below already excludes `sources` by id (existing filter, line 27-30) — no change needed there, since a source can only become the target via pill click, not via the suggestion list.

## Files Changed

| File | Change |
|------|--------|
| `src/app/MergeDialog.tsx` | Make source pills clickable/selectable; add selected-state styling; recompute the count label; extend `isValid` to require ≥1 remaining source after excluding the target |
| `src/app/TagManagerApp.tsx` | Filter `dialog.sources` by `targetName` before calling `runMergeJobs`, at the `MergeDialog`'s `onConfirm` call site |

## Verification

1. Select 2 tags, open Merge. Click the first pill — it switches to filled/checkmark style, the count label updates to "1 tag will be merged", and the target field shows that tag's name.
2. Click the same pill again — it deselects, count label reverts to "2 tags will be merged", target field clears, Merge button disables.
3. Click the first pill, then type a different, unrelated tag name in the text field — the pill reverts to unselected style (since `targetName` no longer matches it), and the typed name becomes the target.
4. Select exactly 2 tags, click one as target, click Merge — confirm only the *other* tag is merged and deleted, and the target tag is not deleted (validates the `TagService.mergeTags` self-deletion bug fix).
5. Select exactly 1 tag, open Merge, click it as the target — confirm Merge button stays disabled (no other source remains to merge).
6. Keyboard: tab to a pill, press Enter/Space — confirm it selects the same as a click.
7. Verify light and dark theme — filled pill variant should be legible in both.
