import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const mockTagService = {
  getAllTags: jest.fn(),
  getProjectName: jest.fn(),
  deleteTagById: jest.fn(),
  renameTagById: jest.fn(),
  mergeTag: jest.fn(),
  mergeTags: jest.fn(),
};

jest.mock("../services/TagService", () => ({
  TagService: jest.fn(() => mockTagService),
}));

const mockTagCountCacheService = {
  getCache: jest.fn(),
  setCache: jest.fn(),
  fetchCounts: jest.fn(),
  refreshCache: jest.fn(),
  shouldAutoRefresh: jest.fn(),
};

jest.mock("../services/TagCountCacheService", () => ({
  TagCountCacheService: jest.fn(() => mockTagCountCacheService),
}));

import { TagManagerApp } from "./TagManagerApp";

describe("TagManagerApp", () => {
  beforeEach(() => {
    localStorage.clear();
    Object.values(mockTagService).forEach((fn) => fn.mockReset());
    Object.values(mockTagCountCacheService).forEach((fn) => fn.mockReset());

    mockTagService.getProjectName.mockResolvedValue("Demo Project");
    mockTagService.deleteTagById.mockResolvedValue(undefined);
    mockTagService.mergeTag.mockResolvedValue({
      affectedCount: 1,
      workItemIds: [1],
    });
    mockTagService.mergeTags.mockResolvedValue({ succeeded: [], failed: [] });

    // Default: no cache, not stale (no auto-refresh)
    mockTagCountCacheService.getCache.mockResolvedValue(null);
    mockTagCountCacheService.shouldAutoRefresh.mockResolvedValue(false);
    mockTagCountCacheService.refreshCache.mockResolvedValue({
      counts: {},
      lastUpdated: new Date().toISOString(),
    });
  });

  it("loads tags and renders Delete, Merge, and Refresh Counts buttons", async () => {
    mockTagService.getAllTags.mockResolvedValue([
      { id: "1", name: "alpha", url: "u" },
      { id: "2", name: "beta", url: "u" },
    ]);

    render(<TagManagerApp />);

    expect(screen.getByText(/Loading tags/)).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText("alpha")).toBeInTheDocument();
    });

    expect(screen.getByRole("button", { name: "Delete" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Merge" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Refresh Counts" })).not.toBeDisabled();
    expect(screen.queryByRole("button", { name: /^Count/ })).toBeNull();
  });

  it("renders Merge before Delete in the command bar", async () => {
    mockTagService.getAllTags.mockResolvedValue([]);

    const { container } = render(<TagManagerApp />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Merge" })).toBeInTheDocument();
    });

    const buttons = Array.from(container.querySelectorAll("button"));
    const mergeIndex = buttons.findIndex((button) => button.textContent?.includes("Merge"));
    const deleteIndex = buttons.findIndex((button) => button.textContent?.includes("Delete"));

    expect(mergeIndex).toBeGreaterThan(-1);
    expect(deleteIndex).toBeGreaterThan(-1);
    expect(mergeIndex).toBeLessThan(deleteIndex);
  });

  it("excludes the tag selected as target from the sources sent to mergeTags", async () => {
    mockTagService.getAllTags.mockResolvedValue([
      { id: "1", name: "one", url: "u" },
      { id: "2", name: "two", url: "u" },
    ]);

    render(<TagManagerApp />);

    await waitFor(() => {
      expect(screen.getByText("one")).toBeInTheDocument();
    });

    const checkboxes = screen.getAllByRole("checkbox");
    fireEvent.click(checkboxes[1]); // row for "one"
    fireEvent.click(checkboxes[2]); // row for "two"

    fireEvent.click(screen.getByRole("button", { name: /^Merge/ }));

    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "one" }));
    fireEvent.click(screen.getByRole("button", { name: "Merge" }));

    await waitFor(() => {
      expect(mockTagService.mergeTags).toHaveBeenCalledWith(
        [{ id: "2", name: "two", url: "u" }],
        "one"
      );
    });
  });

  it("shows an error card when loading fails", async () => {
    mockTagService.getAllTags.mockRejectedValue(new Error("boom"));

    render(<TagManagerApp />);

    await waitFor(() => {
      expect(screen.getByText("boom")).toBeInTheDocument();
    });
  });

  it("says counts have not loaded, and what to do, when no cache exists", async () => {
    mockTagService.getAllTags.mockResolvedValue([]);
    mockTagCountCacheService.getCache.mockResolvedValue(null);

    render(<TagManagerApp />);

    await waitFor(() => {
      expect(screen.getByText(/Counts haven't loaded yet/)).toBeInTheDocument();
    });
    expect(screen.queryByText(/Last updated:/)).not.toBeInTheDocument();
  });

  it("shows a no-match state after a search and restores the list when filters are cleared", async () => {
    mockTagService.getAllTags.mockResolvedValue([{ id: "1", name: "alpha", url: "u" }]);

    render(<TagManagerApp />);
    await screen.findByText("alpha");

    fireEvent.change(screen.getByRole("searchbox", { name: "Search tags" }), {
      target: { value: "zzz" },
    });
    expect(screen.getByText("No tags match your filters")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));

    expect(await screen.findByText("alpha")).toBeInTheDocument();
    expect(screen.getByRole("searchbox", { name: "Search tags" })).toHaveValue("");
  });

  it("passes the cache age to the delete dialog", async () => {
    const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
    mockTagService.getAllTags.mockResolvedValue([{ id: "1", name: "alpha", url: "u" }]);
    mockTagCountCacheService.getCache.mockResolvedValue({
      counts: { alpha: 12 },
      lastUpdated: threeHoursAgo,
    });

    render(<TagManagerApp />);
    await screen.findByText("alpha");

    fireEvent.click(screen.getByRole("checkbox", { name: "Select alpha" }));
    fireEvent.click(screen.getByRole("button", { name: /^Delete/ }));

    expect(await screen.findByTestId("counts-note")).toHaveTextContent("counted 3 hours ago");
    expect(screen.getByTestId("tag-count-alpha")).toHaveTextContent("12");
  });

  it("shows formatted timestamp and populates counts when cache exists", async () => {
    mockTagService.getAllTags.mockResolvedValue([
      { id: "1", name: "bug", url: "u" },
    ]);
    mockTagCountCacheService.getCache.mockResolvedValue({
      counts: { bug: 42 },
      lastUpdated: "2026-04-26T10:00:00.000Z",
    });

    render(<TagManagerApp />);

    await waitFor(() => {
      expect(screen.getByText("42")).toBeInTheDocument();
    });

    expect(screen.getByText(/Last updated:/)).toBeInTheDocument();
  });

  describe("last refresh diagnostics", () => {
    const withStats = (stats: Record<string, unknown> | undefined) => {
      mockTagService.getAllTags.mockResolvedValue([{ id: "1", name: "bug", url: "u" }]);
      mockTagCountCacheService.getCache.mockResolvedValue({
        counts: { bug: 1 },
        lastUpdated: "2026-04-26T10:00:00.000Z",
        stats,
      });
    };

    it("summarizes the strategy, requests, rows and duration of the last refresh", async () => {
      withStats({ strategy: "aggregate", requests: 3, retries: 1, rows: 1200, durationMs: 8400 });

      render(<TagManagerApp />);

      const stats = await screen.findByTestId("refresh-stats");
      expect(stats).toHaveTextContent("Aggregate");
      expect(stats).toHaveTextContent("3 requests");
      expect(stats).toHaveTextContent(/1[,.\s\u202f\u00a0]?200 rows/);
      expect(stats).toHaveTextContent("8.4s");
      expect(stats).toHaveAttribute("title", expect.stringContaining("1 throttle retry"));
    });

    it("labels the crawl fallback and exposes the reason on hover", async () => {
      withStats({
        strategy: "crawl",
        requests: 2,
        retries: 0,
        rows: 50000,
        durationMs: 120000,
        fallbackReason: "Analytics OData: 400 bad $apply",
      });

      render(<TagManagerApp />);

      const stats = await screen.findByTestId("refresh-stats");
      expect(stats).toHaveTextContent("Crawl (fallback)");
      expect(stats).toHaveAttribute("title", expect.stringContaining("400 bad $apply"));
    });

    it("renders nothing for caches written before stats existed", async () => {
      withStats(undefined);

      render(<TagManagerApp />);

      await waitFor(() => expect(screen.getByText("1")).toBeInTheDocument());
      expect(screen.queryByTestId("refresh-stats")).not.toBeInTheDocument();
    });

    it("updates after a manual refresh", async () => {
      mockTagService.getAllTags.mockResolvedValue([{ id: "1", name: "ops", url: "u" }]);
      mockTagCountCacheService.refreshCache.mockResolvedValue({
        counts: { ops: 5 },
        lastUpdated: new Date().toISOString(),
        stats: { strategy: "aggregate", requests: 7, retries: 0, rows: 40, durationMs: 900 },
      });

      render(<TagManagerApp />);
      await waitFor(() => expect(screen.getByText("ops")).toBeInTheDocument());
      expect(screen.queryByTestId("refresh-stats")).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: "Refresh Counts" }));

      expect(await screen.findByTestId("refresh-stats")).toHaveTextContent("7 requests");
    });
  });

  it("clicking Refresh Counts calls refreshCache and updates counts", async () => {
    mockTagService.getAllTags.mockResolvedValue([
      { id: "1", name: "ops", url: "u" },
    ]);
    mockTagCountCacheService.refreshCache.mockResolvedValue({
      counts: { ops: 99 },
      lastUpdated: new Date().toISOString(),
    });

    render(<TagManagerApp />);

    await waitFor(() => {
      expect(screen.getByText("ops")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Refresh Counts" }));

    await waitFor(() => {
      expect(screen.getByText("99")).toBeInTheDocument();
    });

    expect(mockTagCountCacheService.refreshCache).toHaveBeenCalledWith("demo-org");
  });

  it("auto-triggers background refresh when cache is stale on load", async () => {
    mockTagService.getAllTags.mockResolvedValue([
      { id: "1", name: "infra", url: "u" },
    ]);
    mockTagCountCacheService.shouldAutoRefresh.mockResolvedValue(true);
    mockTagCountCacheService.refreshCache.mockResolvedValue({
      counts: { infra: 13 },
      lastUpdated: new Date().toISOString(),
    });

    render(<TagManagerApp />);

    await waitFor(() => {
      expect(mockTagCountCacheService.refreshCache).toHaveBeenCalled();
    });

    await waitFor(() => {
      expect(screen.getByText("13")).toBeInTheDocument();
    });
  });

  it("renders ADO pagination buttons when there are more than 25 tags", async () => {
    mockTagService.getAllTags.mockResolvedValue(
      Array.from({ length: 30 }, (_v, i) => ({
        id: `${i + 1}`,
        name: `tag-${String.fromCharCode(65 + (i % 26))}-${i + 1}`,
        url: "u",
      }))
    );

    render(<TagManagerApp />);

    await waitFor(() => {
      expect(screen.getByText(/tag-A-1/)).toBeInTheDocument();
    });

    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Next" })).not.toBeDisabled();
  });

  it("uses correct icon names for Delete and Merge command bar items", async () => {
    mockTagService.getAllTags.mockResolvedValue([]);

    const { container } = render(<TagManagerApp />);

    await waitFor(() => {
      expect(container.querySelector('[data-icon="Delete"]')).not.toBeNull();
      expect(container.querySelector('[data-icon="BranchMerge"]')).not.toBeNull();
      expect(container.querySelector('[data-icon="NumberSymbol"]')).toBeNull();
    });
  });

  it("exposes a root test hook once the hub has rendered", async () => {
    render(<TagManagerApp />);
    await waitFor(() =>
      expect(document.querySelector('[data-testid="tag-manager"]')).not.toBeNull()
    );
  });
});
