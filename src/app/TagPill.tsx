// src/app/TagPill.tsx
import React from "react";
import { Pill, PillSize, PillVariant } from "azure-devops-ui/Pill";
import { TagItem } from "../types";
import { TagCount } from "./TagCounts";

interface TagPillProps {
  tag: TagItem;
  variant?: PillVariant;
  iconName?: string;
  /** Append the tag's work item count (renders nothing when the count is unknown). */
  showCount?: boolean;
}

/**
 * A tag as shown in the merge and delete dialogs. A long name shortens with an ellipsis (the full
 * name is the tooltip) while the count after it never does, so one 200-character tag cannot push
 * the dialog wider than the screen or hide how many work items it is on.
 */
export const TagPill: React.FC<TagPillProps> = ({
  tag,
  variant = PillVariant.outlined,
  iconName = "Tag",
  showCount = false,
}) => (
  <Pill
    size={PillSize.regular}
    variant={variant}
    iconProps={{ iconName }}
    contentClassName="tm-pill-content"
    // A pill with no onClick cannot take focus, but the Dialog's FocusZone still counts its content
    // element as a Tab stop. Tab would land on it, go nowhere, and never reach the controls after it.
    excludeFocusZone={true}
  >
    <span className="tm-pill-name" title={tag.name}>
      {tag.name}
    </span>
    {showCount && <TagCount tag={tag} />}
  </Pill>
);
