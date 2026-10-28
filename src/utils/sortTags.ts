import { TagItem } from "../types";

export type SortKey = "name" | "count";
export type SortDirection = "asc" | "desc";

export interface SortState {
  key: SortKey;
  direction: SortDirection;
}

const byName = (a: TagItem, b: TagItem) => a.name.localeCompare(b.name);

/**
 * Returns a sorted copy. Tags whose count has not loaded sort last in either direction, so
 * an unknown count is never read as zero, and ties fall back to name so the order is stable.
 */
export function sortTags(tags: TagItem[], { key, direction }: SortState): TagItem[] {
  const sign = direction === "asc" ? 1 : -1;

  if (key === "name") {
    return [...tags].sort((a, b) => sign * byName(a, b));
  }

  return [...tags].sort((a, b) => {
    if (a.count === undefined && b.count === undefined) return byName(a, b);
    if (a.count === undefined) return 1;
    if (b.count === undefined) return -1;
    return sign * (a.count - b.count) || byName(a, b);
  });
}
