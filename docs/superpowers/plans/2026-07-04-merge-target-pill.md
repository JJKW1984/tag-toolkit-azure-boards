# Merge Dialog — Click-to-Select Target Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user click a source pill in the Merge Tags dialog to set it as the merge target, instead of always having to type/select the target name in the separate search field.

**Architecture:** `MergeDialog.tsx` already tracks the target as a single `targetName` string. Clicking a source pill reuses the existing `selectSuggestion` state-setting path, so the pill click and the text field become two inputs to the same piece of state — no new state variable is needed, just new rendering/interaction on the source pills and a corrected `isValid`/count calculation. Separately, `TagManagerApp.tsx` gets a one-line filter fix so a source chosen as its own target is never also sent to the batch-merge/delete call.

**Tech Stack:** React (function components, hooks), TypeScript, Jest + React Testing Library, `azure-devops-ui` component library (mocked in tests via `src/test/mocks/modules/azureDevopsUi.tsx`).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-04-merge-target-pill-design.md`
- Do not change `TagService.mergeTags` itself — the fix is filtering the `sources` array passed into it, at the call site in `TagManagerApp.tsx`.
- Selected-target pill must render with `PillVariant.standard` and `iconProps.iconName: "CheckMark"`; unselected pills keep `PillVariant.outlined` and `iconProps.iconName: "Tag"` (unchanged from today).
- Pills must be operable by both click and keyboard (`Enter`/`Space`), with `role="button"` and `tabIndex={0}`.
- Merge button stays disabled unless there is at least one tag left to merge into the target (existing `isValid` was `trimmed.length > 0`; this must now also require ≥1 remaining source after excluding the target).

---

### Task 1: Make source pills clickable to select/deselect the target, with correct count and validity

**Files:**
- Modify: `src/app/MergeDialog.tsx:22-118`
- Modify: `src/test/mocks/modules/azureDevopsUi.tsx:270-278` (expose `variant`/`iconProps` on the mocked `Pill` so tests can assert selected styling)
- Test: `src/app/MergeDialog.test.tsx`

**Interfaces:**
- Consumes: nothing new — reuses the existing `selectSuggestion(name: string)` function already defined in `MergeDialog.tsx:51-54`.
- Produces: nothing consumed by other tasks — Task 2 only relies on `MergeDialog`'s existing public `onConfirm: (targetName: string) => void` prop, which is unchanged.

- [ ] **Step 1: Update the mocked `Pill` component to surface `variant` and `iconProps` for assertions**

In `src/test/mocks/modules/azureDevopsUi.tsx`, replace the `Pill` mock (lines 270-278):

```tsx
export const Pill: React.FC<
  React.PropsWithChildren<{
    size?: number;
    variant?: number;
    iconProps?: { iconName: string };
    className?: string;
  }>
> = ({ children }) => <span data-testid="pill">{children}</span>;
```

with:

```tsx
export const Pill: React.FC<
  React.PropsWithChildren<{
    size?: number;
    variant?: number;
    iconProps?: { iconName: string };
    className?: string;
  }>
