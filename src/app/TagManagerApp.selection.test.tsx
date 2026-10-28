import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

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

const makeTags = (count: number) =>
  Array.from({ length: count }, (_v, i) => ({
    id: `${i + 1}`,
    name: `tag-${String(i + 1).padStart(2, "0")}`,
    url: "u",
  }));

describe("TagManagerApp — selection", () => {
  beforeEach(() => {
    Object.values(mockTagService).forEach((fn) => fn.mockReset());
    Object.values(mockTagCountCacheService).forEach((fn) => fn.mockReset());
    mockTagCountCacheService.getCache.mockResolvedValue(null);
    mockTagCountCacheService.shouldAutoRefresh.mockResolvedValue(false);
    mockTagService.getAllTags.mockResolvedValue(makeTags(30));
  });

  it("select-all picks only the rows on the current page", async () => {
    render(<TagManagerApp />);
    await screen.findByText("tag-01");

    fireEvent.click(screen.getByRole("checkbox", { name: "Select all tags on this page" }));

    expect(screen.getByRole("button", { name: "Merge (25)" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete (25)" })).toBeInTheDocument();
  });

  it("labels every row checkbox with its tag name", async () => {
    render(<TagManagerApp />);
    await screen.findByText("tag-01");

    expect(screen.getByRole("checkbox", { name: "Select tag-01" })).toBeInTheDocument();
  });

  it("says nothing about selection until something is selected", async () => {
    render(<TagManagerApp />);
    await screen.findByText("tag-01");

    expect(screen.queryByTestId("selection-status")).not.toBeInTheDocument();
  });

  it("reports how many selected tags are not on the visible page", async () => {
    render(<TagManagerApp />);
    await screen.findByText("tag-01");

    fireEvent.click(screen.getByRole("checkbox", { name: "Select all tags on this page" }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await screen.findByText("tag-26");

    expect(screen.getByTestId("selection-status")).toHaveTextContent(
      "25 tags selected · 25 not shown"
    );
  });

  it("reports hidden selections after a search narrows the list", async () => {
    render(<TagManagerApp />);
    await screen.findByText("tag-01");

    fireEvent.click(screen.getByRole("checkbox", { name: "Select tag-01" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Select tag-02" }));
    fireEvent.change(screen.getByRole("searchbox", { name: "Search tags" }), {
      target: { value: "tag-02" },
    });

    expect(screen.getByTestId("selection-status")).toHaveTextContent(
      "2 tags selected · 1 not shown"
    );
  });

  it("clears the selection from the status bar", async () => {
    render(<TagManagerApp />);
    await screen.findByText("tag-01");

    fireEvent.click(screen.getByRole("checkbox", { name: "Select tag-01" }));
    fireEvent.click(screen.getByRole("button", { name: "Clear selection" }));

    await waitFor(() =>
      expect(screen.queryByTestId("selection-status")).not.toBeInTheDocument()
    );
    expect(screen.getByRole("button", { name: "Delete" })).toBeDisabled();
  });
});
