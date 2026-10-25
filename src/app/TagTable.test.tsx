import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { TagTable } from "./TagTable";

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
