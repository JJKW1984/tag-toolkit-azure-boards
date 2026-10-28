import React from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

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
const rowNames = () => screen.getAllByTestId("tag-row").map((row) => row.getAttribute("data-tag-name"));
const startsWith = () => screen.getByRole("combobox", { name: "Starts with" });

describe("TagManagerApp — starts-with filter", () => {
  beforeEach(() => {
    Object.values(mockTagService).forEach((fn) => fn.mockReset());
    Object.values(mockTagCountCacheService).forEach((fn) => fn.mockReset());
    mockTagCountCacheService.getCache.mockResolvedValue(null);
    mockTagCountCacheService.shouldAutoRefresh.mockResolvedValue(false);
    mockTagService.getAllTags.mockResolvedValue([
      tag("1", "alpha"),
      tag("2", "apple"),
      tag("3", "beta"),
      tag("4", "gamma"),
    ]);
  });

  it("shows only the tags that start with the chosen letter", async () => {
    render(<TagManagerApp />);
    await screen.findByText("alpha");

    await userEvent.selectOptions(startsWith(), "A");

    expect(rowNames()).toEqual(["alpha", "apple"]);
  });

  it("narrows the letters on offer to the ones in the current search", async () => {
    render(<TagManagerApp />);
    await screen.findByText("alpha");

    fireEvent.change(screen.getByRole("searchbox", { name: "Search tags" }), { target: { value: "ta" } });

    // "beta" is the only tag containing "ta" here.
    expect(within(startsWith()).queryByRole("option", { name: "G" })).not.toBeInTheDocument();
    expect(within(startsWith()).getByRole("option", { name: "B" })).toBeInTheDocument();
  });

  it("resets the control along with the list when filters are cleared", async () => {
    render(<TagManagerApp />);
    await screen.findByText("alpha");
    await userEvent.selectOptions(startsWith(), "B");
    fireEvent.change(screen.getByRole("searchbox", { name: "Search tags" }), { target: { value: "zzz" } });

    fireEvent.click(await screen.findByRole("button", { name: "Clear filters" }));

    expect(startsWith()).toHaveDisplayValue("Any letter");
    expect(rowNames()).toEqual(["alpha", "apple", "beta", "gamma"]);
  });
});

describe("TagManagerApp — starts-with filter across pages", () => {
  beforeEach(() => {
    Object.values(mockTagService).forEach((fn) => fn.mockReset());
    Object.values(mockTagCountCacheService).forEach((fn) => fn.mockReset());
    mockTagCountCacheService.getCache.mockResolvedValue(null);
    mockTagCountCacheService.shouldAutoRefresh.mockResolvedValue(false);
    const many = Array.from({ length: 30 }, (_v, i) => tag(`${i + 1}`, `tag-${String(i + 1).padStart(2, "0")}`));
    mockTagService.getAllTags.mockResolvedValue([...many, tag("99", "zebra")]);
  });

  it("returns to the first page when a letter is chosen", async () => {
    render(<TagManagerApp />);
    await screen.findByText("tag-01");
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByTestId("pagination-status")).toHaveTextContent("Page 2 of 2");

    await userEvent.selectOptions(startsWith(), "T");

    expect(screen.getByTestId("pagination-status")).toHaveTextContent("Page 1 of 2");
  });
});
