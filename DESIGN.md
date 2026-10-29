---
name: Tag Toolkit for Azure Boards
description: A host-native, compact tag-management hub that borrows Azure DevOps's own theme and controls and adds only what Boards lacks.
colors:
  accent: "#0078d4"
  accent-tint: "rgba(222, 236, 249, 1)"
  surface: "rgba(255, 255, 255, 1)"
  divider: "rgba(218, 218, 218, 1)"
  border: "rgba(200, 200, 200, 1)"
  hover: "rgba(234, 234, 234, 1)"
  text-primary: "#1e1e1e"
  text-secondary: "rgba(0, 0, 0, 0.55)"
  error: "#c4314b"
typography:
  body:
    fontSize: "13px"
    fontWeight: 400
  input:
    fontSize: "14px"
    fontWeight: 400
    lineHeight: "20px"
  meta:
    fontSize: "12px"
    fontWeight: 400
  label:
    fontSize: "11px"
    fontWeight: 600
    letterSpacing: "0.5px"
  badge:
    fontSize: "11px"
    fontWeight: 600
    letterSpacing: "0.2px"
rounded:
  control: "2px"
  badge: "10px"
spacing:
  xs: "4px"
  sm: "6px"
  md: "8px"
  lg: "12px"
  xl: "16px"
  loading: "32px"
components:
  search-input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text-primary}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "4px 28px 4px 8px"
  rename-input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text-primary}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "2px 6px"
  merge-target-input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text-primary}"
    typography: "{typography.input}"
    rounded: "{rounded.control}"
    padding: "4px 8px"
  merge-target-option:
    backgroundColor: "{colors.surface}"
    padding: "6px 10px"
  merge-target-option-highlighted:
    backgroundColor: "{colors.hover}"
  create-new-badge:
    backgroundColor: "{colors.accent-tint}"
    textColor: "{colors.accent}"
    typography: "{typography.badge}"
    rounded: "{rounded.badge}"
    padding: "1px 7px"
  section-label:
    textColor: "{colors.text-secondary}"
    typography: "{typography.label}"
  counts-note:
    textColor: "{colors.text-secondary}"
    typography: "{typography.body}"
---

# Design System: Tag Toolkit for Azure Boards

## Overview

**Creative North Star: "The Quiet Guest"**

Tag Toolkit lives inside someone else's house. It is a hub in the Azure Boards navigation, rendered in the host's iframe, used by a scrum master who is mid-cleanup and wants to get back to the board. So the visual system does not have a voice of its own: type, theme colours, page chrome, tables, dialogs, buttons, pills and toasts all come from Azure DevOps's component library (`azure-devops-ui`) and its theme variables. The product adds only what Boards does not have, and it adds it in the host's accent: a thin token layer, a few hand-built fields, and a handful of small text styles.

The mood is precise and utilitarian. Controls are compact (13px text, 2px corners, 1px hairlines), numbers are aligned and exact, and every piece of metadata (when counts were taken, how the last refresh went) sits in quiet secondary text rather than competing with the tag list. Nothing is decorative; each element earns its place by helping someone decide which tags to rename, merge or delete.

No visual rejection beyond that is recorded. The Don'ts below come from what the incumbent code already does.

**Key Characteristics:**
- Host-first: the host's theme, font stack and components are the default; custom styling is the exception.
- Compact and exact: small controls, 2px corners, hairline borders, right-aligned counts, tabular digits in dialog pills.
- Flat inside, lifted by the host: depth comes only from the host's Card and Dialog.
- Quiet metadata: ages, stats and notes are secondary text at 12–13px.
- Destructive actions are carried by the host's danger button and warning card, never by custom styling.

## Colors

A host-borrowed palette: one blue accent, a neutral grey scale for structure, and one red for inline errors. The project declares no colours of its own; it wraps the host's theme variables in `--tm-*` tokens and falls back to ADO's own defaults when running outside the host (dev server, tests). The values in the frontmatter are those fallbacks; in production the live theme (light, dark or high-contrast) wins.

