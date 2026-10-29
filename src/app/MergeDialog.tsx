// src/app/MergeDialog.tsx
import React, { useEffect, useState } from "react";
import { Dialog } from "azure-devops-ui/Dialog";
import { FormItem } from "azure-devops-ui/FormItem";
import { MessageCard, MessageCardSeverity } from "azure-devops-ui/MessageCard";
import { PillVariant } from "azure-devops-ui/Pill";
import { TagItem } from "../types";
import { validateTagName } from "../utils/validateTagName";
import { CountsNote, workItemsLabel } from "./TagCounts";
import { TagPill } from "./TagPill";

interface MergeDialogProps {
  sources: TagItem[];
  allTags: TagItem[];
  /** When the per-tag counts were taken (ISO), or null when they have never loaded. */
  countsUpdatedAt?: string | null;
  /** Set while the work runs, e.g. "Merging…". Locks the dialog and replaces the confirm label. */
  busyLabel?: string | null;
  onConfirm: (targetName: string) => void;
  onCancel: () => void;
}

// A class, not an id: the Button namespaces ids, so an id selector would match nothing.
const TARGET_CLASS = "tm-merge-target";
const LISTBOX_ID = "tm-merge-target-list";
const ERROR_ID = "tm-merge-target-error";
const MAX_SUGGESTIONS = 50;
const optionId = (index: number) => `tm-merge-target-option-${index}`;

// The tag the user keeps is called "the tag to keep" everywhere in this dialog, never "the target".
// With several tags selected the pills are the quickest way to pick it, and nothing about a pill says
// it can be clicked, so the warning says so. With one tag selected there is nothing to click, and no
// "other" tags to talk about.
const chooseKeptTagWarning = (selectedCount: number): string =>
  selectedCount === 1
    ? "Choose the tag to keep. The selected tag is deleted, and work items that use it are re-tagged with the tag you keep."
    : "Choose the tag to keep: click one of the tags below, or name a different one. Every other selected tag is deleted, and work items that use them are re-tagged with the tag you keep.";

