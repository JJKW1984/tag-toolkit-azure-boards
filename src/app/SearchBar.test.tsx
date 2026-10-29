import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SearchBar } from "./SearchBar";

describe("SearchBar", () => {
  it("renders a searchbox with default placeholder", () => {
    render(<SearchBar value="" onChange={jest.fn()} />);
    expect(screen.getByRole("searchbox")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Search tags…")).toBeInTheDocument();
  });

  it("renders with a custom placeholder", () => {
    render(<SearchBar value="" onChange={jest.fn()} placeholder="Find a tag" />);
    expect(screen.getByPlaceholderText("Find a tag")).toBeInTheDocument();
  });

  it("does not show the clear button when value is empty", () => {
    render(<SearchBar value="" onChange={jest.fn()} />);
    expect(screen.queryByRole("button", { name: "Clear search" })).not.toBeInTheDocument();
  });

  it("shows the clear button when value is non-empty", () => {
    render(<SearchBar value="alpha" onChange={jest.fn()} />);
    expect(screen.getByRole("button", { name: "Clear search" })).toBeInTheDocument();
  });

  it("draws the clear button with the host's Clear icon, not a typed character", () => {
    render(<SearchBar value="alpha" onChange={jest.fn()} />);
    const clear = screen.getByRole("button", { name: "Clear search" });
    expect(clear).toHaveTextContent("");
    expect(clear.querySelector('[data-icon="Clear"]')).toBeInTheDocument();
  });

  it("calls onChange when the user types", async () => {
    const user = userEvent.setup();
    const onChange = jest.fn();
    render(<SearchBar value="" onChange={onChange} />);
    await user.type(screen.getByRole("searchbox"), "a");
    expect(onChange).toHaveBeenCalledWith("a");
  });

  it("calls onChange with empty string when the clear button is clicked", async () => {
    const user = userEvent.setup();
    const onChange = jest.fn();
    render(<SearchBar value="alpha" onChange={onChange} />);
    await user.click(screen.getByRole("button", { name: "Clear search" }));
    expect(onChange).toHaveBeenCalledWith("");
  });
});
