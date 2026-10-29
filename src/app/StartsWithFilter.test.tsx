import React from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Dropdown } from "azure-devops-ui/Dropdown";
import { StartsWithFilter } from "./StartsWithFilter";

const tags = [
  { id: "1", name: "alpha", url: "" },
  { id: "2", name: "beta", url: "" },
  { id: "3", name: "gamma", url: "" },
  { id: "4", name: "42-sprint", url: "" },
];

const filter = () => screen.getByRole("combobox", { name: "Starts with" });
const optionNames = () => within(filter()).getAllByRole("option").map((o) => o.textContent);

describe("StartsWithFilter", () => {
  beforeEach(() => {
    (Dropdown as unknown as { collapseCalls: number }).collapseCalls = 0;
  });

  // The real Dropdown stays open after Enter on a list item, so a keyboard user would have to
  // press Escape after every choice. The component closes it itself.
  it("closes the list once a letter is chosen", async () => {
    render(<StartsWithFilter tags={tags} activeFilter={null} onFilter={() => {}} />);

    await userEvent.selectOptions(filter(), "A");

    await waitFor(() =>
      expect((Dropdown as unknown as { collapseCalls: number }).collapseCalls).toBe(1)
    );
  });

  it("offers Any letter plus only the letters that have tags, with # last", () => {
    render(<StartsWithFilter tags={tags} activeFilter={null} onFilter={() => {}} />);

    expect(optionNames()).toEqual(["Any letter", "A", "B", "G", "# (numbers and symbols)"]);
  });

  it("shows Any letter when no letter is chosen", () => {
    render(<StartsWithFilter tags={tags} activeFilter={null} onFilter={() => {}} />);

    expect(filter()).toHaveDisplayValue("Any letter");
  });

  it("shows the chosen letter", () => {
    render(<StartsWithFilter tags={tags} activeFilter="B" onFilter={() => {}} />);

    expect(filter()).toHaveDisplayValue("B");
  });

  it("tells the user what the closed control is filtering by", () => {
    const { rerender } = render(<StartsWithFilter tags={tags} activeFilter={null} onFilter={() => {}} />);
    expect(screen.getByTestId("dropdown-text")).toHaveTextContent("Starts with: Any letter");

    rerender(<StartsWithFilter tags={tags} activeFilter="B" onFilter={() => {}} />);
    expect(screen.getByTestId("dropdown-text")).toHaveTextContent("Starts with: B");

    rerender(<StartsWithFilter tags={tags} activeFilter="#" onFilter={() => {}} />);
    expect(screen.getByTestId("dropdown-text")).toHaveTextContent("Starts with: # (numbers and symbols)");
  });

  it("calls onFilter with the letter that is chosen", async () => {
    const onFilter = jest.fn();
    render(<StartsWithFilter tags={tags} activeFilter={null} onFilter={onFilter} />);

    await userEvent.selectOptions(filter(), "A");

    expect(onFilter).toHaveBeenCalledWith("A");
  });

  it("calls onFilter(null) when Any letter is chosen", async () => {
    const onFilter = jest.fn();
    render(<StartsWithFilter tags={tags} activeFilter="A" onFilter={onFilter} />);

    await userEvent.selectOptions(filter(), "Any letter");

    expect(onFilter).toHaveBeenCalledWith(null);
  });

  it("calls onFilter('#') for numbers and symbols", async () => {
    const onFilter = jest.fn();
    render(<StartsWithFilter tags={tags} activeFilter={null} onFilter={onFilter} />);

    await userEvent.selectOptions(filter(), "# (numbers and symbols)");

    expect(onFilter).toHaveBeenCalledWith("#");
  });

  it("follows the active filter when it is cleared from outside", () => {
    const { rerender } = render(<StartsWithFilter tags={tags} activeFilter="B" onFilter={() => {}} />);
    expect(filter()).toHaveDisplayValue("B");

    rerender(<StartsWithFilter tags={tags} activeFilter={null} onFilter={() => {}} />);

    expect(filter()).toHaveDisplayValue("Any letter");
  });

  it("keeps the active letter listed even if no tag starts with it any more", () => {
    render(<StartsWithFilter tags={[{ id: "1", name: "alpha", url: "" }]} activeFilter="Q" onFilter={() => {}} />);

    expect(optionNames()).toContain("Q");
    expect(filter()).toHaveDisplayValue("Q");
  });
});
