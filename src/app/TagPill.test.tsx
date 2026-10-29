import React from "react";
import { render, screen } from "@testing-library/react";
import { TagPill } from "./TagPill";

describe("TagPill", () => {
  const tag = { id: "1", name: "a-very-long-tag-name", url: "u", count: 1234 };

  it("puts the name in its own element with the full name as the tooltip", () => {
    render(<TagPill tag={tag} />);

    expect(screen.getByText("a-very-long-tag-name")).toHaveAttribute("title", "a-very-long-tag-name");
  });

  it("shows the count outside the name so it cannot be truncated with it", () => {
    render(<TagPill tag={tag} showCount={true} />);

    const count = screen.getByTestId("tag-count-a-very-long-tag-name");
    expect(count).toHaveTextContent("1,234");
    expect(screen.getByText("a-very-long-tag-name")).not.toContainElement(count);
  });

  it.each([
    [1, "1 work item"],
    [0, "0 work items"],
    [1234, "1,234 work items"],
  ])("describes a count of %s as %s", (count, text) => {
    render(<TagPill tag={{ ...tag, count }} showCount={true} />);

    expect(screen.getByTestId("tag-count-a-very-long-tag-name")).toHaveAttribute("title", text);
  });

  it("omits the count unless asked for it", () => {
    render(<TagPill tag={tag} />);

    expect(screen.queryByTestId("tag-count-a-very-long-tag-name")).not.toBeInTheDocument();
  });

  it("stays out of the dialog's focus zone", () => {
    const { container } = render(<TagPill tag={tag} />);

    expect(container.querySelectorAll("[data-focuszone]")).toHaveLength(0);
  });
});
