import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { PillVariant } from "azure-devops-ui/Pill";

import { MergeDialog } from "./MergeDialog";

describe("MergeDialog", () => {
  const sources = [{ id: "1", name: "old-tag", url: "u" }];
  const allTags = [
    { id: "2", name: "platform", url: "u" },
    { id: "3", name: "frontend", url: "u" },
  ];

  it("supports selecting an existing suggestion", () => {
    const onConfirm = jest.fn();

    render(
      <MergeDialog
        sources={sources}
        allTags={allTags}
        onConfirm={onConfirm}
        onCancel={jest.fn()}
      />
    );

    fireEvent.change(screen.getByPlaceholderText("Type to search or create a tag"), {
      target: { value: "plat" },
    });

    fireEvent.mouseDown(screen.getByText("platform"));
    fireEvent.click(screen.getByRole("button", { name: "Merge" }));

    expect(onConfirm).toHaveBeenCalledWith("platform");
  });

  it("shows create-new affordance for unknown target tag", () => {
    render(
      <MergeDialog
        sources={sources}
        allTags={allTags}
        onConfirm={jest.fn()}
        onCancel={jest.fn()}
      />
    );

    fireEvent.change(screen.getByPlaceholderText("Type to search or create a tag"), {
      target: { value: "newly-created" },
    });

    expect(screen.getByText("Create new")).toBeInTheDocument();
  });

  it("shows all non-source tags when the input is empty", () => {
    render(
      <MergeDialog
        sources={sources}
        allTags={allTags}
        onConfirm={jest.fn()}
        onCancel={jest.fn()}
      />
    );

    expect(screen.getAllByTestId("pill")).toHaveLength(3);
    expect(screen.getByText("platform")).toBeInTheDocument();
    expect(screen.getByText("frontend")).toBeInTheDocument();
    expect(screen.getByText("old-tag")).toBeInTheDocument();
  });

  it("selects a source tag as the target when its pill is clicked", () => {
    const onConfirm = jest.fn();
    const twoSources = [
      { id: "1", name: "one", url: "u" },
      { id: "2", name: "two", url: "u" },
    ];

    render(
      <MergeDialog
        sources={twoSources}
        allTags={[]}
        onConfirm={onConfirm}
        onCancel={jest.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "one" }));

    expect(
      screen.getByPlaceholderText("Type to search or create a tag")
    ).toHaveValue("one");
    expect(screen.getByText("1 tag will be merged")).toBeInTheDocument();

    const targetPill = screen.getByText("one").closest('[data-testid="pill"]');
    expect(targetPill).toHaveAttribute("data-variant", String(PillVariant.standard));
    expect(targetPill).toHaveAttribute("data-icon", "CheckMark");

    fireEvent.click(screen.getByRole("button", { name: "Merge" }));
    expect(onConfirm).toHaveBeenCalledWith("one");
  });

  it("deselects a source pill when it is clicked again", () => {
    const twoSources = [
      { id: "1", name: "one", url: "u" },
      { id: "2", name: "two", url: "u" },
    ];

    render(
      <MergeDialog
        sources={twoSources}
        allTags={[]}
        onConfirm={jest.fn()}
        onCancel={jest.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "one" }));
    fireEvent.click(screen.getByRole("button", { name: "one" }));

    expect(
      screen.getByPlaceholderText("Type to search or create a tag")
    ).toHaveValue("");
    expect(screen.getByText("2 tags will be merged")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Merge" })).toBeDisabled();
  });

  it("disables Merge when the only source is selected as its own target", () => {
    const oneSource = [{ id: "1", name: "solo", url: "u" }];

    render(
      <MergeDialog
        sources={oneSource}
        allTags={[]}
        onConfirm={jest.fn()}
        onCancel={jest.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "solo" }));

    expect(screen.getByRole("button", { name: "Merge" })).toBeDisabled();
  });

  it("supports selecting a source pill via the keyboard", () => {
    const onConfirm = jest.fn();
    const twoSources = [
      { id: "1", name: "one", url: "u" },
      { id: "2", name: "two", url: "u" },
    ];

    render(
      <MergeDialog
        sources={twoSources}
        allTags={[]}
        onConfirm={onConfirm}
        onCancel={jest.fn()}
      />
    );

    fireEvent.keyDown(screen.getByRole("button", { name: "one" }), { key: "Enter" });

    expect(
      screen.getByPlaceholderText("Type to search or create a tag")
    ).toHaveValue("one");
  });
});