### Primary
- **Accent** (#0078d4): The host's communication blue. Focus outline on the rename trigger (2px, 2px offset) and on the merge-target field (2px, inset; from `--focus-border-color` via `--tm-focus`), the new-tag name and "Create new" badge text in the merge dialog. Never used for fills larger than a badge.

### Secondary
- **Accent Tint** (rgba(222, 236, 249, 1)): Pale blue fill behind the "Create new" badge. From `--palette-primary-tint-30`.

### Neutral
- **Surface** (rgba(255, 255, 255, 1)): Background of the hand-built inputs and the merge-target list. From `--callout-background-color`.
- **Divider** (rgba(218, 218, 218, 1)): 1px lines between regions (under the filter row, above pagination, inside the merge-target list). From `--palette-neutral-10`.
- **Border** (rgba(200, 200, 200, 1)): 1px outline of the hand-built inputs. From `--palette-neutral-20`.
- **Hover** (rgba(234, 234, 234, 1)): Highlight for the active merge-target suggestion. From `--palette-neutral-8`.
- **Text Primary** (#1e1e1e): Text in the hand-built inputs. From `--text-primary-color`.
- **Secondary Text** (rgba(0, 0, 0, 0.55)): Last-updated line, refresh stats, counts notes, section labels, the unloaded-count dash. From `--text-secondary-color`.
- **Error** (#c4314b): Inline validation text under the rename field and the merge-target field. From `--status-error-foreground` via `--tm-error`.

### Named Rules
**The Wrapped Triplet Rule.** ADO's `--palette-*` variables are bare RGB triplets, so they must be wrapped: `rgba(var(--palette-neutral-20, 200, 200, 200), 1)`. `var(--palette-neutral-20, #ccc)` is an invalid declaration and the browser drops the whole property. Use the `--tm-*` tokens at the top of `tag-manager.css`, never the raw variables. `--text-*` and `--callout-*` variables are full colours and are used as is.

**The Borrowed Accent Rule.** The only accent is the host's blue, and it appears on small things: a focus outline, a badge, a new-tag label. Do not introduce a colour of our own.

## Typography

**Font:** the host's UI font stack, inherited. The project declares no typeface and loads no web fonts.

**Character:** Plain, small and legible. One size does nearly all the work (13px), with a quieter 12px for metadata and a small uppercase label for dialog section headings.

### Hierarchy
- **Page title** (host `TitleSize.Large`): "Tag Toolkit", with the host description line beneath it. Both are the host Header's own styling.
- **Body** (400, 13px): Search text, the refresh bar, the counts note, pagination text, rename input. The working size of the product.
- **Input** (400, 14px, 20px line height): The merge-dialog target field only, matching the host dialog's form scale.
- **Meta** (400, 12px): Refresh stats (`Aggregate · 3 requests · 1,200 rows · 4.2s`), rename validation errors.
- **Label** (600, 11px, 0.5px tracking, uppercase): Dialog section headings, "3 tags will be deleted" / "2 tags will be merged".
- **Badge** (600, 11px, 0.2px tracking): The "Create new" badge.
- **Pill count** (600, tabular figures): The work item count inside a dialog pill, set off by a 1px left rule.

### Named Rules
**The Tabular Count Rule.** Counts are numbers people compare. Right-align them in the table and use tabular figures where they sit inside pills.

**The Quiet Metadata Rule.** Anything that explains a number (its age, how it was fetched) uses Secondary Text and never gets bolder than the number itself.

## Layout

A single-column page: host `Page` → host `Header` (title, description, and a Merge / Delete command bar on the right) → one host `Card` filling the page width. Inside the card, `.tm-card-content` is a column of four bands:

1. **Filter row.** The search field (flex `1 1 240px`) and the "Starts with" dropdown (fixed 220px) on one line, wrapping when narrow, with a 1px divider beneath (6px / 8px vertical padding, 8px / 12px gap).
2. **Refresh bar.** Last-updated text, refresh stats, and the "Refresh counts" button, with the selection summary pushed to the right edge by `margin-left: auto`. Wraps on narrow widths (4px / 12px gap).
3. **Table.** Checkbox column, a flexible Tag column, and a right-aligned "Work items (org-wide)" column. 25 rows per page.
4. **Pagination.** A right-aligned row under a 1px divider with the page position and subtle previous / next buttons (12px gap).

Spacing is a small hand-set scale: 4, 6, 8, 12, 16px, with 32px around the loading spinner. Density is compact; the host's table row height governs the list.

The host's page styling makes `<body>` a flex container and the card's content wrapper a flex row, so any wrapper we add must carry `flex: 1 1 auto; min-width: 0` (as `#root` and `.tm-card-content` do) or it shrinks to its content whenever the content is narrow, such as an empty state replacing the table.

### Named Rules
**The Fill-the-Card Rule.** A new wrapper inside the Card gets `flex: 1 1 auto; min-width: 0`. Without it the whole region narrows to its content.

## Elevation & Depth

Flat inside, lifted by the host. The host's `Card` provides the one soft shadow that separates the work surface from the page, and the host's `Dialog` provides the scrim and float for merge and delete. Everything inside the card is flat and structured with 1px hairlines (Divider for regions, Border for inputs) and tonal steps (Hover, Accent Tint). The project defines no shadow of its own.

### Named Rules
**The Hairline Rule.** Structure is a 1px Divider or Border line and, for state, a tonal fill. Do not add custom shadows; the host supplies depth where depth belongs.

## Shapes

Small and square-ish, matching the host. Hand-built inputs and the rename trigger use a 2px corner (the merge-target field and its list join into one shape: 2px top corners on the input, 2px bottom corners on the list, with the shared edge dropped). The only rounded form of our own is the "Create new" badge, a 10px-radius capsule. Tags themselves are the host's outlined `Pill` with a Tag icon; the chosen merge target switches to the standard (filled) pill with a check mark. Checkboxes, buttons, the dropdown and the table are the host's.

## Components

Compact and exact: small 13px controls, 2px corners, hairline borders, behaving like the host's own.

### Buttons
- **Command bar (Merge / Delete):** host `HeaderCommandBar` items with Merge (`BranchMerge`) and Delete (`Delete`) icons. They show the selection count, e.g. "Merge (3)", and are disabled until something is selected.
- **Refresh counts:** a host `Button` with a `Refresh` icon, next to the last-updated text.
- **Clear selection, previous / next page:** host `subtle` buttons (previous / next carry `ChevronLeft` / `ChevronRight`).
- **Dialog actions:** host `Dialog` footer: a plain Cancel and a `primary` + `danger` confirm button with the action's icon. Enter never confirms in either dialog (`enterPrimary` is off): Delete opens with focus on Cancel, and Merge opens on the target field and is reached by Tab once the target is valid. Escape closes from anywhere, including a focused footer button, because the host Button swallows the key.

### Inputs / Fields
- **Search (hand-built):** 13px text, 4px 28px 4px 8px padding (right padding clears the clear button), 1px Border, 2px corners, Surface fill, and the same 2px inset Accent focus ring as the other hand-built fields. A 24px clear button drawn with the host's `Clear` icon appears at the right edge once there is a value; the browser's own clear button is hidden so there is only one.
- **"Starts with" (host Dropdown):** 220px wide, selected text reads "Starts with: Any letter".
- **Rename (hand-built):** replaces the tag name in place. 13px text, 2px 6px padding, 1px Border, 2px corners, typed in its own direction (`dir=auto`). Beside it, 12px Secondary Text says how to finish: "Press Enter to rename, Esc to cancel." Only Enter commits; Escape, or leaving the field, abandons the edit, because a rename rewrites every work item and cannot be undone. While the request runs the field stays open and read-only with a "Renaming…" status. A duplicate or invalid name, or a failed request, shows 12px Error text beneath (`role="alert"`, tied to the field with `aria-describedby`), keeps what was typed, and wraps instead of clipping. Its width is capped by viewport so it fits the name column on a phone.
- **Merge target (hand-built combobox):** 14px / 20px text, 4px 8px padding. The input and its suggestion list read as one control with a shared border. It is a named combobox ("Tag to keep") that owns a listbox, with `aria-activedescendant` following the highlight. Suggestions are outlined pills in 6px 10px rows, the highlighted row filled with Hover; exact matches come first, then prefix matches, and at most 50 rows render, followed by a 12px Secondary Text hint ("Showing the first 50 of N matches. Keep typing to narrow the list."). A final "create" row (separated by a Divider) shows the typed name in Accent with a "Create new" badge, and is offered only for a name ADO accepts. A name it rejects (a semicolon, over 256 characters) shows 12px Error text beneath the list and keeps Merge off. The dialog opens with focus here, and the field is read-only while the merge runs.
- **Focus:** the rename trigger shows a 2px Accent outline with 2px offset. The merge-target and rename inputs show a 2px Accent outline drawn inset (offset -2px) so a scroll container cannot clip it. None relies on a border change. When an editor closes, focus returns to the tag's name, or, if the rename moved the tag off the page, to the tag that took its place in the list.

### Tag name (signature component)
Each tag name is a borderless, transparent button that inherits the row's font. A name too long for its cell shortens with an ellipsis, and the tooltip carries the full name above the rename hint. The host's Edit icon (12px, Secondary Text) appears on hover and on keyboard focus; double-click, Enter, F2 or Space starts the inline rename. A finished rename is confirmed with a toast naming the old and new name and, when known, how many work items the tag was on when last counted. Its `title` reads "Double-click, Enter, or F2 to rename".

### Pills
- **Style:** host outlined `Pill`, regular size, Tag icon, drawn by the shared `TagPill`. In dialogs, a pill ends with the work item count: 6px gap, a 1px left rule in the pill's current colour, 600 weight, tabular figures. A long name shortens with an ellipsis (capped at `min(18rem, 55vw)`, with the full name as the tooltip) and the count never does, so one very long tag cannot widen the dialog past the screen. Pills sit outside the dialog's focus zone; only the clickable wrapper around a merge source pill is a Tab stop.
- **State:** in the merge dialog the pill that matches the tag to keep switches to the standard variant with a `CheckMark` icon. Source pills are buttons (`aria-pressed`) named by what they do and how many work items they are on ("Keep “api-17”, used on 38 work items"), with a tooltip ("Keep this tag" / "This tag is kept. Click again to choose a different one."). The dialog's warning is what tells the user they can be clicked.

### Messages and states
- **MessageCard:** Warning at the top of each dialog (what will change and that it cannot be undone), Info when counts are not yet loaded, Error at page level with a dismiss action.
- **Toast:** the host Toast confirms completed merges and deletes (8s).
- **Load failure:** when the first load fails, the list area is a host ZeroData reading "Couldn't load tags" with the reason and a "Try again" button, never the "No tags found" empty state and never a page banner as well. A reload that fails behind a table the user is working in keeps the table and reports in the banner.
- **ZeroData:** host empty states with a heading, a sentence, and "Clear filters" when filtered. The empty image slot is collapsed (`display: none`) because no illustration is supplied.
- **Spinner:** large and centred (32px padding) while loading; small with a label beside "Refresh counts" during a refresh.
- **Unknown count:** an em dash in Secondary Text.

### Cards / Containers
One host `Card` holds everything. No nested cards.

### Navigation
A single hub entry in the Azure Boards left navigation, labelled "Tag Toolkit" with the Fluent `Tag` icon. There is no in-app navigation beyond pagination.

## Do's and Don'ts

### Do:
- **Do** take colours from the `--tm-*` tokens (including `--tm-text-primary` and `--tm-accent`), which wrap the host theme variables in `rgba(var(--palette-…, r, g, b), 1)` with ADO's defaults as fallbacks.
- **Do** reach for an `azure-devops-ui` component first; hand-build only what the host lacks, and match the host's scale (13px text, 2px corners, 1px hairlines).
- **Do** show every count with its age (Last updated, counts note) so a 0 reads as "0 when last counted".
- **Do** right-align counts and use tabular figures where counts sit inside a pill.
- **Do** give any wrapper inside the Card `flex: 1 1 auto; min-width: 0`.
- **Do** make a change that rewrites work items an explicit act (Enter, or a button in a dialog), never a side effect of focus leaving a field.
- **Do** keep destructive confirmation in the host `Dialog` with a `primary` + `danger` button, with `enterPrimary` off so no keystroke while choosing can confirm it.
- **Do** render a tag as a `TagPill` so a long name ellipsizes, its count stays visible, and it stays out of the dialog's focus zone.
- **Do** cap long lists and say how many are hidden; a thousand rendered rows makes every keystroke lag.
- **Do** check changes to host-component styling in the real library in a browser; jest mocks do not reproduce its behaviour.

### Don't:
- **Don't** use a raw `--palette-*` variable as a colour, or as `var(--palette-x, #ccc)`; it is a bare RGB triplet and the declaration is dropped.
- **Don't** add shadows to anything inside the Card; the host provides depth.
- **Don't** introduce a colour, typeface or illustration style of our own.
- **Don't** hard-code a hex colour where a `--tm-*` token already exists; focus and error colours are `--tm-focus` and `--tm-error`.
- **Don't** set `outline: none` on a hand-built control without drawing a focus ring in its place.
- **Don't** let a flex wrapper size to its content inside the Card.
- **Don't** rely on a tag count being current; never present it without its age.
