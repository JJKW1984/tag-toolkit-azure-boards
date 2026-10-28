import React from "react";
import { render, screen } from "@testing-library/react";
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
});