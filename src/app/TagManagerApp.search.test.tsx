import React from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mockTagService = {
  getAllTags: jest.fn(),
  getProjectName: jest.fn(),
  deleteTagById: jest.fn(),
  renameTagById: jest.fn(),
  mergeTag: jest.fn(),
};

jest.mock("../services/TagService", () => ({
  TagService: jest.fn(() => mockTagService),
}));

import { TagManagerApp } from "./TagManagerApp";

beforeEach(() => {
  localStorage.clear();
  Object.values(mockTagService).forEach((fn) => (fn as jest.Mock).mockReset());
  mockTagService.getProjectName.mockResolvedValue("Demo Project");
  mockTagService.getAllTags.mockResolvedValue([
    { id: "1", name: "alpha", url: "u" },
    { id: "2", name: "beta", url: "u" },
    { id: "3", name: "gamma", url: "u" },
  ]);
});

describe("TagManagerApp — search filter", () => {
  it("renders a search input above the tag table", async () => {
    render(<TagManagerApp />);
    await waitFor(() => expect(screen.getByText("alpha")).toBeInTheDocument());
    expect(screen.getByRole("searchbox")).toBeInTheDocument();
  });

  it("typing in the search box filters the tag list", async () => {
    const user = userEvent.setup();
    render(<TagManagerApp />);
    await waitFor(() => expect(screen.getByText("alpha")).toBeInTheDocument());

    await user.type(screen.getByRole("searchbox"), "al");

    expect(screen.getByText("alpha")).toBeInTheDocument();
    expect(screen.queryByText("beta")).not.toBeInTheDocument();
    expect(screen.queryByText("gamma")).not.toBeInTheDocument();
  });

  it("search is case-insensitive", async () => {
    const user = userEvent.setup();
    render(<TagManagerApp />);
    await waitFor(() => expect(screen.getByText("alpha")).toBeInTheDocument());

    await user.type(screen.getByRole("searchbox"), "AL");

    expect(screen.getByText("alpha")).toBeInTheDocument();
    expect(screen.queryByText("beta")).not.toBeInTheDocument();
  });

  it("clicking the clear button resets the search and shows all tags", async () => {
    const user = userEvent.setup();
    render(<TagManagerApp />);
    await waitFor(() => expect(screen.getByText("alpha")).toBeInTheDocument());

    await user.type(screen.getByRole("searchbox"), "alpha");
    expect(screen.queryByText("beta")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Clear search" }));
    expect(screen.getByText("alpha")).toBeInTheDocument();
    expect(screen.getByText("beta")).toBeInTheDocument();
    expect(screen.getByText("gamma")).toBeInTheDocument();
  });

  it("search and alpha filter compose: only tags matching both are shown", async () => {
    const user = userEvent.setup();
    render(<TagManagerApp />);
    await waitFor(() => expect(screen.getByText("alpha")).toBeInTheDocument());

    // "a" matches alpha (has 'a'), beta (has 'a'), gamma (has 'a') — all three
    // Then the starts-with filter "G" keeps only tags starting with G => gamma
    await user.type(screen.getByRole("searchbox"), "a");
    await user.selectOptions(screen.getByRole("combobox", { name: "Starts with" }), "G");

    expect(screen.getByText("gamma")).toBeInTheDocument();
    expect(screen.queryByText("alpha")).not.toBeInTheDocument();
    expect(screen.queryByText("beta")).not.toBeInTheDocument();
  });

  it("starts-with filter only offers letters present in search results", async () => {
    const user = userEvent.setup();
    render(<TagManagerApp />);
    await waitFor(() => expect(screen.getByText("alpha")).toBeInTheDocument());

    // After searching "alpha", only matching letters are offered.
    await user.type(screen.getByRole("searchbox"), "alpha");

    const letters = within(screen.getByRole("combobox", { name: "Starts with" }));
    expect(letters.getByRole("option", { name: "A" })).toBeInTheDocument();
    expect(letters.queryByRole("option", { name: "B" })).not.toBeInTheDocument();
    expect(letters.queryByRole("option", { name: "G" })).not.toBeInTheDocument();
  });

  it("changing search query resets the current page to 1", async () => {
    mockTagService.getAllTags.mockResolvedValue(
      Array.from({ length: 30 }, (_, i) => ({
        id: `${i + 1}`,
        name: `tag-${String(i + 1).padStart(2, "0")}`,
        url: "u",
      }))
    );

    const user = userEvent.setup();
    render(<TagManagerApp />);
    await waitFor(() => expect(screen.getByText("tag-01")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText(/Page 2 of/)).toBeInTheDocument();

    await user.type(screen.getByRole("searchbox"), "tag");
    expect(screen.getByText(/Page 1 of/)).toBeInTheDocument();
  });
});
