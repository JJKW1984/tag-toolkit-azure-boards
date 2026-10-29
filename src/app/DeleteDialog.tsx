// src/app/DeleteDialog.tsx
import React, { useEffect } from "react";
import { Dialog } from "azure-devops-ui/Dialog";
import { MessageCard, MessageCardSeverity } from "azure-devops-ui/MessageCard";
import { Pill, PillSize, PillVariant } from "azure-devops-ui/Pill";
import { TagItem } from "../types";
import { CountsNote, TagCount } from "./TagCounts";

interface DeleteDialogProps {
  tags: TagItem[];
  /** When the per-tag counts were taken (ISO), or null when they have never loaded. */
  countsUpdatedAt?: string | null;
  /** Set while the work runs, e.g. "Deleting 2 of 5…". Locks the dialog and replaces the confirm label. */
  busyLabel?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}

// A class, not an id: the Button namespaces ids, so an id selector would match nothing.
const CANCEL_CLASS = "tm-delete-cancel";

export const DeleteDialog: React.FC<DeleteDialogProps> = ({
  tags,
  countsUpdatedAt,
  busyLabel,
  onConfirm,
  onCancel,
}) => {
  const busy = Boolean(busyLabel);

  // Focus starts on Cancel, but a focused ADO Button swallows Escape (it blurs itself and stops
  // the event), so the Dialog's own escDismiss never fires from there. Listen in the capture
  // phase instead, ahead of the Button.
  useEffect(() => {
    if (busy) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [busy, onCancel]);

  return (
    <Dialog
      titleProps={{ text: "Delete tags" }}
      // The Dialog presses its primary button on Enter by default; for a delete, opening the
      // dialog and tapping Enter must not be enough. Focus starts on Cancel instead.
      enterPrimary={false}
      defaultActiveElement={`.${CANCEL_CLASS}`}
      escDismiss={false}
      footerButtonProps={[
        { className: CANCEL_CLASS, text: "Cancel", onClick: onCancel, disabled: Boolean(busyLabel) },
        {
          text: busyLabel ?? `Delete ${tags.length} tag${tags.length !== 1 ? "s" : ""}`,
          primary: true,
          danger: true,
          disabled: Boolean(busyLabel),
          onClick: onConfirm,
          iconProps: { iconName: "Delete" },
        },
      ]}
      onDismiss={busyLabel ? () => {} : onCancel}
    >
      <div data-testid="delete-dialog">
        <MessageCard severity={MessageCardSeverity.Warning}>
          This will permanently delete the following tag
          {tags.length !== 1 ? "s" : ""} and remove{" "}
          {tags.length !== 1 ? "them" : "it"} from all work items and pull
          requests. This cannot be undone.
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
          {tags.length} tag{tags.length !== 1 ? "s" : ""} will be deleted
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", margin: "0 0 16px" }}>
          {tags.map((t) => (
            <Pill
              key={t.id}
              size={PillSize.regular}
              variant={PillVariant.outlined}
              iconProps={{ iconName: "Tag" }}
            >
              {t.name}
              <TagCount tag={t} />
            </Pill>
          ))}
        </div>
        <CountsNote tags={tags} updatedAt={countsUpdatedAt} />
      </div>
    </Dialog>
  );
};
