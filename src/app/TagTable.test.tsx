import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { TagTable } from "./TagTable";
import { SortState } from "../utils/sortTags";

describe("TagTable", () => {
  it("shows zero data state when no tags are available", () => {
    render(
      <TagTable
        tags={[]}
        selectedIds={new Set()}
        onToggle={jest.fn()}
        onToggleAll={jest.fn()}
      />
    );

    expect(screen.getByText("No tags found")).toBeInTheDocument();
  });

  it("tells a first-time user what to do when the project has no tags", () => {
    render(
      <TagTable
        tags={[]}
        selectedIds={new Set()}
        onToggle={jest.fn()}
        onToggleAll={jest.fn()}
      />
    );

    expect(screen.getByText("No tags found")).toBeInTheDocument();
    expect(screen.getByText(/Tags you add to work items will appear here/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Clear filters" })).not.toBeInTheDocument();
  });

  it("explains an empty search and offers to clear the filters", () => {
    const onClearFilters = jest.fn();
    render(
      <TagTable
        tags={[]}
        selectedIds={new Set()}
        onToggle={jest.fn()}
        onToggleAll={jest.fn()}
        isFiltered={true}
        onClearFilters={onClearFilters}
      />
    );

    expect(screen.getByText("No tags match your filters")).toBeInTheDocument();
    expect(screen.queryByText("No tags found")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(onClearFilters).toHaveBeenCalledTimes(1);
  });

  it("survives going from rows to no rows and back (hook order stays stable)", () => {
    const props = {
      selectedIds: new Set<string>(),
      onToggle: jest.fn(),
      onToggleAll: jest.fn(),
    };
    const rows = [{ id: "1", name: "alpha", url: "u1" }];

    const { rerender } = render(<TagTable tags={rows} {...props} />);
    expect(screen.getByText("alpha")).toBeInTheDocument();

    rerender(<TagTable tags={[]} {...props} />);
    expect(screen.getByText("No tags found")).toBeInTheDocument();

    rerender(<TagTable tags={rows} {...props} />);
    expect(screen.getByText("alpha")).toBeInTheDocument();
  });

  it("toggles row selection and select-all", () => {
    const onToggle = jest.fn();
    const onToggleAll = jest.fn();

    render(
      <TagTable
        tags={[
          { id: "1", name: "alpha", url: "u1" },
          { id: "2", name: "beta", url: "u2", count: 5 },
        ]}
        selectedIds={new Set(["2"])}
        onToggle={onToggle}
        onToggleAll={onToggleAll}
      />
    );

    const checkboxes = screen.getAllByRole("checkbox");

    fireEvent.click(checkboxes[0]);
    fireEvent.click(checkboxes[1]);

    expect(onToggleAll).toHaveBeenCalled();
    expect(onToggle).toHaveBeenCalledWith("1");
  });
});

describe("TagTable — sorting", () => {
  const tags = [
    { id: "1", name: "alpha", url: "u", count: 3 },
    { id: "2", name: "beta", url: "u", count: 0 },
  ];
  const renderTable = (sort: SortState, onSort = jest.fn()) => {
    render(
      <TagTable
        tags={tags}
        selectedIds={new Set()}
        onToggle={jest.fn()}
        onToggleAll={jest.fn()}
        sort={sort}
        onSort={onSort}
      />
    );
    return onSort;
  };

  it("lets the Tag and Work items columns be sorted, and says which one is", () => {
    renderTable({ key: "count", direction: "asc" });

    expect(screen.getByRole("button", { name: "Tag" }).closest("th")).not.toHaveAttribute("aria-sort");
    expect(screen.getByRole("button", { name: "Work items (org-wide)" }).closest("th")).toHaveAttribute(
      "aria-sort",
      "ascending"
    );
  });

  it("reports a descending sort on the active column", () => {
    renderTable({ key: "name", direction: "desc" });

    expect(screen.getByRole("button", { name: "Tag" }).closest("th")).toHaveAttribute(
      "aria-sort",
      "descending"
    );
  });

  it("asks for the least-used tags first when the count header is chosen", () => {
    const onSort = renderTable({ key: "name", direction: "asc" });

    fireEvent.click(screen.getByRole("button", { name: "Work items (org-wide)" }));

    expect(onSort).toHaveBeenCalledWith({ key: "count", direction: "asc" });
  });

  it("flips the direction when the active column's header is chosen again", () => {
    const onSort = renderTable({ key: "name", direction: "asc" });

    fireEvent.click(screen.getByRole("button", { name: "Tag" }));

    expect(onSort).toHaveBeenCalledWith({ key: "name", direction: "desc" });
  });

  it("does not make the selection column sortable", () => {
    renderTable({ key: "name", direction: "asc" });

    expect(screen.getAllByRole("button")).toHaveLength(2);
  });
});

describe("TagTable — rename wiring", () => {
  it("renders EditableTagName when onRename is provided", async () => {
    const user = userEvent.setup();
    const onRename = jest.fn();
    render(
      <TagTable
        tags={[{ id: "1", name: "alpha", url: "u1" }]}
        selectedIds={new Set()}
        onToggle={jest.fn()}
        onToggleAll={jest.fn()}
        onRename={onRename}
        existingNames={["alpha"]}
      />
    );
    await user.dblClick(screen.getByText("alpha"));
    expect(screen.getByRole("textbox", { name: "Edit tag name" })).toBeInTheDocument();
  });

  it("renders plain text when onRename is not provided", () => {
    render(
      <TagTable
        tags={[{ id: "1", name: "alpha", url: "u1" }]}
        selectedIds={new Set()}
        onToggle={jest.fn()}
        onToggleAll={jest.fn()}
      />
    );
    expect(screen.getByText("alpha")).toBeInTheDocument();
    expect(screen.queryByTitle("Rename")).not.toBeInTheDocument();
  });

  it("calls onRename with tagId and new name when rename is committed", async () => {
    const user = userEvent.setup();
    const onRename = jest.fn();
    render(
      <TagTable
        tags={[{ id: "tag-1", name: "alpha", url: "u1" }]}
        selectedIds={new Set()}
        onToggle={jest.fn()}
        onToggleAll={jest.fn()}
        onRename={onRename}
        existingNames={["alpha"]}
      />
    );
    await user.dblClick(screen.getByText("alpha"));
    const input = screen.getByRole("textbox", { name: "Edit tag name" });
    await user.clear(input);
    await user.type(input, "beta");
    await user.keyboard("[Enter]");
    expect(onRename).toHaveBeenCalledWith("tag-1", "beta");
  });
});

it("exposes a test hook per row carrying the tag name", () => {
  render(
    <TagTable
      tags={[{ id: "1", name: "alpha", url: "" }]}
      selectedIds={new Set()}
      onToggle={() => {}}
      onToggleAll={() => {}}
    />
  );

  const row = document.querySelector('[data-testid="tag-row"]');
  expect(row).not.toBeNull();
  expect(row?.getAttribute("data-tag-name")).toBe("alpha");
});

it("exposes a test hook per count cell carrying the tag name", () => {
  render(
    <TagTable
      tags={[{ id: "1", name: "alpha", url: "", count: 4 }]}
      selectedIds={new Set()}
      onToggle={() => {}}
      onToggleAll={() => {}}
    />
  );

  const cell = document.querySelector('[data-testid="tag-count"][data-tag-name="alpha"]');
  expect(cell?.textContent).toBe("4");
});
