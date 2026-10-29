import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { DeleteDialog } from "./DeleteDialog";

describe("DeleteDialog", () => {
  it("shows a count label and renders tags as pills", () => {
    render(
      <DeleteDialog
        tags={[
          { id: "1", name: "alpha", url: "u" },
          { id: "2", name: "beta", url: "u" },
        ]}
        onConfirm={jest.fn()}
        onCancel={jest.fn()}
      />
    );

    expect(screen.getByText("2 tags will be deleted")).toBeInTheDocument();
    expect(screen.queryByText("Tag")).not.toBeInTheDocument();
    expect(screen.getAllByTestId("pill")).toHaveLength(2);
    expect(screen.getByText("alpha")).toBeInTheDocument();
    expect(screen.getByText("beta")).toBeInTheDocument();
  });

  it("shows how many work items each tag is on, and how old that number is", () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    render(
      <DeleteDialog
        tags={[
          { id: "1", name: "alpha", url: "u", count: 42 },
          { id: "2", name: "beta", url: "u", count: 0 },
        ]}
        countsUpdatedAt={twoHoursAgo}
        onConfirm={jest.fn()}
        onCancel={jest.fn()}
      />
    );

    expect(screen.getByTestId("tag-count-alpha")).toHaveTextContent("42");
    expect(screen.getByTestId("tag-count-beta")).toHaveTextContent("0");
    expect(screen.getByTestId("counts-note")).toHaveTextContent("counted 2 hours ago");
    expect(screen.getByTestId("counts-note")).toHaveTextContent("Refresh counts");
  });

  it("says the impact is unknown when counts have not loaded", () => {
    render(
      <DeleteDialog
        tags={[{ id: "1", name: "alpha", url: "u" }]}
        countsUpdatedAt={null}
        onConfirm={jest.fn()}
        onCancel={jest.fn()}
      />
    );

    expect(screen.queryByTestId("tag-count-alpha")).not.toBeInTheDocument();
    expect(screen.getByTestId("counts-note")).toHaveTextContent("haven't loaded yet");
  });

  it("uses the singular label for one tag", () => {
    render(
      <DeleteDialog
        tags={[{ id: "1", name: "solo", url: "u" }]}
        onConfirm={jest.fn()}
        onCancel={jest.fn()}
      />
    );

    expect(screen.getByText("1 tag will be deleted")).toBeInTheDocument();
  });

  describe("keyboard safety", () => {
    const renderDialog = () => {
      const onConfirm = jest.fn();
      const onCancel = jest.fn();
      render(
        <DeleteDialog
          tags={[{ id: "1", name: "alpha", url: "u" }]}
          onConfirm={onConfirm}
          onCancel={onCancel}
        />
      );
      return { onConfirm, onCancel };
    };

    it("starts with focus on Cancel, not on the destructive button", () => {
      renderDialog();

      expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
    });

    it("does not delete when Enter is pressed as soon as the dialog opens", () => {
      const { onConfirm } = renderDialog();

      // Focus is always inside an open dialog, so the key press bubbles through it.
      const dialog = screen.getByRole("dialog");
      const inside = dialog.contains(document.activeElement) ? document.activeElement : dialog;
      fireEvent.keyDown(inside as Element, { key: "Enter" });

      expect(onConfirm).not.toHaveBeenCalled();
    });

    it("cancels on Escape from a focused button, which swallows the key itself", () => {
      const { onCancel } = renderDialog();

      fireEvent.keyDown(screen.getByRole("button", { name: "Cancel" }), { key: "Escape" });

      expect(onCancel).toHaveBeenCalledTimes(1);
    });

    it("cancels once, not twice, on Escape from elsewhere in the dialog", () => {
      const { onCancel } = renderDialog();

      fireEvent.keyDown(screen.getByTestId("delete-dialog"), { key: "Escape" });

      expect(onCancel).toHaveBeenCalledTimes(1);
    });

    it("ignores Escape while the delete is running", () => {
      const onCancel = jest.fn();
      render(
        <DeleteDialog
          tags={[{ id: "1", name: "alpha", url: "u" }]}
          busyLabel="Deleting 0 of 1…"
          onConfirm={jest.fn()}
          onCancel={onCancel}
        />
      );

      fireEvent.keyDown(screen.getByRole("button", { name: "Deleting 0 of 1…" }), { key: "Escape" });
      fireEvent.keyDown(screen.getByTestId("delete-dialog"), { key: "Escape" });

      expect(onCancel).not.toHaveBeenCalled();
    });

    it("still deletes when the Delete button itself is chosen", () => {
      const { onConfirm } = renderDialog();

      fireEvent.click(screen.getByRole("button", { name: "Delete 1 tag" }));

      expect(onConfirm).toHaveBeenCalledTimes(1);
    });
  });
});