> = ({ children, variant, iconProps }) => (
  <span data-testid="pill" data-variant={variant} data-icon={iconProps?.iconName}>
    {children}
  </span>
);
```

- [ ] **Step 2: Write the failing tests**

Add to `src/app/MergeDialog.test.tsx` (new `import { PillVariant } from "azure-devops-ui/Pill";` at the top, alongside the existing imports):

```tsx
import { PillVariant } from "azure-devops-ui/Pill";
```

Then add these `it` blocks inside the existing `describe("MergeDialog", ...)` block:

```tsx
  it("selects a source tag as the target when its pill is clicked", () => {
    const onConfirm = jest.fn();
    const twoSources = [
      { id: "1", name: "one", url: "u" },
      { id: "2", name: "two", url: "u" },
    ];

    render(
      <MergeDialog
        sources={twoSources}
        allTags={[]}
        onConfirm={onConfirm}
        onCancel={jest.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "one" }));

    expect(
      screen.getByPlaceholderText("Type to search or create a tag")
    ).toHaveValue("one");
    expect(screen.getByText("1 tag will be merged")).toBeInTheDocument();

    const targetPill = screen.getByText("one").closest('[data-testid="pill"]');
    expect(targetPill).toHaveAttribute("data-variant", String(PillVariant.standard));
    expect(targetPill).toHaveAttribute("data-icon", "CheckMark");

    fireEvent.click(screen.getByRole("button", { name: "Merge" }));
    expect(onConfirm).toHaveBeenCalledWith("one");
  });

  it("deselects a source pill when it is clicked again", () => {
    const twoSources = [
      { id: "1", name: "one", url: "u" },
      { id: "2", name: "two", url: "u" },
    ];

    render(
      <MergeDialog
        sources={twoSources}
        allTags={[]}
        onConfirm={jest.fn()}
        onCancel={jest.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "one" }));
    fireEvent.click(screen.getByRole("button", { name: "one" }));

    expect(
      screen.getByPlaceholderText("Type to search or create a tag")
    ).toHaveValue("");
    expect(screen.getByText("2 tags will be merged")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Merge" })).toBeDisabled();
  });

  it("disables Merge when the only source is selected as its own target", () => {
    const oneSource = [{ id: "1", name: "solo", url: "u" }];

    render(
      <MergeDialog
        sources={oneSource}
        allTags={[]}
        onConfirm={jest.fn()}
        onCancel={jest.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "solo" }));

    expect(screen.getByRole("button", { name: "Merge" })).toBeDisabled();
  });

  it("supports selecting a source pill via the keyboard", () => {
    const onConfirm = jest.fn();
    const twoSources = [
      { id: "1", name: "one", url: "u" },
      { id: "2", name: "two", url: "u" },
    ];

    render(
      <MergeDialog
        sources={twoSources}
        allTags={[]}
        onConfirm={onConfirm}
        onCancel={jest.fn()}
      />
    );

    fireEvent.keyDown(screen.getByRole("button", { name: "one" }), { key: "Enter" });

    expect(
      screen.getByPlaceholderText("Type to search or create a tag")
    ).toHaveValue("one");
  });
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm test -- MergeDialog.test.tsx`
Expected: FAIL — `screen.getByRole("button", { name: "one" })` finds no matching element (source pills aren't currently interactive/focusable elements with that accessible name).

- [ ] **Step 4: Implement the pill click/keyboard handling, count label, and validity check**

In `src/app/MergeDialog.tsx`, replace lines 22-44:

```tsx
  const [targetName, setTargetName] = useState("");
  const [highlightedIndex, setHighlightedIndex] = useState(-1);

  const trimmed = targetName.trim();

  const suggestions = allTags.filter((t) => {
    if (sources.some((source) => source.id === t.id)) {
      return false;
    }

    if (trimmed.length === 0) {
      return true;
    }

    return t.name.toLowerCase().includes(trimmed.toLowerCase());
  });

  const isNewTag =
    trimmed.length > 0 &&
    !allTags.some((t) => t.name.toLowerCase() === trimmed.toLowerCase());

  const totalItems = suggestions.length + (isNewTag ? 1 : 0);
  const isValid = trimmed.length > 0;
```

with:

```tsx
  const [targetName, setTargetName] = useState("");
  const [highlightedIndex, setHighlightedIndex] = useState(-1);

  const trimmed = targetName.trim();

  const suggestions = allTags.filter((t) => {
    if (sources.some((source) => source.id === t.id)) {
      return false;
    }

    if (trimmed.length === 0) {
      return true;
    }

    return t.name.toLowerCase().includes(trimmed.toLowerCase());
  });

  const isNewTag =
    trimmed.length > 0 &&
    !allTags.some((t) => t.name.toLowerCase() === trimmed.toLowerCase());

  const totalItems = suggestions.length + (isNewTag ? 1 : 0);

  const targetIsSource = sources.some(
    (t) => t.name.toLowerCase() === trimmed.toLowerCase()
  );
  const remainingSourceCount = targetIsSource ? sources.length - 1 : sources.length;
  const isValid = trimmed.length > 0 && remainingSourceCount > 0;
