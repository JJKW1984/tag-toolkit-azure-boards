// src/app/DeleteDialog.tsx
import React from "react";
import { Dialog } from "azure-devops-ui/Dialog";
import { MessageCard, MessageCardSeverity } from "azure-devops-ui/MessageCard";
import { Pill, PillSize, PillVariant } from "azure-devops-ui/Pill";
import { TagItem } from "../types";

interface DeleteDialogProps {
  tags: TagItem[];
  onConfirm: () => void;
  onCancel: () => void;
}

export const DeleteDialog: React.FC<DeleteDialogProps> = ({
  tags,
  onConfirm,
  onCancel,
}) => {
  return (
    <Dialog
      titleProps={{ text: "Delete Tags" }}
      footerButtonProps={[
        { text: "Cancel", onClick: onCancel },
        {
          text: `Delete ${tags.length} tag${tags.length !== 1 ? "s" : ""}`,
          primary: true,
          danger: true,
          onClick: onConfirm,
          iconProps: { iconName: "Delete" },
        },
      ]}
      onDismiss={onCancel}
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
            color: "var(--palette-neutral-60, #666)",
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
            </Pill>
          ))}
        </div>
      </div>
    </Dialog>
  );
};
