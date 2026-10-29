// src/app/TagCounts.tsx
import React from "react";
import { MessageCard, MessageCardSeverity } from "azure-devops-ui/MessageCard";
import { TagItem } from "../types";
import { formatAge } from "../utils/formatAge";

/** "1 work item", "1,234 work items". */
export const workItemsLabel = (count: number): string =>
  `${count.toLocaleString()} work item${count === 1 ? "" : "s"}`;

/** The work item count shown next to a tag name inside a dialog pill. Renders nothing when unknown. */
export const TagCount: React.FC<{ tag: TagItem }> = ({ tag }) =>
  tag.count === undefined ? null : (
    <span
      className="tm-pill-count"
      data-testid={`tag-count-${tag.name}`}
      title={workItemsLabel(tag.count)}
    >
      {tag.count.toLocaleString()}
    </span>
  );

/**
 * Says what the numbers on the tags mean and how old they are, so a count of 0
 * is read as "0 when last counted" rather than "unused right now".
 */
export const CountsNote: React.FC<{ tags: TagItem[]; updatedAt?: string | null }> = ({
  tags,
  updatedAt,
}) => {
  const hasCounts = tags.some((t) => t.count !== undefined);
  const age = updatedAt ? formatAge(updatedAt) : null;

  if (!hasCounts || !age) {
    return (
      <MessageCard severity={MessageCardSeverity.Info}>
        <span data-testid="counts-note">
          Work item counts haven't loaded yet, so how many work items this affects is unknown.
        </span>
      </MessageCard>
    );
  }

  return (
    <div className="tm-counts-note" data-testid="counts-note">
      The number on each tag is how many work items use it across the organization, counted{" "}
      {age}. If these tags were used recently, close this dialog and select Refresh counts first.
    </div>
  );
};
