import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";

const mockTagService = {
  getAllTags: jest.fn(),
  deleteTagById: jest.fn(),
  renameTagById: jest.fn(),
  mergeTags: jest.fn(),
};

jest.mock("../services/TagService", () => ({
  TagService: jest.fn(() => mockTagService),
}));

const mockTagCountCacheService = {
  getCache: jest.fn(),
  refreshCache: jest.fn(),
  shouldAutoRefresh: jest.fn(),
};

jest.mock("../services/TagCountCacheService", () => ({
  TagCountCacheService: jest.fn(() => mockTagCountCacheService),
}));

import { TagManagerApp } from "./TagManagerApp";

const tag = (id: string, name: string) => ({ id, name, url: "u" });
const COUNT_HEADER = "Work items (org-wide)";

const rowNames = () => screen.getAllByTestId("tag-row").map((row) => row.getAttribute("data-tag-name"));

const withCounts = (counts: Record<string, number>) =>
  mockTagCountCacheService.getCache.mockResolvedValue({
    counts,
    lastUpdated: new Date().toISOString(),
  });

describe("TagManagerApp — sorting", () => {
  beforeEach(() => {
    Object.values(mockTagService).forEach((fn) => fn.mockReset());
    Object.values(mockTagCountCacheService).forEach((fn) => fn.mockReset());
    mockTagCountCacheService.shouldAutoRefresh.mockResolvedValue(false);
    mockTagService.getAllTags.mockResolvedValue([
      tag("1", "alpha"),
      tag("2", "beta"),
      tag("3", "delta"),
      tag("4", "gamma"),
    ]);
    withCounts({ alpha: 3, beta: 0, delta: 5, gamma: 12 });
  });

  it("starts in name order", async () => {
    render(<TagManagerApp />);
    await screen.findByText("alpha");

    expect(rowNames()).toEqual(["alpha", "beta", "delta", "gamma"]);
  });

  it("puts unused tags first when the count column is sorted, then the busiest first on a second choice", async () => {
    render(<TagManagerApp />);
    await screen.findByText("alpha");

    fireEvent.click(screen.getByRole("button", { name: COUNT_HEADER }));
    expect(rowNames()).toEqual(["beta", "alpha", "delta", "gamma"]);

    fireEvent.click(screen.getByRole("button", { name: COUNT_HEADER }));
    expect(rowNames()).toEqual(["gamma", "delta", "alpha", "beta"]);
  });

  it("reverses the name order when the Tag column is chosen again", async () => {
    render(<TagManagerApp />);
    await screen.findByText("alpha");

    fireEvent.click(screen.getByRole("button", { name: "Tag" }));

    expect(rowNames()).toEqual(["gamma", "delta", "beta", "alpha"]);
  });

  it("keeps tags with no count after the counted ones", async () => {
    mockTagCountCacheService.getCache.mockResolvedValue(null);
    render(<TagManagerApp />);
    await screen.findByText("alpha");

    fireEvent.click(screen.getByRole("button", { name: COUNT_HEADER }));

    expect(rowNames()).toEqual(["alpha", "beta", "delta", "gamma"]);
  });

  it("keeps the selection when the order changes", async () => {
    render(<TagManagerApp />);
    await screen.findByText("alpha");
    fireEvent.click(screen.getByRole("checkbox", { name: "Select beta" }));

    fireEvent.click(screen.getByRole("button", { name: COUNT_HEADER }));
    fireEvent.click(screen.getByRole("button", { name: COUNT_HEADER }));

    expect(screen.getByRole("checkbox", { name: "Select beta" })).toBeChecked();
    expect(screen.getByRole("button", { name: "Delete (1)" })).toBeInTheDocument();
  });

  describe("with more than one page", () => {
    beforeEach(() => {
      const names = Array.from({ length: 30 }, (_v, i) => `tag-${String(i + 1).padStart(2, "0")}`);
      mockTagService.getAllTags.mockResolvedValue(names.map((name, i) => tag(`${i + 1}`, name)));
      withCounts(Object.fromEntries(names.map((name, i) => [name, i + 1])));
    });

    it("sorts the whole list before paging, so the busiest tag is on the first page", async () => {
      render(<TagManagerApp />);
      await screen.findByText("tag-01");
      expect(screen.queryByText("tag-30")).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: COUNT_HEADER }));
      fireEvent.click(screen.getByRole("button", { name: COUNT_HEADER }));

      expect(rowNames()[0]).toBe("tag-30");
    });

    it("returns to the first page when the order changes", async () => {
      render(<TagManagerApp />);
      await screen.findByText("tag-01");
      fireEvent.click(screen.getByRole("button", { name: "Next" }));
      expect(screen.getByTestId("pagination-status")).toHaveTextContent("Page 2 of 2");

      fireEvent.click(screen.getByRole("button", { name: COUNT_HEADER }));

      expect(screen.getByTestId("pagination-status")).toHaveTextContent("Page 1 of 2");
    });
  });
});
