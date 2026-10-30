// src/app/TagManagerApp.tsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Card } from "azure-devops-ui/Card";
import { Header, TitleSize } from "azure-devops-ui/Header";
import { IHeaderCommandBarItem } from "azure-devops-ui/HeaderCommandBar";
import { Page } from "azure-devops-ui/Page";
import { Spinner, SpinnerSize } from "azure-devops-ui/Spinner";
import { MessageCard, MessageCardSeverity } from "azure-devops-ui/MessageCard";
import { Toast } from "azure-devops-ui/Toast";
import { ZeroData, ZeroDataActionType } from "azure-devops-ui/ZeroData";
import { Button } from "azure-devops-ui/Button";
import { ButtonGroup } from "azure-devops-ui/ButtonGroup";
import { TagService } from "../services/TagService";
import * as SDK from "azure-devops-extension-sdk";
import { TagCountCacheService } from "../services/TagCountCacheService";
import { RefreshStats, TagItem } from "../types";
import { TagTable } from "./TagTable";
import { StartsWithFilter } from "./StartsWithFilter";
import { DeleteDialog } from "./DeleteDialog";
import { MergeDialog } from "./MergeDialog";
import { workItemsLabel } from "./TagCounts";
import "./tag-manager.css";
import { SearchBar } from "./SearchBar";
import { sanitizeError } from "../utils/sanitizeError";
import { SortState, sortTags } from "../utils/sortTags";
import { TagEditService } from "../services/TagEditService";
import { RunReport } from "../types/runHistory";
import { RunHistory } from "./RunHistory";

/** Work in flight behind an open dialog; `done`/`total` are set when progress is countable. */
type BusyState = { kind: "delete" | "merge" | "rename"; done?: number; total?: number } | null;

/** `countsUpdatedAt` is snapshotted with the tags so a later refresh can't relabel their counts as fresh. */
type DialogState =
  | { type: "delete"; tags: TagItem[]; countsUpdatedAt: string | null }
  | { type: "merge"; sources: TagItem[]; countsUpdatedAt: string | null }
  | null;

const tagService = new TagService();
const tagEditService = new TagEditService(tagService);
const tagCountCacheService = new TagCountCacheService();
const PAGE_SIZE = 25;
const TOAST_DURATION_MS = 8000;

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
}

const plural = (n: number, word: string) => `${n.toLocaleString()} ${word}${n === 1 ? "" : "s"}`;

function countForTag(counts: Record<string, number>, tagName: string): number {
  const key = tagName.toLowerCase();
  return Object.prototype.hasOwnProperty.call(counts, key) ? counts[key] : 0;
}

