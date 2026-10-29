import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { PillVariant } from "azure-devops-ui/Pill";

import { TagItem } from "../types";
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

  describe("warning copy", () => {
    const twoSources = [
      { id: "1", name: "one", url: "u" },
      { id: "2", name: "two", url: "u" },
    ];
    const renderDialog = () =>
      render(
        <MergeDialog
          sources={twoSources}
          allTags={[{ id: "3", name: "keeper", url: "u" }]}
          onConfirm={jest.fn()}
          onCancel={jest.fn()}
        />
      );
    const target = () => screen.getByPlaceholderText("Type to search or create a tag");
    const warning = () => screen.getByTestId("merge-warning");

    it("asks which tag to keep, and says the tags can be clicked, before describing what will be removed", () => {
      renderDialog();

      expect(warning()).toHaveTextContent(
        "Choose the tag to keep: click one of the tags below, or name a different one. Every other selected tag is deleted, and work items that use them are re-tagged with the tag you keep."
      );
      expect(warning()).not.toHaveTextContent("will be merged into the target");
    });

    it("does not talk about other tags when only one is selected", () => {
      render(
        <MergeDialog
          sources={[{ id: "1", name: "solo", url: "u" }]}
          allTags={[{ id: "3", name: "keeper", url: "u" }]}
          onConfirm={jest.fn()}
          onCancel={jest.fn()}
        />
      );

      expect(warning()).toHaveTextContent(
        "Choose the tag to keep. The selected tag is deleted, and work items that use it are re-tagged with the tag you keep."
      );
      expect(warning()).not.toHaveTextContent(/every other/i);
      expect(warning()).not.toHaveTextContent(/click one of the tags/i);
    });

    it("names the kept tag when the target is one of the selected tags", () => {
      renderDialog();
      fireEvent.change(target(), { target: { value: "one" } });

      expect(warning()).toHaveTextContent(
        "“one” is kept. The other tag is deleted, and work items that use it are re-tagged with “one”."
      );
    });

    it("names the target when other tags are merged into a different tag", () => {
      renderDialog();
      fireEvent.change(target(), { target: { value: "keeper" } });

      expect(warning()).toHaveTextContent(
        "The 2 selected tags are deleted, and work items that use them are re-tagged with “keeper”."
      );
    });

    it("says a brand-new target will be created", () => {
      renderDialog();
      fireEvent.change(target(), { target: { value: "fresh" } });

      expect(warning()).toHaveTextContent("“fresh” will be created");
    });
  });

  it("shows each selected tag's work item count and how old the counts are", () => {
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    render(
      <MergeDialog
        sources={[
          { id: "1", name: "one", url: "u", count: 7 },
          { id: "2", name: "two", url: "u", count: 0 },
        ]}
        allTags={[]}
        countsUpdatedAt={fiveMinutesAgo}
        onConfirm={jest.fn()}
        onCancel={jest.fn()}
      />
    );

    expect(screen.getByTestId("tag-count-one")).toHaveTextContent("7");
    expect(screen.getByTestId("tag-count-two")).toHaveTextContent("0");
    expect(screen.getByTestId("counts-note")).toHaveTextContent("counted 5 minutes ago");
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

    fireEvent.click(screen.getByRole("button", { name: /^Keep “one”/ }));

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

    fireEvent.click(screen.getByRole("button", { name: /^Keep “one”/ }));
    fireEvent.click(screen.getByRole("button", { name: /^Keep “one”/ }));

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

    fireEvent.click(screen.getByRole("button", { name: /^Keep “solo”/ }));

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

    fireEvent.keyDown(screen.getByRole("button", { name: /^Keep “one”/ }), { key: "Enter" });

    expect(
      screen.getByPlaceholderText("Type to search or create a tag")
    ).toHaveValue("one");
  });

  describe("keyboard", () => {
    const placeholder = "Type to search or create a tag";
    const twoSources = [
      { id: "1", name: "one", url: "u" },
      { id: "2", name: "two", url: "u" },
    ];

    it("starts with focus in the target field", () => {
      render(<MergeDialog sources={sources} allTags={allTags} onConfirm={jest.fn()} onCancel={jest.fn()} />);

      expect(screen.getByPlaceholderText(placeholder)).toHaveFocus();
    });

    it("does not merge when Enter is pressed in the target field", () => {
      const onConfirm = jest.fn();
      render(<MergeDialog sources={sources} allTags={allTags} onConfirm={onConfirm} onCancel={jest.fn()} />);
      const input = screen.getByPlaceholderText(placeholder);

      fireEvent.change(input, { target: { value: "platform" } });
      fireEvent.keyDown(input, { key: "Enter" });

      expect(onConfirm).not.toHaveBeenCalled();
    });

    it("picks the highlighted suggestion on Enter without merging", () => {
      const onConfirm = jest.fn();
      render(<MergeDialog sources={sources} allTags={allTags} onConfirm={onConfirm} onCancel={jest.fn()} />);
      const input = screen.getByPlaceholderText(placeholder);

      fireEvent.keyDown(input, { key: "ArrowDown" });
      fireEvent.keyDown(input, { key: "Enter" });

      expect(input).toHaveValue("platform");
      expect(onConfirm).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole("button", { name: "Merge" }));
      expect(onConfirm).toHaveBeenCalledWith("platform");
    });

    it("cancels on Escape from a focused footer button, which swallows the key itself", () => {
      const onCancel = jest.fn();
      render(<MergeDialog sources={sources} allTags={allTags} onConfirm={jest.fn()} onCancel={onCancel} />);

      fireEvent.keyDown(screen.getByRole("button", { name: "Cancel" }), { key: "Escape" });

      expect(onCancel).toHaveBeenCalledTimes(1);
    });

    it("cancels once, not twice, on Escape from the target field", () => {
      const onCancel = jest.fn();
      render(<MergeDialog sources={sources} allTags={allTags} onConfirm={jest.fn()} onCancel={onCancel} />);

      fireEvent.keyDown(screen.getByPlaceholderText(placeholder), { key: "Escape" });

      expect(onCancel).toHaveBeenCalledTimes(1);
    });

    it("ignores Escape while the merge is running", () => {
      const onCancel = jest.fn();
      render(
        <MergeDialog
          sources={twoSources}
          allTags={[]}
          busyLabel="Merging…"
          onConfirm={jest.fn()}
          onCancel={onCancel}
        />
      );

      fireEvent.keyDown(screen.getByPlaceholderText(placeholder), { key: "Escape" });

      expect(onCancel).not.toHaveBeenCalled();
    });

    it("keeps pills out of the dialog's focus zone so Tab can reach the controls after them", () => {
      const { container } = render(
        <MergeDialog sources={twoSources} allTags={allTags} onConfirm={jest.fn()} onCancel={jest.fn()} />
      );

      expect(screen.getAllByTestId("pill").length).toBeGreaterThan(0);
      expect(container.querySelectorAll("[data-focuszone]")).toHaveLength(0);
    });
  });

  describe("target field semantics", () => {
    const placeholder = "Type to search or create a tag";

    it("is a named combobox that owns the suggestion listbox", () => {
      render(<MergeDialog sources={sources} allTags={allTags} onConfirm={jest.fn()} onCancel={jest.fn()} />);

      const input = screen.getByRole("combobox", { name: "Tag to keep" });
      const listbox = screen.getByRole("listbox");

      expect(input).toHaveAttribute("aria-controls", listbox.id);
      expect(input).toHaveAttribute("aria-autocomplete", "list");
      expect(screen.getAllByRole("option")).toHaveLength(2);
    });

    it("points aria-activedescendant at the highlighted option", () => {
      render(<MergeDialog sources={sources} allTags={allTags} onConfirm={jest.fn()} onCancel={jest.fn()} />);
      const input = screen.getByRole("combobox", { name: "Tag to keep" });

      expect(input).not.toHaveAttribute("aria-activedescendant");

      fireEvent.keyDown(input, { key: "ArrowDown" });
      fireEvent.keyDown(input, { key: "ArrowDown" });

      const options = screen.getAllByRole("option");
      expect(options[1]).toHaveAttribute("aria-selected", "true");
      expect(options[0]).toHaveAttribute("aria-selected", "false");
      expect(input).toHaveAttribute("aria-activedescendant", options[1].id);
    });

    it("lists the create-new row as an option too", () => {
      render(<MergeDialog sources={sources} allTags={allTags} onConfirm={jest.fn()} onCancel={jest.fn()} />);
      const input = screen.getByRole("combobox", { name: "Tag to keep" });

      fireEvent.change(input, { target: { value: "brand-new" } });
      fireEvent.keyDown(input, { key: "ArrowDown" });

      const create = screen.getByRole("option", { name: /brand-new/ });
      expect(create).toHaveAttribute("aria-selected", "true");
      expect(input).toHaveAttribute("aria-activedescendant", create.id);
    });

    it.each([
      ["a semicolon", "front;end", /semicolon/i],
      ["more than 256 characters", "x".repeat(257), /256/],
    ])("rejects a new tag name with %s and keeps Merge off", (_label, value, reason) => {
      const onConfirm = jest.fn();
      render(<MergeDialog sources={sources} allTags={allTags} onConfirm={onConfirm} onCancel={jest.fn()} />);
      const input = screen.getByRole("combobox", { name: "Tag to keep" });

      fireEvent.change(input, { target: { value } });

      expect(screen.getByRole("alert")).toHaveTextContent(reason);
      expect(input).toHaveAttribute("aria-invalid", "true");
      expect(input).toHaveAttribute("aria-describedby", screen.getByRole("alert").id);
      expect(screen.getByRole("button", { name: "Merge" })).toBeDisabled();
      expect(screen.getByTestId("merge-warning")).not.toHaveTextContent(/will be created/);
      fireEvent.click(screen.getByRole("button", { name: "Merge" }));
      expect(onConfirm).not.toHaveBeenCalled();
    });

    it("shows no error for a valid new tag name", () => {
      render(<MergeDialog sources={sources} allTags={allTags} onConfirm={jest.fn()} onCancel={jest.fn()} />);

      fireEvent.change(screen.getByPlaceholderText(placeholder), { target: { value: "brand-new" } });

      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Merge" })).toBeEnabled();
    });
  });

  describe("while the merge is running", () => {
    const twoSources = [
      { id: "1", name: "one", url: "u" },
      { id: "2", name: "two", url: "u" },
    ];

    it("locks the target so it cannot change under the running merge", () => {
      render(
        <MergeDialog sources={twoSources} allTags={allTags} busyLabel="Merging…" onConfirm={jest.fn()} onCancel={jest.fn()} />
      );
      const input = screen.getByRole("combobox", { name: "Tag to keep" });

      expect(input).toHaveAttribute("readonly");
      fireEvent.change(input, { target: { value: "platform" } });
      fireEvent.click(screen.getByRole("button", { name: /^Keep “one”/ }));
      fireEvent.mouseDown(screen.getAllByRole("option")[0]);

      expect(input).toHaveValue("");
    });
  });

  describe("large tag sets", () => {
    const many = Array.from({ length: 300 }, (_, i) => ({
      id: `t${i}`,
      name: `bulk-${String(i).padStart(3, "0")}`,
      url: "u",
    }));

    it("renders only the first 50 tags and says how many more there are", () => {
      render(<MergeDialog sources={sources} allTags={many} onConfirm={jest.fn()} onCancel={jest.fn()} />);

      expect(screen.getAllByRole("option")).toHaveLength(50);
      expect(screen.getByTestId("suggestions-hint")).toHaveTextContent("Showing the first 50 of 300 tags");
    });

    it("says matches, not tags, once the user has typed", () => {
      render(<MergeDialog sources={sources} allTags={many} onConfirm={jest.fn()} onCancel={jest.fn()} />);

      fireEvent.change(screen.getByRole("combobox", { name: "Tag to keep" }), { target: { value: "bulk" } });

      expect(screen.getByTestId("suggestions-hint")).toHaveTextContent("Showing the first 50 of 300 matches");
    });

    it("has no hint when every match fits", () => {
      render(<MergeDialog sources={sources} allTags={allTags} onConfirm={jest.fn()} onCancel={jest.fn()} />);

      expect(screen.queryByTestId("suggestions-hint")).not.toBeInTheDocument();
    });

    it("lists the exact match first even when it sorts after 50 other matches", () => {
      const tags = [
        ...Array.from({ length: 80 }, (_, i) => ({ id: `a${i}`, name: `a-api-${String(i).padStart(2, "0")}`, url: "u" })),
        { id: "exact", name: "api", url: "u" },
        { id: "prefix", name: "api-gateway", url: "u" },
      ];
      render(<MergeDialog sources={sources} allTags={tags} onConfirm={jest.fn()} onCancel={jest.fn()} />);

      fireEvent.change(screen.getByRole("combobox", { name: "Tag to keep" }), { target: { value: "api" } });

      const names = screen.getAllByRole("option").map((o) => o.textContent);
      expect(names[0]).toBe("api");
      expect(names[1]).toBe("api-gateway");
      expect(names).toHaveLength(50);
    });

    it("moves the highlight within the visible rows and never past the last one", () => {
      render(<MergeDialog sources={sources} allTags={many} onConfirm={jest.fn()} onCancel={jest.fn()} />);
      const input = screen.getByRole("combobox", { name: "Tag to keep" });

      for (let i = 0; i < 80; i++) fireEvent.keyDown(input, { key: "ArrowDown" });

      const options = screen.getAllByRole("option");
      expect(options[49]).toHaveAttribute("aria-selected", "true");
      expect(input).toHaveAttribute("aria-activedescendant", options[49].id);
    });
  });

  describe("choosing which tag to keep", () => {
    const twoSources: TagItem[] = [
      { id: "1", name: "one", url: "u", count: 1 },
      { id: "2", name: "two", url: "u", count: 1234 },
    ];
    const renderDialog = (tags: TagItem[] = twoSources) =>
      render(<MergeDialog sources={tags} allTags={allTags} onConfirm={jest.fn()} onCancel={jest.fn()} />);

    it("calls the field what the warning calls it", () => {
      renderDialog();

      expect(screen.getByRole("combobox", { name: "Tag to keep" })).toBeInTheDocument();
      expect(screen.getByText("Tag to keep")).toBeInTheDocument();
      expect(screen.queryByText("Target tag")).not.toBeInTheDocument();
    });

    it("names each source pill by what clicking it does and how many work items it is on", () => {
      renderDialog();

      expect(screen.getByRole("button", { name: "Keep “one”, used on 1 work item" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Keep “two”, used on 1,234 work items" })).toBeInTheDocument();
    });

    it("leaves the count out of a source pill's name when it is unknown", () => {
      renderDialog([{ id: "1", name: "one", url: "u" }]);

      expect(screen.getByRole("button", { name: "Keep “one”" })).toBeInTheDocument();
    });

    it("tells hovering users what a source pill does, and what it does once it is kept", () => {
      renderDialog();
      const pill = screen.getByRole("button", { name: /^Keep “one”/ });

      expect(pill).toHaveAttribute("title", "Keep this tag");

      fireEvent.click(pill);

      expect(pill).toHaveAttribute("title", "This tag is kept. Click again to choose a different one.");
      expect(pill).toHaveAttribute("aria-pressed", "true");
    });

    it("names the create option by what it does", () => {
      renderDialog();

      fireEvent.change(screen.getByRole("combobox", { name: "Tag to keep" }), { target: { value: "brand-new" } });

      expect(screen.getByRole("option", { name: "Create new tag “brand-new”" })).toBeInTheDocument();
    });
  });
});
