import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const mockTagService = {
  getWorkItemsWithTag: jest.fn(),
  readWorkItemTags: jest.fn(),
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
    mockTagService.getWorkItemsWithTag.mockResolvedValue([]);
    mockTagService.readWorkItemTags.mockResolvedValue(new Map());
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

  it("loads tags and renders Delete, Merge, and Refresh counts buttons", async () => {
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
    expect(screen.getByRole("button", { name: "Refresh counts" })).not.toBeDisabled();
    expect(screen.queryByRole("button", { name: /^Count/ })).toBeNull();
  });

  it.each(["stored cache", "refreshed cache"])("does not read inherited counts from a %s", async (source) => {
    mockTagService.getAllTags.mockResolvedValue([
      { id: "1", name: "constructor", url: "u" },
      { id: "2", name: "__proto__", url: "u" },
    ]);
    const cache = { counts: {}, lastUpdated: new Date().toISOString() };
    if (source === "stored cache") mockTagCountCacheService.getCache.mockResolvedValue(cache);
    else mockTagCountCacheService.refreshCache.mockResolvedValue(cache);

    render(<TagManagerApp />);
    await screen.findByText("constructor");
    if (source === "refreshed cache") {
      fireEvent.click(screen.getByRole("button", { name: "Refresh counts" }));
    }

    await waitFor(() => {
      expect(screen.getAllByTestId("tag-count").map((cell) => cell.textContent)).toEqual(["0", "0"]);
    });
  });

  it("renders own prototype-property counts from a persisted JSON cache", async () => {
    mockTagService.getAllTags.mockResolvedValue([
      { id: "1", name: "constructor", url: "u" },
      { id: "2", name: "__proto__", url: "u" },
    ]);
    mockTagCountCacheService.getCache.mockResolvedValue({
      counts: JSON.parse('{"constructor":3,"__proto__":2}'),
      lastUpdated: new Date().toISOString(),
    });

    render(<TagManagerApp />);
    await screen.findByText("constructor");

    expect(screen.getAllByTestId("tag-count").map((cell) => cell.textContent)).toEqual(["2", "3"]);
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

    fireEvent.click(screen.getByRole("button", { name: /^Keep “one”/ }));
    fireEvent.click(screen.getByRole("button", { name: "Merge" }));

    await waitFor(() => {
      expect(mockTagService.mergeTags).toHaveBeenCalledWith(
        [{ id: "2", name: "two", url: "u" }],
        "one",
        expect.any(Function)
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

  it("keeps tags usable with unknown counts when reading the optional cache fails", async () => {
    mockTagService.getAllTags.mockResolvedValue([{ id: "1", name: "alpha", url: "u" }]);
    mockTagCountCacheService.getCache.mockRejectedValue(new Error("storage unavailable"));

    render(<TagManagerApp />);

    expect(await screen.findByText("alpha")).toBeInTheDocument();
    expect(screen.getByText(/Couldn't load tag counts.*storage unavailable/)).toBeInTheDocument();
    expect(screen.queryByText("Couldn't load tags")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Count not loaded")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: "Select alpha" }));
    expect(screen.getByRole("button", { name: "Merge (1)" })).toBeEnabled();
    expect(mockTagCountCacheService.shouldAutoRefresh).not.toHaveBeenCalled();
  });

  it("clears a cache-read error after refreshing counts without hiding a delete error", async () => {
    mockTagService.getAllTags.mockResolvedValue([{ id: "1", name: "alpha", url: "u" }]);
    mockTagCountCacheService.getCache.mockRejectedValue(new Error("storage unavailable"));
    mockTagService.deleteTagById.mockRejectedValue(new Error("delete failed"));

    render(<TagManagerApp />);

    await screen.findByText("alpha");
    fireEvent.click(screen.getByRole("checkbox", { name: "Select alpha" }));
    fireEvent.click(screen.getByRole("button", { name: /^Delete/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Delete 1 tag" }));
    expect(await screen.findByText(/Couldn't delete 1 tag/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Refresh counts" }));

    await waitFor(() => {
      expect(screen.queryByText(/Couldn't load tag counts/)).not.toBeInTheDocument();
    });
    expect(screen.getByText(/Couldn't delete 1 tag/)).toBeInTheDocument();
  });

  it("keeps new tag results and selection when a silent reload cannot read the cache", async () => {
    const alpha = { id: "1", name: "alpha", url: "u" };
    const beta = { id: "2", name: "beta", url: "u" };
    mockTagService.getAllTags.mockResolvedValueOnce([alpha, beta]).mockResolvedValueOnce([
      alpha, beta, { id: "3", name: "gamma", url: "u" },
    ]);
    mockTagCountCacheService.getCache
      .mockResolvedValueOnce({ counts: { alpha: 4, beta: 2 }, lastUpdated: new Date().toISOString() })
      .mockRejectedValueOnce(new Error("storage unavailable"));
    mockTagService.mergeTags.mockResolvedValue({
      succeeded: [{ source: beta, affectedCount: 1, workItemIds: [1] }],
      failed: [],
    });

    render(<TagManagerApp />);
    await screen.findByText("beta");
    fireEvent.click(screen.getByRole("checkbox", { name: "Select beta" }));
    fireEvent.click(screen.getByRole("button", { name: /^Merge/ }));
    fireEvent.change(screen.getByRole("combobox", { name: "Tag to keep" }), { target: { value: "alpha" } });
    fireEvent.click(screen.getByRole("button", { name: "Merge" }));

    expect(await screen.findByText("gamma")).toBeInTheDocument();
    expect(screen.getByText(/Couldn't load tag counts.*storage unavailable/)).toBeInTheDocument();
    expect(screen.queryByText(/Last updated:/)).not.toBeInTheDocument();
    expect(screen.getAllByLabelText("Count not loaded")).toHaveLength(3);
    expect(screen.getByRole("checkbox", { name: "Select beta" })).not.toBeChecked();
  });

  describe("when the tags fail to load", () => {
    it("says so, rather than that the project has no tags, and offers to try again", async () => {
      mockTagService.getAllTags.mockRejectedValueOnce(new Error("boom"));

      render(<TagManagerApp />);

      expect(await screen.findByText("Couldn't load tags")).toBeInTheDocument();
      expect(screen.getByText("boom")).toBeInTheDocument();
      expect(screen.queryByText("No tags found")).not.toBeInTheDocument();
      // The reason is in the place the list would be, not repeated in a page banner as well.
      expect(screen.getAllByText("boom")).toHaveLength(1);
    });

    it("loads the list when the user tries again", async () => {
      mockTagService.getAllTags
        .mockRejectedValueOnce(new Error("boom"))
        .mockResolvedValueOnce([{ id: "1", name: "alpha", url: "u" }]);

      render(<TagManagerApp />);

      fireEvent.click(await screen.findByRole("button", { name: "Try again" }));

      expect(await screen.findByText("alpha")).toBeInTheDocument();
      expect(screen.queryByText("Couldn't load tags")).not.toBeInTheDocument();
      expect(screen.queryByText("boom")).not.toBeInTheDocument();
    });

    it("keeps the table when a reload behind it fails", async () => {
      mockTagService.getAllTags
        .mockResolvedValueOnce([
          { id: "1", name: "one", url: "u" },
          { id: "2", name: "two", url: "u" },
        ])
        .mockRejectedValueOnce(new Error("reload down"));
      mockTagService.mergeTags.mockResolvedValue({
        succeeded: [{ source: { id: "2", name: "two", url: "u" }, affectedCount: 1, workItemIds: [1] }],
        failed: [],
      });

      render(<TagManagerApp />);
      await screen.findByText("two");
      fireEvent.click(screen.getByLabelText("Select one"));
      fireEvent.click(screen.getByLabelText("Select two"));
      fireEvent.click(screen.getByRole("button", { name: /^Merge/ }));
      fireEvent.click(await screen.findByRole("button", { name: /^Keep “one”/ }));
      fireEvent.click(screen.getByRole("button", { name: "Merge" }));

      expect(await screen.findByText("reload down")).toBeInTheDocument();
      expect(screen.queryByText("Couldn't load tags")).not.toBeInTheDocument();
      expect(screen.getByText("one")).toBeInTheDocument();
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

      fireEvent.click(screen.getByRole("button", { name: "Refresh counts" }));

      expect(await screen.findByTestId("refresh-stats")).toHaveTextContent("7 requests");
    });
  });

  it("clicking Refresh counts calls refreshCache and updates counts", async () => {
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

    fireEvent.click(screen.getByRole("button", { name: "Refresh counts" }));

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