export const MergeDialog: React.FC<MergeDialogProps> = ({
  sources,
  allTags,
  countsUpdatedAt,
  busyLabel,
  onConfirm,
  onCancel,
}) => {
  const [targetName, setTargetName] = useState("");
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const busy = Boolean(busyLabel);

  // A focused ADO Button swallows Escape (it blurs itself and stops the event), so the Dialog's own
  // escDismiss never fires once Tab has moved focus to Cancel or Merge. Listen in the capture phase
  // instead, ahead of the Button.
  useEffect(() => {
    if (busy) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [busy, onCancel]);

  // Keep the arrow-key highlight on screen: the list scrolls once it passes ~5 rows.
  useEffect(() => {
    if (highlightedIndex < 0) return;
    document.getElementById(optionId(highlightedIndex))?.scrollIntoView?.({ block: "nearest" });
  }, [highlightedIndex]);

  const trimmed = targetName.trim();

  const needle = trimmed.toLowerCase();
  const matches = allTags.filter((t) => {
    if (sources.some((source) => source.id === t.id)) {
      return false;
    }

    if (needle.length === 0) {
      return true;
    }

    return t.name.toLowerCase().includes(needle);
  });
  if (needle.length > 0) {
    // Exact, then prefix, then the rest. Array.sort is stable, so each group stays alphabetical.
    const rank = (name: string) => {
      const lower = name.toLowerCase();
      return lower === needle ? 0 : lower.startsWith(needle) ? 1 : 2;
    };
    matches.sort((a, b) => rank(a.name) - rank(b.name));
  }
  // Rendering every tag of a large project makes each keystroke and arrow key lag, and nobody scans
  // thousands of rows. Ranking above keeps the exact match inside the cap.
  const suggestions = matches.slice(0, MAX_SUGGESTIONS);
  const hiddenCount = matches.length - suggestions.length;

  const isNewTag =
    trimmed.length > 0 &&
    !allTags.some((t) => t.name.toLowerCase() === trimmed.toLowerCase()) &&
    !sources.some((t) => t.name.toLowerCase() === trimmed.toLowerCase());

  const targetIsSource = sources.some(
    (t) => t.name.toLowerCase() === trimmed.toLowerCase()
  );
  const remainingSourceCount = targetIsSource ? sources.length - 1 : sources.length;
  // Only a name the user is inventing needs checking; every existing tag already passed ADO's rules.
  const targetError = isNewTag ? validateTagName(trimmed).reason : undefined;
  const isValid = trimmed.length > 0 && remainingSourceCount > 0 && !targetError;
  // Offer "Create new" only for a name ADO would accept.
  const canCreate = isNewTag && !targetError;
  const totalItems = suggestions.length + (canCreate ? 1 : 0);

  const these = remainingSourceCount === 1 ? "it" : "them";
  const retagged = (
    <>
      work items that use {these} are re-tagged with “{trimmed}”.
    </>
  );
  let warning: React.ReactNode;
  if (trimmed.length === 0 || targetError) {
    // An invalid name must not read as "“x” will be created"; the field's own error names the problem.
    warning = chooseKeptTagWarning(sources.length);
  } else if (targetIsSource && remainingSourceCount === 0) {
    warning = (
      <>
        “{trimmed}” is the only selected tag. Choose a different tag to merge it
        into.
      </>
    );
  } else if (targetIsSource) {
    warning = (
      <>
        “{trimmed}” is kept. The other{" "}
        {remainingSourceCount === 1 ? "tag is" : `${remainingSourceCount} tags are`} deleted, and{" "}
        {retagged}
      </>
    );
  } else {
    warning = (
      <>
        The {remainingSourceCount === 1 ? "selected tag is" : `${remainingSourceCount} selected tags are`}{" "}
        deleted, and {retagged}
        {isNewTag && (
          <>
            {" "}
            “{trimmed}” will be created.
          </>
        )}
      </>
    );
  }

  // While the merge runs the target is already committed; changing it now would show a target that
  // is not the one being merged into.
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (busy) return;
    setTargetName(e.target.value);
    setHighlightedIndex(-1);
  };

  const selectSuggestion = (name: string) => {
    if (busy) return;
    setTargetName(name);
    setHighlightedIndex(-1);
  };

  const handlePillClick = (name: string) => {
    if (busy) return;
    if (trimmed.toLowerCase() === name.toLowerCase()) {
      setTargetName("");
      setHighlightedIndex(-1);
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

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightedIndex((index) => Math.min(index + 1, totalItems - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightedIndex((index) => Math.max(index - 1, -1));
    } else if (e.key === "Enter") {
      // Enter only ever picks a highlighted suggestion. It never merges: the merge deletes tags, so it
      // takes a deliberate Tab to Merge, not a keystroke typed while still choosing the target.
      e.preventDefault();
      if (highlightedIndex >= 0 && highlightedIndex < suggestions.length) {
        selectSuggestion(suggestions[highlightedIndex].name);
      } else {
        setHighlightedIndex(-1);
      }
    }
  };

  return (
    <Dialog
      titleProps={{ text: "Merge tags" }}
      // The Dialog presses its primary button on Enter by default, which would make a keystroke typed
      // while still choosing the target enough to delete tags. Merge is reached by Tab instead.
      enterPrimary={false}
      // Open on the target field, the one thing the user has to do, rather than on an unnamed div.
      defaultActiveElement={`.${TARGET_CLASS}`}
      escDismiss={false}
      footerButtonProps={[
        { text: "Cancel", onClick: onCancel, disabled: busy },
        {
          text: busyLabel ?? "Merge",
          primary: true,
          danger: true,
          disabled: !isValid || busy,
          onClick: () => {
            if (isValid && !busy) onConfirm(trimmed);
          },
          iconProps: { iconName: "BranchMerge" },
        },
      ]}
      onDismiss={busy ? () => {} : onCancel}
    >
      <div data-testid="merge-dialog">
        <MessageCard severity={MessageCardSeverity.Warning}>
          <span data-testid="merge-warning" className="tm-wrap-anywhere">
            {warning}
          </span>
        </MessageCard>
      <div
        style={{
          fontSize: "11px",
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: "0.5px",
          color: "var(--tm-text-secondary)",
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
              aria-pressed={isTarget}
              // Without this the name is the pill's text run together with its count ("api-170").
              aria-label={`Keep “${t.name}”${t.count === undefined ? "" : `, used on ${workItemsLabel(t.count)}`}`}
              tabIndex={0}
              onClick={() => handlePillClick(t.name)}
              onKeyDown={(e) => handlePillKeyDown(e, t.name)}
              title={
                isTarget
                  ? "This tag is kept. Click again to choose a different one."
                  : "Keep this tag"
              }
              className="tm-pill-button"
            >
              <TagPill
                tag={t}
                variant={isTarget ? PillVariant.standard : PillVariant.outlined}
                iconName={isTarget ? "CheckMark" : "Tag"}
                showCount={true}
              />
            </div>
          );
        })}
      </div>
      <CountsNote tags={sources} updatedAt={countsUpdatedAt} />
      <FormItem label="Tag to keep">
        <div>
          <input
            type="text"
            className={TARGET_CLASS}
            role="combobox"
            aria-label="Tag to keep"
            aria-autocomplete="list"
            aria-expanded={totalItems > 0}
            aria-controls={LISTBOX_ID}
            aria-activedescendant={highlightedIndex >= 0 ? optionId(highlightedIndex) : undefined}
            aria-invalid={targetError ? true : undefined}
            aria-describedby={targetError ? ERROR_ID : undefined}
            readOnly={busy}
            value={targetName}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            placeholder="Type to search or create a tag"
            autoComplete="off"
            style={{
              width: "100%",
              boxSizing: "border-box",
              padding: "4px 8px",
              fontSize: "14px",
              lineHeight: "20px",
              border: "1px solid var(--tm-border)",
              borderRadius: "2px 2px 0 0",
              borderBottom: "none",
              background: "var(--tm-surface)",
              color: "var(--text-primary-color, #1e1e1e)",
            }}
          />
          <div
            style={{
              border: "1px solid var(--tm-border)",
              borderTop: "none",
              borderRadius: "0 0 2px 2px",
              background: "var(--tm-surface)",
            }}
          >
          <div
            id={LISTBOX_ID}
            role="listbox"
            aria-label="Matching tags"
            style={{ maxHeight: "160px", overflowY: "auto" }}
          >
            {suggestions.map((t, index) => (
              <div
                key={t.id}
                id={optionId(index)}
                role="option"
                aria-selected={index === highlightedIndex}
                onMouseDown={() => selectSuggestion(t.name)}
                onMouseEnter={() => setHighlightedIndex(index)}
                style={{
                  padding: "6px 10px",
                  cursor: "pointer",
                  background:
                    index === highlightedIndex
                      ? "var(--tm-hover)"
                      : "transparent",
                }}
              >
                <TagPill tag={t} />
              </div>
            ))}
            {canCreate && (
              <div
                id={optionId(suggestions.length)}
                role="option"
                aria-label={`Create new tag “${trimmed}”`}
                aria-selected={highlightedIndex === suggestions.length}
                onMouseDown={() => setHighlightedIndex(-1)}
                onMouseEnter={() => setHighlightedIndex(suggestions.length)}
                style={{
                  padding: "6px 10px",
                  cursor: "pointer",
                  background:
                    highlightedIndex === suggestions.length
                      ? "var(--tm-hover)"
                      : "transparent",
                  borderTop:
                    suggestions.length > 0
                      ? "1px solid var(--tm-divider)"
                      : "none",
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                }}
              >
                <span
                  style={{
                    color: "var(--communication-foreground, #0078d4)",
                    fontWeight: 600,
                    minWidth: 0,
                    overflowWrap: "anywhere",
                  }}
                >
                  {trimmed}
                </span>
                <span
                  style={{
                    flex: "none",
                    fontSize: "11px",
                    color: "var(--communication-foreground, #0078d4)",
                    background: "var(--tm-accent-tint)",
                    borderRadius: "10px",
                    padding: "1px 7px",
                    fontWeight: 600,
                    letterSpacing: "0.2px",
                  }}
                >
                  Create new
                </span>
              </div>
            )}
          </div>
          {hiddenCount > 0 && (
            <div className="tm-list-hint" data-testid="suggestions-hint">
              {needle.length > 0
                ? `Showing the first ${MAX_SUGGESTIONS} of ${matches.length.toLocaleString()} matches. Keep typing to narrow the list.`
                : `Showing the first ${MAX_SUGGESTIONS} of ${matches.length.toLocaleString()} tags. Type to search the rest.`}
            </div>
          )}
          </div>
          {targetError && (
            <div id={ERROR_ID} role="alert" className="tm-field-error">
              {targetError}
            </div>
          )}
        </div>
      </FormItem>
      </div>
    </Dialog>
  );
};
