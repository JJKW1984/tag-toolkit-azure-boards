// src/types/index.ts

/** A tag as returned by GET _apis/wit/tags */
export interface TagItem {
  id: string;
  name: string;
  url: string;
  /** Populated from the org-wide count cache */
  count?: number;
}

/** Kept for applyTagUpdate return value (merge) */
export interface TagOperationResult {
  affectedCount: number;
  workItemIds: number[];
}

/** Org-wide tag count cache stored via IExtensionDataService */
export interface TagCountCache {
  counts: Record<string, number>;  // tag name (lowercase) → work item count
  lastUpdated: string;              // ISO 8601 timestamp
  stats?: RefreshStats;             // how the last successful refresh ran (absent on older caches)
}

/** Diagnostics for one successful count refresh, so the field behaviour of the strategy is visible. */
export interface RefreshStats {
  /** "aggregate" = server-side groupby by TagNames; "crawl" = paged $expand fallback. */
  strategy: "aggregate" | "crawl";
  /** HTTP requests issued, including throttle retries and a rejected aggregate attempt. */
  requests: number;
  /** Throttle (429/503) retries. */
  retries: number;
  /** Rows read from the winning strategy: tag-set groups (aggregate) or work items (crawl). */
  rows: number;
  durationMs: number;
  /** Why the aggregate was abandoned, when strategy is "crawl". Sanitized. */
  fallbackReason?: string;
}

/** One source tag successfully merged into the target. */
export interface MergeSourceResult extends TagOperationResult {
  source: TagItem;
}

/** One source tag that failed to merge (kept for retry). */
export interface MergeSourceFailure {
  source: TagItem;
  error: string;
}

/** Result of merging one or more source tags into a target. */
export interface BatchMergeResult {
  succeeded: MergeSourceResult[];
  failed: MergeSourceFailure[];
}
