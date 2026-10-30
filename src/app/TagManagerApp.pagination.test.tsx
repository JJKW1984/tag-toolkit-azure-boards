import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";

const mockTagService = {
  getWorkItemsWithTag: jest.fn(),
  readWorkItemTags: jest.fn(),
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

const names = (count: number) =>
  Array.from({ length: count }, (_v, i) => `tag-${String(i + 1).padStart(2, "0")}`);
const tags = (count: number) => names(count).map((name, i) => ({ id: `${i + 1}`, name, url: "u" }));

describe("TagManagerApp — pagination after the list shrinks", () => {
  beforeEach(() => {
    Object.values(mockTagService).forEach((fn) => fn.mockReset());
    mockTagService.getWorkItemsWithTag.mockResolvedValue([]);
    mockTagService.readWorkItemTags.mockResolvedValue(new Map());
    Object.values(mockTagCountCacheService).forEach((fn) => fn.mockReset());
    mockTagCountCacheService.getCache.mockResolvedValue(null);
    mockTagCountCacheService.shouldAutoRefresh.mockResolvedValue(false);
    mockTagService.deleteTagById.mockResolvedValue(undefined);
  });

  it("steps back one page from the page on screen after the last page is deleted away", async () => {
    // 51 tags is three pages of 25, with a single tag on the last one.
    mockTagService.getAllTags.mockResolvedValueOnce(tags(51)).mockResolvedValue(tags(50));
    render(<TagManagerApp />);
    await screen.findByText("tag-01");
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Select tag-51" }));

    fireEvent.click(screen.getByRole("button", { name: /^Delete/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Delete 1 tag" }));
    await screen.findByRole("alert");
    expect(screen.getByTestId("pagination-status")).toHaveTextContent("Page 2 of 2");

    fireEvent.click(screen.getByRole("button", { name: "Previous" }));

    expect(screen.getByTestId("pagination-status")).toHaveTextContent("Page 1 of 2");
  });
});
