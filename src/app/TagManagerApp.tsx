// src/app/TagManagerApp.tsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Card } from "azure-devops-ui/Card";
import { Header, TitleSize } from "azure-devops-ui/Header";
import { IHeaderCommandBarItem } from "azure-devops-ui/HeaderCommandBar";
import { Page } from "azure-devops-ui/Page";
import { Spinner, SpinnerSize } from "azure-devops-ui/Spinner";
import { MessageCard, MessageCardSeverity } from "azure-devops-ui/MessageCard";
import { Toast } from "azure-devops-ui/Toast";
import { Button } from "azure-devops-ui/Button";
import { ButtonGroup } from "azure-devops-ui/ButtonGroup";
import { TagService } from "../services/TagService";
import * as SDK from "azure-devops-extension-sdk";
import { TagCountCacheService } from "../services/TagCountCacheService";
import { RefreshStats, TagItem } from "../types";
import { TagTable } from "./TagTable";
import { AlphaNav } from "./AlphaNav";
import { DeleteDialog } from "./DeleteDialog";
import { MergeDialog } from "./MergeDialog";
import "./tag-manager.css";
import { SearchBar } from "./SearchBar";
import { sanitizeError } from "../utils/sanitizeError";
import { SortState, sortTags } from "../utils/sortTags";

/** Work in flight behind an open dialog; `done`/`total` are set when progress is countable. */
type BusyState = { kind: "delete" | "merge"; done?: number; total?: number } | null;

type DialogState =
  | { type: "delete"; tags: TagItem[] }
  | { type: "merge"; sources: TagItem[] }
  | null;

const tagService = new TagService();
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
  const toastRef = useRef<Toast>(null);
  const tagsRef = useRef<TagItem[]>([]);

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
    try {
      const updated = await tagService.renameTagById(tagId, newName);
      setTags((prev) =>
        prev
          .map((t) => (t.id === tagId ? { ...t, name: updated.name } : t))
          .sort((a, b) => a.name.localeCompare(b.name))
      );
    } catch (e) {
      setError(sanitizeError(e));
    }
  }, []);

  const triggerBackgroundRefresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const orgName = SDK.getHost().name;
      const cache = await tagCountCacheService.refreshCache(orgName);
      setTags((prev) =>
        prev.map((t) => ({ ...t, count: cache.counts[t.name.toLowerCase()] ?? 0 }))
      );
      setLastUpdated(cache.lastUpdated);
      setLastStats(cache.stats ?? null);
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
    }
    try {
      const [result, cache] = await Promise.all([
        tagService.getAllTags(),
        tagCountCacheService.getCache(),
      ]);
      const tagsWithCounts = cache
        ? result.map((t) => ({ ...t, count: cache.counts[t.name.toLowerCase()] ?? 0 }))
        : result;
      setTags(tagsWithCounts);
      if (cache) {
        setLastUpdated(cache.lastUpdated);
        setLastStats(cache.stats ?? null);
      }
      setSelectedIds(new Set());
      // Not awaited: the cooldown lookup is one more storage read the table need not wait on.
      void tagCountCacheService
        .shouldAutoRefresh(cache)
        .then((refresh) => {
          if (refresh) void triggerBackgroundRefresh();
        })
        .catch((e) => setError(sanitizeError(e)));
    } catch (e) {
      setError(sanitizeError(e));
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
    setDialog({ type: "delete", tags: selected });
  };

  const handleMergeClick = () => {
    const selected = tags.filter((t) => selectedIds.has(t.id));
    setDialog({ type: "merge", sources: selected });
  };

  // --- Background jobs ---

  const runDeleteJobs = async (tagsToDelete: TagItem[]) => {
    const total = tagsToDelete.length;
    const failures: { tag: TagItem; error: string }[] = [];
    let deleted = 0;
    setBusy({ kind: "delete", done: 0, total });
    try {
      for (const tag of tagsToDelete) {
        try {
          await tagService.deleteTagById(tag.id);
          deleted++;
          setTags((prev) => prev.filter((t) => t.id !== tag.id));
          setSelectedIds((prev) => {
            const next = new Set(prev);
            next.delete(tag.id);
            return next;
          });
        } catch (e) {
          failures.push({ tag, error: sanitizeError(e) });
        }
        setBusy({ kind: "delete", done: deleted + failures.length, total });
      }
    } finally {
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

  const runMergeJobs = async (sources: TagItem[], targetName: string) => {
    setBusy({ kind: "merge" });
    try {
      const { succeeded, failed } = await tagService.mergeTags(sources, targetName);

      // Remove fully-merged sources from the table immediately.
      const removedIds = new Set(succeeded.map((s) => s.source.id));
      setTags((prev) => prev.filter((t) => !removedIds.has(t.id)));

      if (succeeded.length > 0) {
        const retagged = succeeded.reduce((sum, s) => sum + s.affectedCount, 0);
        setToast({
          message: `Merged ${plural(succeeded.length, "tag")} into “${targetName}”. ${plural(
            retagged,
            "work item"
          )} re-tagged. Refresh counts to update the numbers.`,
        });
      }

      // The merge itself is done; free the user from the dialog before the reload.
      setBusy(null);
      setDialog(null);

      // Reload behind the table to pick up the new target tag if it was created.
      await loadTags({ silent: true }); // resets selectedIds to empty

      if (failed.length > 0) {
        const reasons = failed.map((f) => `${f.source.name} (${f.error})`).join("; ");
        setError(
          `Couldn't merge ${plural(failed.length, "tag")} into “${targetName}”: ${reasons}. They're still selected so you can try again.`
        );
        // Re-select any sources that failed to merge so the user can retry.
        setSelectedIds(new Set(failed.map((f) => f.source.id)));
      }
    } catch (e) {
      setError(sanitizeError(e));
    } finally {
      setBusy(null);
      setDialog(null);
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
      disabled: n === 0,
      onActivate: handleMergeClick,
      important: true,
    },
    {
      id: "delete",
      text: `Delete${sel}`,
      iconProps: { iconName: "Delete" },
      disabled: n === 0,
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
        {error && (
          <MessageCard
            severity={MessageCardSeverity.Error}
            onDismiss={() => setError(null)}
          >
            {error}
          </MessageCard>
        )}
        <Card>
          <div className="tm-card-content">
            <SearchBar value={searchQuery} onChange={handleSearchChange} />
            <AlphaNav
              tags={searchFiltered}
              activeFilter={alphaFilter}
              onFilter={handleAlphaFilter}
            />
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
                    onClick={() => setCurrentPage((p) => Math.max(0, p - 1))}
                  />
                  <Button
                    subtle={true}
                    text="Next"
                    iconProps={{ iconName: "ChevronRight" }}
                    disabled={safePage >= totalPages - 1}
                    onClick={() => setCurrentPage((p) => Math.min(totalPages - 1, p + 1))}
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
          countsUpdatedAt={lastUpdated}
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
          countsUpdatedAt={lastUpdated}
          busyLabel={busy?.kind === "merge" ? "Merging…" : null}
          onConfirm={(targetName) =>
            runMergeJobs(
              dialog.sources.filter(
                (s) => s.name.toLowerCase() !== targetName.toLowerCase()
              ),
              targetName
            )
          }
          onCancel={() => setDialog(null)}
        />
      )}

    </Page>
  );
};