```

Then add a click/keyboard handler alongside the existing `selectSuggestion` (right after it, currently lines 51-54):

```tsx
  const selectSuggestion = (name: string) => {
    setTargetName(name);
    setHighlightedIndex(-1);
  };

  const handlePillClick = (name: string) => {
    if (trimmed.toLowerCase() === name.toLowerCase()) {
      setTargetName("");
    } else {
      selectSuggestion(name);
    }
  };

  const handlePillKeyDown = (
    e: React.KeyboardEvent<HTMLDivElement>,
    name: string
  ) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      handlePillClick(name);
    }
  };
```

Then replace the count label and source pill row (currently lines 105-118):

```tsx
      <div
        style={{
          fontSize: "11px",
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: "0.5px",
          color: "var(--palette-neutral-60, #666)",
          margin: "12px 0 8px",
        }}
      >
        {sources.length} tag{sources.length !== 1 ? "s" : ""} will be merged
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", margin: "0 0 16px" }}>
        {sources.map((t) => (
          <Pill
            key={t.id}
            size={PillSize.regular}
            variant={PillVariant.outlined}
            iconProps={{ iconName: "Tag" }}
          >
            {t.name}
          </Pill>
        ))}
      </div>
```

with:

```tsx
      <div
        style={{
          fontSize: "11px",
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: "0.5px",
          color: "var(--palette-neutral-60, #666)",
          margin: "12px 0 8px",
        }}
      >
        {remainingSourceCount} tag{remainingSourceCount !== 1 ? "s" : ""} will be merged
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", margin: "0 0 16px" }}>
        {sources.map((t) => {
          const isTarget = t.name.toLowerCase() === trimmed.toLowerCase();
          return (
            <div
              key={t.id}
              role="button"
              tabIndex={0}
              onClick={() => handlePillClick(t.name)}
              onKeyDown={(e) => handlePillKeyDown(e, t.name)}
              title={
                isTarget
                  ? "Target — other tags will be merged into this one"
                  : undefined
              }
              style={{ cursor: "pointer", display: "inline-flex" }}
            >
              <Pill
                size={PillSize.regular}
                variant={isTarget ? PillVariant.standard : PillVariant.outlined}
                iconProps={{ iconName: isTarget ? "CheckMark" : "Tag" }}
              >
                {t.name}
              </Pill>
            </div>
          );
        })}
      </div>
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm test -- MergeDialog.test.tsx`
Expected: PASS (all 7 tests: the 3 pre-existing plus the 4 added in Step 2).

- [ ] **Step 6: Commit**

```bash
git add src/app/MergeDialog.tsx src/app/MergeDialog.test.tsx src/test/mocks/modules/azureDevopsUi.tsx
git commit -m "feat: click a source pill in Merge dialog to select it as the target"
```

---

### Task 2: Exclude the selected target from the sources sent to the batch merge call

**Files:**
- Modify: `src/app/TagManagerApp.tsx:321-328`
- Test: `src/app/TagManagerApp.test.tsx:4-10` (mock setup), and a new test appended near the other Merge-related tests.

**Interfaces:**
- Consumes: `MergeDialog`'s `onConfirm: (targetName: string) => void` prop (unchanged from Task 1) and the existing `runMergeJobs(sources: TagItem[], targetName: string)` function already defined in `TagManagerApp.tsx:155`.
- Produces: nothing consumed by later tasks (this is the last task).

- [ ] **Step 1: Add a `mergeTags` mock to the test file**

In `src/app/TagManagerApp.test.tsx`, replace lines 4-10:

```tsx
const mockTagService = {
  getAllTags: jest.fn(),
  getProjectName: jest.fn(),
  deleteTagById: jest.fn(),
  renameTagById: jest.fn(),
  mergeTag: jest.fn(),
};
```

with:

```tsx
const mockTagService = {
  getAllTags: jest.fn(),
  getProjectName: jest.fn(),
  deleteTagById: jest.fn(),
  renameTagById: jest.fn(),
  mergeTag: jest.fn(),
  mergeTags: jest.fn(),
};
```

Then, in the `beforeEach` block, right after the existing `mockTagService.mergeTag.mockResolvedValue(...)` (around line 41), add:

```tsx
    mockTagService.mergeTags.mockResolvedValue({ succeeded: [], failed: [] });