/** One-line summary of the last refresh plus a fuller tooltip, for diagnosing slow or fallback runs. */
function describeRefresh(stats: RefreshStats): { summary: string; detail: string } {
  const strategy = stats.strategy === "aggregate" ? "Aggregate" : "Crawl (fallback)";
  const summary = [
    strategy,
    plural(stats.requests, "request"),
    plural(stats.rows, "row"),
    formatDuration(stats.durationMs),
  ].join(" · ");
  const detail = [
    summary,
    `${stats.retries.toLocaleString()} throttle ${stats.retries === 1 ? "retry" : "retries"}`,
    stats.fallbackReason ? `Aggregate rejected: ${stats.fallbackReason}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  return { summary, detail };
}

export const TagManagerApp: React.FC = () => {
  const [tags, setTags] = useState<TagItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [countCacheError, setCountCacheError] = useState<string | null>(null);
  // Why the first load failed. Shown where the list would be: an empty table there would say the project has no tags.
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [dialog, setDialog] = useState<DialogState>(null);
  const [alphaFilter, setAlphaFilter] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(0);
  const [searchQuery, setSearchQuery] = useState("");
  const [sort, setSort] = useState<SortState>({ key: "name", direction: "asc" });
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [lastStats, setLastStats] = useState<RefreshStats | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [busy, setBusy] = useState<BusyState>(null);
  const [toast, setToast] = useState<{ message: string } | null>(null);
  const [latestRun, setLatestRun] = useState<RunReport | null>(null);
  const toastRef = useRef<Toast>(null);
  const tagsRef = useRef<TagItem[]>([]);
  const activeEdit = useRef(false);

  useEffect(() => {
    tagsRef.current = tags;
  }, [tags]);

  // --- Derived list: search -> letter -> sort -> page ---
  // Memoized so the table gets stable inputs and select-all can act on exactly the rows shown.

  const searchFiltered = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return query ? tags.filter((t) => t.name.toLowerCase().includes(query)) : tags;
  }, [tags, searchQuery]);

  const filteredTags = useMemo(() => {
    if (!alphaFilter) return searchFiltered;
    return searchFiltered.filter((t) => {
      const ch = t.name[0]?.toUpperCase();
      return alphaFilter === "#" ? !(ch >= "A" && ch <= "Z") : ch === alphaFilter;
    });
  }, [searchFiltered, alphaFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredTags.length / PAGE_SIZE));
  // The list can shrink under the page the user is on (a delete or merge), so step from the page that is
  // shown, not from the stored one, or Previous would land on a page that is still out of range.
  const safePage = Math.min(currentPage, totalPages - 1);
  // Sorted before paging, so the first page really holds the first rows in the chosen order.
  const sortedTags = useMemo(() => sortTags(filteredTags, sort), [filteredTags, sort]);
  const pagedTags = useMemo(
    () => sortedTags.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE),
    [sortedTags, safePage]
  );
  const existingNames = useMemo(() => tags.map((t) => t.name), [tags]);

  // --- Helpers ---

  const handleRename = useCallback(async (tagId: string, newName: string) => {
    if (activeEdit.current) throw new Error("Another tag edit is still running.");
    activeEdit.current = true;
    setBusy({ kind: "rename" });
    const before = tagsRef.current.find((t) => t.id === tagId);
    try {
      if (!before) throw new Error("The tag is no longer available. Reload before renaming.");
      const updated = await tagEditService.rename(before, newName, setLatestRun);
      setTags((prev) =>
        prev
          .map((t) => (t.id === tagId ? { ...t, name: updated.name } : t))
          .sort((a, b) => a.name.localeCompare(b.name))
      );
      // The tag moves in the sorted list and the rename reached every work item that carried it, so say
      // so. The count is the last one taken, which may be old, and is labelled that way.
      const counted = before?.count === undefined ? "" : ` (${workItemsLabel(before.count)} when last counted)`;
      setToast({
        message: `Renamed “${before?.name ?? "the tag"}” to “${updated.name}” on every work item that used it${counted}.`,
      });
    } catch (e) {
      // Rejected, not shown in the page banner: the editor stays open with the draft and puts this beside
      // the field, and saying it in both places would be saying it twice.
      throw new Error(sanitizeError(e));
    } finally {
      activeEdit.current = false;
      setBusy(null);
    }
  }, []);

  const triggerBackgroundRefresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const orgName = SDK.getHost().name;
      const cache = await tagCountCacheService.refreshCache(orgName);
      setTags((prev) =>
        prev.map((t) => ({ ...t, count: countForTag(cache.counts, t.name) }))
      );
      setLastUpdated(cache.lastUpdated);
      setLastStats(cache.stats ?? null);
      setCountCacheError(null);
    } catch (e) {
      setError(sanitizeError(e));
    } finally {
      setIsRefreshing(false);
    }
  }, []);

  // --- Toast ---

  const dismissToast = useCallback(() => {
    const current = toastRef.current;
    if (!current) {
      setToast(null);
      return;
    }
    // Let the toast fade; a cancelled fade (unmount) has nothing left to clear.
    current.fadeOut().promise.then(() => setToast(null), () => {});
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(dismissToast, TOAST_DURATION_MS);
    return () => clearTimeout(timer);
  }, [toast, dismissToast]);

  // --- Data loading ---

  // `silent` reloads behind the current table: no spinner, and an error already on screen stays.
  const loadTags = useCallback(async (options?: { silent?: boolean }) => {
    if (!options?.silent) {
      setLoading(true);
      setError(null);
      setCountCacheError(null);
      setLoadError(null);
    }
    try {
      const [result, cacheResult] = await Promise.all([
        tagService.getAllTags(),
        tagCountCacheService.getCache().then(
          (value) => ({ status: "fulfilled" as const, value }),
          (reason: unknown) => ({ status: "rejected" as const, reason })
        ),
      ]);
      const cache = cacheResult.status === "fulfilled" ? cacheResult.value : null;
      if (cacheResult.status === "rejected") {
        setCountCacheError(`Couldn't load tag counts: ${sanitizeError(cacheResult.reason)}. Tag management is still available; select Refresh counts to retry.`);
      }
      const tagsWithCounts = cache
        ? result.map((t) => ({ ...t, count: countForTag(cache.counts, t.name) }))
        : result;
      setTags(tagsWithCounts);
      setLastUpdated(cache?.lastUpdated ?? null);
      setLastStats(cache?.stats ?? null);
      // A silent reload leaves the user working, so keep what they selected and drop only what is gone.
      setSelectedIds((prev) => {
        if (!options?.silent) return new Set();
        const present = new Set(tagsWithCounts.map((t) => t.id));
        return new Set([...prev].filter((id) => present.has(id)));
      });
      // Not awaited: the cooldown lookup is one more storage read the table need not wait on.
      if (cacheResult.status === "fulfilled") {
        void tagCountCacheService
          .shouldAutoRefresh(cache)
          .then((refresh) => {
            if (refresh) void triggerBackgroundRefresh();
          })
          .catch((e) => setError(sanitizeError(e)));
      }
    } catch (e) {
      // A reload behind a table the user is working in keeps that table and reports in the banner.
      if (options?.silent) setError(sanitizeError(e));
      else setLoadError(sanitizeError(e));
    } finally {
      setLoading(false);
    }
  }, [triggerBackgroundRefresh]);

  useEffect(() => {
    loadTags();
  }, [loadTags]);

  // --- Selection ---

  const handleToggle = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }, []);

  // The header checkbox reflects the visible page, so it acts on the visible page only.
  // Selections made on other pages or under other filters are left as they are.
  const handleToggleAll = useCallback(
    (select: boolean) => {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        for (const t of pagedTags) {
          if (select) next.add(t.id);
          else next.delete(t.id);
        }
        return next;
      });
    },
    [pagedTags]
  );

  const handleClearFilters = () => {
    setSearchQuery("");
    setAlphaFilter(null);
    setCurrentPage(0);
  };

  const handleClearSelection = useCallback(() => setSelectedIds(new Set()), []);

  // --- Action triggers (open dialogs) ---

  const handleDeleteClick = () => {
    const selected = tags.filter((t) => selectedIds.has(t.id));
    setDialog({ type: "delete", tags: selected, countsUpdatedAt: lastUpdated });
  };

  const handleMergeClick = () => {
    const selected = tags.filter((t) => selectedIds.has(t.id));
    setDialog({ type: "merge", sources: selected, countsUpdatedAt: lastUpdated });
  };

  // --- Background jobs ---

  const runDeleteJobs = async (tagsToDelete: TagItem[]) => {
    if (activeEdit.current) { setError("Another tag edit is still running."); return; }
    activeEdit.current = true;
    const total = tagsToDelete.length;
    const failures: { tag: TagItem; error: string }[] = [];
    let deleted = 0;
    setBusy({ kind: "delete", done: 0, total });
    try {
      const result = await tagEditService.delete(tagsToDelete, setLatestRun,
        (tag) => {
          deleted++;
          setTags((prev) => prev.filter((t) => t.id !== tag.id));
          setSelectedIds((prev) => {
            const next = new Set(prev);
            next.delete(tag.id);
            return next;
          });
        },
        (done) => setBusy({ kind: "delete", done, total })
      );
      failures.push(...result.failed);
    } catch (e) {
      setError(sanitizeError(e));
    } finally {
      activeEdit.current = false;
      setBusy(null);
      setDialog(null);
    }

    if (deleted > 0) setToast({ message: `Deleted ${plural(deleted, "tag")}.` });
    if (failures.length > 0) {
      const reasons = failures.map((f) => `${f.tag.name} (${f.error})`).join("; ");
      setError(
        `Couldn't delete ${plural(failures.length, "tag")}: ${reasons}. They're still selected so you can try again.`
      );
    }
  };

  const runMergeJobs = async (selectedSources: TagItem[], targetName: string) => {
    if (activeEdit.current) { setError("Another tag edit is still running."); return; }
    activeEdit.current = true;
    const sources = selectedSources.filter((s) => s.name.toLowerCase() !== targetName.toLowerCase());
    setBusy({ kind: "merge" });
    try {
      const { succeeded, failed } = await tagEditService.merge(sources, targetName, setLatestRun);

      if (succeeded.length > 0) {
        const updatedIds = new Set<number>();
        for (const entry of succeeded) {
          for (const id of entry.workItemIds) updatedIds.add(id);
        }
        const updated = updatedIds.size;
        const updatedNote = updated > 0 ? ` Updated ${plural(updated, "work item")}.` : "";
        setToast({
          message: `Merged ${plural(succeeded.length, "tag")} into “${targetName}”.${updatedNote} Source tags remain in the project catalog. Refresh counts to update the numbers.`,
        });
      }

      // The merge is done: deselect everything it handled except the sources that failed, which stay for a retry.
      const failedIds = new Set(failed.map((f) => f.source.id));
      const handledIds = new Set(selectedSources.map((s) => s.id).filter((id) => !failedIds.has(id)));
      setSelectedIds((prev) => new Set([...prev].filter((id) => !handledIds.has(id))));

      // Free the user from the dialog before the reload. From here the dialog and busy state may belong
      // to something newer, so only the error path below clears them.
      setBusy(null);
      setDialog(null);

      // Reload behind the table to pick up the new target tag if it was created.
      await loadTags({ silent: true });

      if (failed.length > 0) {
        const reasons = failed.map((f) => `${f.source.name} (${f.error})`).join("; ");
        setError(
          `Couldn't merge ${plural(failed.length, "tag")} into “${targetName}”: ${reasons}. Some work items may already have been updated. They're still selected so you can try again.`
        );
      }
    } catch (e) {
      setBusy(null);
      setDialog(null);
      setError(sanitizeError(e));
    } finally {
      activeEdit.current = false;
    }
  };

  // --- Alpha filter + paging ---

  const handleAlphaFilter = (letter: string | null) => {
    setAlphaFilter(letter);
    setCurrentPage(0);
  };

  const handleSort = useCallback((next: SortState) => {
    setSort(next);
    setCurrentPage(0);
  }, []);

  const handleSearchChange = (value: string) => {
    setSearchQuery(value);
    setCurrentPage(0);
  };

  // --- Render ---

  const n = selectedIds.size;
  const sel = n > 0 ? ` (${n})` : "";
  const selectedOnPage = pagedTags.filter((t) => selectedIds.has(t.id)).length;
  const selectedNotShown = n - selectedOnPage;
  const commandBarItems: IHeaderCommandBarItem[] = [
    {
      id: "merge",
      text: `Merge${sel}`,
      iconProps: { iconName: "BranchMerge" },
      disabled: n === 0 || busy !== null,
      onActivate: handleMergeClick,
      important: true,
    },
    {
      id: "delete",
      text: `Delete${sel}`,
      iconProps: { iconName: "Delete" },
      disabled: n === 0 || busy !== null,
      onActivate: handleDeleteClick,
      important: true,
    },
  ];

  return (
    <Page className="tag-manager-page">
      <Header
        title="Tag Toolkit"
        titleSize={TitleSize.Large}
        description="Manage work item tags across this project."
        commandBarItems={commandBarItems}
      />
      <div className="page-content" data-testid="tag-manager">
        <RunHistory latest={latestRun} />
        {error && (
          <MessageCard
            severity={MessageCardSeverity.Error}
            onDismiss={() => setError(null)}
          >
            {error}
          </MessageCard>
        )}
        {countCacheError && (
          <MessageCard
            severity={MessageCardSeverity.Error}
            onDismiss={() => setCountCacheError(null)}
          >
            {countCacheError}
          </MessageCard>
        )}
        <Card>
          <div className="tm-card-content">
            <div className="tm-filter-row">
              <SearchBar value={searchQuery} onChange={handleSearchChange} />
              <StartsWithFilter
                tags={searchFiltered}
                activeFilter={alphaFilter}
                onFilter={handleAlphaFilter}
              />
            </div>
            <div className="tm-refresh-bar">
              <span className="tm-last-updated">
                {lastUpdated
                  ? `Last updated: ${new Date(lastUpdated).toLocaleString()}`
                  : "Counts haven't loaded yet. Select Refresh counts to load them."}
              </span>
              {lastStats && (
                <span
                  className="tm-refresh-stats"
                  data-testid="refresh-stats"
                  title={describeRefresh(lastStats).detail}
                >
                  {describeRefresh(lastStats).summary}
                </span>
              )}
              {isRefreshing && (
                <Spinner size={SpinnerSize.small} label="Refreshing…" />
              )}
              <Button
                text="Refresh counts"
                iconProps={{ iconName: "Refresh" }}
                disabled={isRefreshing}
                onClick={() => void triggerBackgroundRefresh()}
              />
              {/* In the refresh row, whose height the button already sets, so it never moves the table. */}
              <div className="tm-selection-status" role="status">
                {n > 0 && (
                  <>
                    <span data-testid="selection-status">
                      {plural(n, "tag")} selected
                      {selectedNotShown > 0 && ` · ${selectedNotShown.toLocaleString()} not shown`}
                    </span>
                    <Button subtle={true} text="Clear selection" onClick={handleClearSelection} />
                  </>
                )}
              </div>
            </div>
            {loading ? (
              <div className="tm-spinner-wrapper">
                <Spinner size={SpinnerSize.large} label="Loading tags…" />
              </div>
            ) : loadError !== null ? (
              <ZeroData
                primaryText="Couldn't load tags"
                secondaryText={loadError}
                imageAltText=""
                actionText="Try again"
                actionType={ZeroDataActionType.ctaButton}
                onActionClick={() => void loadTags()}
              />
            ) : (
              <TagTable
                tags={pagedTags}
                selectedIds={selectedIds}
                onToggle={handleToggle}
                onToggleAll={handleToggleAll}
                onRename={handleRename}
                existingNames={existingNames}
                isFiltered={searchQuery.trim() !== "" || alphaFilter !== null}
                onClearFilters={handleClearFilters}
                sort={sort}
                onSort={handleSort}
              />
            )}
            {!loading && totalPages > 1 && (
              <div className="tm-pagination" data-testid="pagination">
                <span data-testid="pagination-status">
                  Page {safePage + 1} of {totalPages}
                  {" "}({filteredTags.length} tag{filteredTags.length !== 1 ? "s" : ""})
                </span>
                <ButtonGroup>
                  <Button
                    subtle={true}
                    text="Previous"
                    iconProps={{ iconName: "ChevronLeft" }}
                    disabled={safePage === 0}
                    onClick={() => setCurrentPage(safePage - 1)}
                  />
                  <Button
                    subtle={true}
                    text="Next"
                    iconProps={{ iconName: "ChevronRight" }}
                    disabled={safePage >= totalPages - 1}
                    onClick={() => setCurrentPage(safePage + 1)}
                  />
                </ButtonGroup>
              </div>
            )}
          </div>
        </Card>
      </div>

      {toast && (
        <Toast
          ref={toastRef}
          message={toast.message}
          callToAction="Dismiss"
          onCallToActionClick={dismissToast}
        />
      )}

      {dialog?.type === "delete" && (
        <DeleteDialog
          tags={dialog.tags}
          countsUpdatedAt={dialog.countsUpdatedAt}
          busyLabel={
            busy?.kind === "delete" ? `Deleting ${busy.done ?? 0} of ${busy.total ?? 0}…` : null
          }
          onConfirm={() => runDeleteJobs(dialog.tags)}
          onCancel={() => setDialog(null)}
        />
      )}
      {dialog?.type === "merge" && (
        <MergeDialog
          sources={dialog.sources}
          allTags={tags}
          countsUpdatedAt={dialog.countsUpdatedAt}
          busyLabel={busy?.kind === "merge" ? "Merging…" : null}
          onConfirm={(targetName) =>
            runMergeJobs(dialog.sources, targetName)
          }
          onCancel={() => setDialog(null)}
        />
      )}

    </Page>
  );
};
