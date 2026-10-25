// src/app/MergeDialog.tsx
import React, { useState } from "react";
import { Dialog } from "azure-devops-ui/Dialog";
import { FormItem } from "azure-devops-ui/FormItem";
import { MessageCard, MessageCardSeverity } from "azure-devops-ui/MessageCard";
import { Pill, PillSize, PillVariant } from "azure-devops-ui/Pill";
import { TagItem } from "../types";

interface MergeDialogProps {
  sources: TagItem[];
  allTags: TagItem[];
  onConfirm: (targetName: string) => void;
  onCancel: () => void;
}

export const MergeDialog: React.FC<MergeDialogProps> = ({
  sources,
  allTags,
  onConfirm,
  onCancel,
}) => {
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
    !allTags.some((t) => t.name.toLowerCase() === trimmed.toLowerCase()) &&
    !sources.some((t) => t.name.toLowerCase() === trimmed.toLowerCase());

  const totalItems = suggestions.length + (isNewTag ? 1 : 0);

  const targetIsSource = sources.some(
    (t) => t.name.toLowerCase() === trimmed.toLowerCase()
  );
  const remainingSourceCount = targetIsSource ? sources.length - 1 : sources.length;
  const isValid = trimmed.length > 0 && remainingSourceCount > 0;

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setTargetName(e.target.value);
    setHighlightedIndex(-1);
  };

  const selectSuggestion = (name: string) => {
    setTargetName(name);
    setHighlightedIndex(-1);
  };

  const handlePillClick = (name: string) => {
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
    } else if (e.key === "Enter" && highlightedIndex >= 0) {
      e.preventDefault();
      if (highlightedIndex < suggestions.length) {
        selectSuggestion(suggestions[highlightedIndex].name);
      } else {
        setHighlightedIndex(-1);
      }
    } else if (e.key === "Escape") {
      setHighlightedIndex(-1);
    }
  };

  return (
    <Dialog
      titleProps={{ text: "Merge Tags" }}
      footerButtonProps={[
        { text: "Cancel", onClick: onCancel },
        {
          text: "Merge",
          primary: true,
          danger: true,
          disabled: !isValid,
          onClick: () => onConfirm(trimmed),
          iconProps: { iconName: "BranchMerge" },
        },
      ]}
      onDismiss={onCancel}
    >
      <div data-testid="merge-dialog">
        <MessageCard severity={MessageCardSeverity.Warning}>
        {targetIsSource
          ? `The following tag${remainingSourceCount !== 1 ? "s" : ""} will be merged into the target and removed. The target tag will be kept.`
          : `The following tag${remainingSourceCount !== 1 ? "s" : ""} will be merged into the target and removed from the project.`}
      </MessageCard>
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
              aria-pressed={isTarget}
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
      <FormItem label="Target tag">
        <div>
          <input
            type="text"
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
              border: "1px solid var(--palette-neutral-20, #c8c6c4)",
              borderRadius: "2px 2px 0 0",
              borderBottom: "none",
              background: "var(--callout-background-color, #fff)",
              color: "var(--text-primary-color, #1e1e1e)",
              outline: "none",
            }}
          />
          <div
            style={{
              border: "1px solid var(--palette-neutral-20, #c8c6c4)",
              borderTop: "none",
              borderRadius: "0 0 2px 2px",
              background: "var(--callout-background-color, #fff)",
              maxHeight: "160px",
              overflowY: "auto",
            }}
          >
            {suggestions.map((t, index) => (
              <div
                key={t.id}
                onMouseDown={() => selectSuggestion(t.name)}
                onMouseEnter={() => setHighlightedIndex(index)}
                style={{
                  padding: "6px 10px",
                  cursor: "pointer",
                  background:
                    index === highlightedIndex
                      ? "var(--palette-neutral-8, #e8e8e8)"
                      : "transparent",
                }}
              >
                <Pill
                  size={PillSize.regular}
                  variant={PillVariant.outlined}
                  iconProps={{ iconName: "Tag" }}
                >
                  {t.name}
                </Pill>
              </div>
            ))}
            {isNewTag && (
              <div
                onMouseDown={() => setHighlightedIndex(-1)}
                onMouseEnter={() => setHighlightedIndex(suggestions.length)}
                style={{
                  padding: "6px 10px",
                  cursor: "pointer",
                  background:
                    highlightedIndex === suggestions.length
                      ? "var(--palette-neutral-8, #e8e8e8)"
                      : "transparent",
                  borderTop:
                    suggestions.length > 0
                      ? "1px solid var(--palette-neutral-10, #e0e0e0)"
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
                  }}
                >
                  {trimmed}
                </span>
                <span
                  style={{
                    fontSize: "11px",
                    color: "var(--communication-foreground, #0078d4)",
                    background: "var(--palette-primary-tint-10, #deecf9)",
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
        </div>
      </FormItem>
      </div>
    </Dialog>
  );
};