```

- [ ] **Step 2: Write the failing test**

Add this `it` block to `src/app/TagManagerApp.test.tsx`, inside the `describe("TagManagerApp", ...)` block (e.g. right after the "renders Merge before Delete in the command bar" test):

```tsx
  it("excludes the tag selected as target from the sources sent to mergeTags", async () => {
    mockTagService.getAllTags.mockResolvedValue([
      { id: "1", name: "one", url: "u" },
      { id: "2", name: "two", url: "u" },
    ]);

    render(<TagManagerApp />);

    await waitFor(() => {
      expect(screen.getByText("one")).toBeInTheDocument();
    });

    const checkboxes = screen.getAllByRole("checkbox");
    fireEvent.click(checkboxes[1]); // row for "one"
    fireEvent.click(checkboxes[2]); // row for "two"

    fireEvent.click(screen.getByRole("button", { name: /^Merge/ }));

    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "one" }));
    fireEvent.click(screen.getByRole("button", { name: "Merge" }));

    await waitFor(() => {
      expect(mockTagService.mergeTags).toHaveBeenCalledWith(
        [{ id: "2", name: "two", url: "u" }],
        "one"
      );
    });
  });
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm test -- TagManagerApp.test.tsx`
Expected: FAIL — `mergeTags` is called with both `{ id: "1", name: "one", url: "u" }` and `{ id: "2", name: "two", url: "u" }` (the target is not yet excluded), so the `toHaveBeenCalledWith` assertion fails on the array contents.

- [ ] **Step 4: Filter the target out of `dialog.sources` before calling `runMergeJobs`**

In `src/app/TagManagerApp.tsx`, replace lines 321-328:

```tsx
      {dialog?.type === "merge" && (
        <MergeDialog
          sources={dialog.sources}
          allTags={tags}
          onConfirm={(targetName) => runMergeJobs(dialog.sources, targetName)}
          onCancel={() => setDialog(null)}
        />
      )}
```

with:

```tsx
      {dialog?.type === "merge" && (
        <MergeDialog
          sources={dialog.sources}
          allTags={tags}
          onConfirm={(targetName) =>
            runMergeJobs(
              dialog.sources.filter(
                (s) => s.name.toLowerCase() !== targetName.toLowerCase()
              ),
              targetName
            )
          }
          onCancel={() => setDialog(null)}
        />
      )}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm test -- TagManagerApp.test.tsx`
Expected: PASS.

- [ ] **Step 6: Run the full test suite**

Run: `pnpm test`
Expected: PASS — no regressions in `MergeDialog.test.tsx`, `TagManagerApp.test.tsx`, `TagManagerApp.rename.test.tsx`, `TagManagerApp.search.test.tsx`, `TagTable.test.tsx`, or `TagService.test.ts`.

- [ ] **Step 7: Commit**

```bash
git add src/app/TagManagerApp.tsx src/app/TagManagerApp.test.tsx
git commit -m "fix: never send the merge target back to mergeTags as a source"
```

---

## Manual Verification (after both tasks)

Run the dev build (see project README/`run` skill for the exact command) and, in the tag manager UI:

1. Select 2 tags, click Merge — confirm both source pills render outlined with a Tag icon.
2. Click one pill — confirm it switches to a filled/checkmark style, the count label reads "1 tag will be merged", and the target input shows that tag's name.
3. Click the same pill again — confirm it reverts to outlined, count label reads "2 tags will be merged", and Merge disables.
4. Click a pill, then type an unrelated existing tag name into the search field — confirm the pill reverts to outlined (no longer selected).
5. With one pill selected as target, click Merge — confirm only the *other* tag is merged and removed from the table, and the target tag still exists afterward.
6. Select only 1 tag, open Merge, click its own pill — confirm Merge stays disabled.
7. Tab to a pill and press Enter — confirm it selects, matching a click.
8. Check both light and dark theme — the filled pill variant should remain legible in both.
