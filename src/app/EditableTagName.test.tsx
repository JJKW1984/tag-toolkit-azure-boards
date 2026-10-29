import React, { useState } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EditableTagName } from "./EditableTagName";

const defaultProps = {
  name: "old-tag",
  onRename: jest.fn(),
  onCancel: jest.fn(),
  existingNames: ["platform", "frontend"],
};

beforeEach(() => {
  defaultProps.onRename.mockReset();
  defaultProps.onCancel.mockReset();
});

describe("EditableTagName — display mode", () => {
  it("renders the tag name as text", () => {
    render(<EditableTagName {...defaultProps} />);
    expect(screen.getByText("old-tag")).toBeInTheDocument();
  });

  it("shortens a name that does not fit, and still gives its full text and how to rename it on hover", () => {
    const long = "a-very-long-tag-name-".repeat(6);
    render(<EditableTagName {...defaultProps} name={long} />);
    const button = screen.getByRole("button", { name: `Rename tag ${long}` });
    // The ellipsis is drawn by CSS on this element.
    expect(button.querySelector(".tm-tag-name")).toHaveTextContent(long);
    expect(button).toHaveAttribute("title", expect.stringContaining(long));
    expect(button).toHaveAttribute("title", expect.stringContaining("Double-click, Enter, or F2 to rename"));
  });

  it("does not show an input initially", () => {
    render(<EditableTagName {...defaultProps} />);
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("shows a pencil icon when hovered", async () => {
    const user = userEvent.setup();
    render(<EditableTagName {...defaultProps} />);
    await user.hover(screen.getByText("old-tag"));
    expect(screen.getByTitle("Rename")).toBeInTheDocument();
  });

  it("hides the pencil icon when not hovered", () => {
    render(<EditableTagName {...defaultProps} />);
    expect(screen.queryByTitle("Rename")).not.toBeInTheDocument();
  });

  it("shows a visible focus outline when focused", async () => {
    const user = userEvent.setup();
    render(<EditableTagName {...defaultProps} />);
    await user.tab();
    expect(screen.getByRole("button", { name: /Rename tag old-tag/i })).toHaveStyle(
      "outline: 2px solid var(--tm-focus)"
    );
  });
});

describe("EditableTagName — entering edit mode", () => {
  it("shows a text input after double-click", async () => {
    const user = userEvent.setup();
    render(<EditableTagName {...defaultProps} />);
    await user.dblClick(screen.getByText("old-tag"));
    expect(screen.getByRole("textbox", { name: "Edit tag name" })).toBeInTheDocument();
  });

  it("pre-fills the input with the current name", async () => {
    const user = userEvent.setup();
    render(<EditableTagName {...defaultProps} />);
    await user.dblClick(screen.getByText("old-tag"));
    expect(screen.getByRole("textbox", { name: "Edit tag name" })).toHaveValue("old-tag");
  });

  it("enters edit mode with keyboard Enter when focused", async () => {
    const user = userEvent.setup();
    render(<EditableTagName {...defaultProps} />);
    await user.tab();
    await user.keyboard("[Enter]");
    expect(screen.getByRole("textbox", { name: "Edit tag name" })).toBeInTheDocument();
  });

  it("enters edit mode with keyboard F2 when focused", async () => {
    const user = userEvent.setup();
    render(<EditableTagName {...defaultProps} />);
    await user.tab();
    await user.keyboard("{F2}");
    expect(screen.getByRole("textbox", { name: "Edit tag name" })).toBeInTheDocument();
  });

  it("enters edit mode with keyboard Space when focused", async () => {
    const user = userEvent.setup();
    render(<EditableTagName {...defaultProps} />);
    await user.tab();
    await user.keyboard(" ");
    expect(screen.getByRole("textbox", { name: "Edit tag name" })).toBeInTheDocument();
  });
});

describe("EditableTagName — committing a rename", () => {
  it("calls onRename with the trimmed new value when Enter is pressed", async () => {
    const user = userEvent.setup();
    render(<EditableTagName {...defaultProps} />);
    await user.dblClick(screen.getByText("old-tag"));
    const input = screen.getByRole("textbox", { name: "Edit tag name" });
    await user.clear(input);
    await user.type(input, "new-name");
    await user.keyboard("[Enter]");
    expect(defaultProps.onRename).toHaveBeenCalledWith("new-name");
  });

  it("exits edit mode after Enter", async () => {
    const user = userEvent.setup();
    render(<EditableTagName {...defaultProps} />);
    await user.dblClick(screen.getByText("old-tag"));
    await user.keyboard("[Enter]");
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("does not rename when the input is blurred: leaving the field abandons the edit", async () => {
    const user = userEvent.setup();
    render(<EditableTagName {...defaultProps} />);
    await user.dblClick(screen.getByText("old-tag"));
    const input = screen.getByRole("textbox", { name: "Edit tag name" });
    await user.clear(input);
    await user.type(input, "blurred-name");
    await user.tab();
    expect(defaultProps.onRename).not.toHaveBeenCalled();
    expect(defaultProps.onCancel).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.getByText("old-tag")).toBeInTheDocument();
  });

  it("does not offer a second edit, or send a second rename, while one is in flight", async () => {
    let resolveRename: (() => void) | undefined;
    const onRename = jest.fn(
      () => new Promise<void>((resolve) => { resolveRename = resolve; })
    );
    const user = userEvent.setup();
    render(
      <EditableTagName
        name="old-tag"
        onRename={onRename}
        onCancel={jest.fn()}
        existingNames={[]}
      />
    );

    await user.dblClick(screen.getByText("old-tag"));
    const input = screen.getByRole("textbox", { name: "Edit tag name" });
    await user.clear(input);
    await user.type(input, "new-name");
    await user.keyboard("[Enter]");
    await user.keyboard("[Enter]");

    // The editor is still the only thing on screen for this tag: there is no name button to start again from.
    expect(screen.queryByRole("button", { name: /Rename tag/i })).not.toBeInTheDocument();
    expect(onRename).toHaveBeenCalledTimes(1);

    resolveRename?.();
    await waitFor(() => expect(screen.queryByRole("textbox", { name: "Edit tag name" })).not.toBeInTheDocument());
    expect(onRename).toHaveBeenCalledTimes(1);
  });
});

describe("EditableTagName — cancelling a rename", () => {
  it("calls onCancel and exits edit mode when Escape is pressed", async () => {
    const user = userEvent.setup();
    render(<EditableTagName {...defaultProps} />);
    await user.dblClick(screen.getByText("old-tag"));
    await user.keyboard("[Escape]");
    expect(defaultProps.onCancel).toHaveBeenCalled();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("shows the original name again after Escape", async () => {
    const user = userEvent.setup();
    render(<EditableTagName {...defaultProps} />);
    await user.dblClick(screen.getByText("old-tag"));
    const input = screen.getByRole("textbox", { name: "Edit tag name" });
    await user.clear(input);
    await user.type(input, "something-else");
    await user.keyboard("[Escape]");
    expect(screen.getByText("old-tag")).toBeInTheDocument();
  });

  it("keeps the editor open, with the draft, when onRename rejects (API failure)", async () => {
    const onRename = jest.fn().mockRejectedValue(new Error("api error"));
    const onCancel = jest.fn();
    const user = userEvent.setup();
    render(
      <EditableTagName
        name="old-tag"
        onRename={onRename}
        onCancel={onCancel}
        existingNames={[]}
      />
    );
    await user.dblClick(screen.getByText("old-tag"));
    const input = screen.getByRole("textbox", { name: "Edit tag name" });
    await user.clear(input);
    await user.type(input, "new-name");
    await user.keyboard("[Enter]");
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't rename “old-tag”: api error");
    expect(onCancel).not.toHaveBeenCalled();
    expect(screen.getByRole("textbox", { name: "Edit tag name" })).toHaveValue("new-name");
    expect(screen.getByRole("textbox", { name: "Edit tag name" })).toHaveFocus();
  });
});

describe("EditableTagName — validation", () => {
  it("shows an error and stays in edit mode when Enter is pressed with empty input", async () => {
    const user = userEvent.setup();
    render(<EditableTagName {...defaultProps} />);
    await user.dblClick(screen.getByText("old-tag"));
    const input = screen.getByRole("textbox", { name: "Edit tag name" });
    await user.clear(input);
    await user.keyboard("[Enter]");
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByRole("textbox")).toBeInTheDocument();
    expect(defaultProps.onRename).not.toHaveBeenCalled();
  });

  it("shows a merge hint when the typed name matches an existing tag", async () => {
    const user = userEvent.setup();
    render(<EditableTagName {...defaultProps} />);
    await user.dblClick(screen.getByText("old-tag"));
    const input = screen.getByRole("textbox", { name: "Edit tag name" });
    await user.clear(input);
    await user.type(input, "platform");
    await user.keyboard("[Enter]");
    expect(screen.getByRole("alert")).toHaveTextContent(/Merge/i);
    expect(defaultProps.onRename).not.toHaveBeenCalled();
  });

  it("treats duplicate check as case-insensitive", async () => {
    const user = userEvent.setup();
    render(<EditableTagName {...defaultProps} />);
    await user.dblClick(screen.getByText("old-tag"));
    const input = screen.getByRole("textbox", { name: "Edit tag name" });
    await user.clear(input);
    await user.type(input, "PLATFORM");
    await user.keyboard("[Enter]");
    expect(screen.getByRole("alert")).toHaveTextContent(/Merge/i);
  });

  it("treats renaming to the same name as nothing to do: no error, no rename, editor closes", async () => {
    const user = userEvent.setup();
    render(<EditableTagName {...defaultProps} />);
    await user.dblClick(screen.getByText("old-tag"));
    await user.keyboard("[Enter]");
    expect(defaultProps.onRename).not.toHaveBeenCalled();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("ignores spaces around an unchanged name", async () => {
    const user = userEvent.setup();
    render(<EditableTagName {...defaultProps} />);
    await user.dblClick(screen.getByText("old-tag"));
    const input = screen.getByRole("textbox", { name: "Edit tag name" });
    await user.clear(input);
    await user.type(input, "  old-tag  ");
    await user.keyboard("[Enter]");
    expect(defaultProps.onRename).not.toHaveBeenCalled();
  });

  it("still allows a change of letter case, which is a real rename", async () => {
    const user = userEvent.setup();
    render(<EditableTagName {...defaultProps} />);
    await user.dblClick(screen.getByText("old-tag"));
    const input = screen.getByRole("textbox", { name: "Edit tag name" });
    await user.clear(input);
    await user.type(input, "Old-Tag");
    await user.keyboard("[Enter]");
    expect(defaultProps.onRename).toHaveBeenCalledWith("Old-Tag");
  });

  it("clears the error message when the user starts typing again", async () => {
    const user = userEvent.setup();
    render(<EditableTagName {...defaultProps} />);
    await user.dblClick(screen.getByText("old-tag"));
    const input = screen.getByRole("textbox", { name: "Edit tag name" });
    await user.clear(input);
    await user.keyboard("[Enter]");
    expect(screen.getByRole("alert")).toBeInTheDocument();
    await user.type(input, "f");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("EditableTagName — telling the user what is happening", () => {
  const startEditing = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.dblClick(screen.getByText("old-tag"));
    return screen.getByRole("textbox", { name: "Edit tag name" });
  };

  it("says how to finish or abandon the edit, and ties that to the field", async () => {
    const user = userEvent.setup();
    render(<EditableTagName {...defaultProps} />);
    const input = await startEditing(user);

    const hint = screen.getByText("Press Enter to rename, Esc to cancel.");
    expect(input).toHaveAttribute("aria-describedby", expect.stringContaining(hint.id));
  });

  it("shows the pencil when the name is focused from the keyboard, not only on hover", async () => {
    const user = userEvent.setup();
    render(<EditableTagName {...defaultProps} />);
    expect(screen.queryByTitle("Rename")).not.toBeInTheDocument();

    await user.tab();

    expect(screen.getByTitle("Rename")).toBeInTheDocument();
  });

  it("marks the field invalid and points at the error", async () => {
    const user = userEvent.setup();
    render(<EditableTagName {...defaultProps} />);
    const input = await startEditing(user);
    await user.clear(input);
    await user.type(input, "frontend");
    await user.keyboard("[Enter]");

    const alert = screen.getByRole("alert");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input.getAttribute("aria-describedby")).toContain(alert.id);
  });

  it("locks the field and says it is renaming while the rename runs", async () => {
    let resolveRename: () => void = () => {};
    const onRename = jest.fn(() => new Promise<void>((resolve) => { resolveRename = resolve; }));
    const onCancel = jest.fn();
    const user = userEvent.setup();
    render(<EditableTagName name="old-tag" onRename={onRename} onCancel={onCancel} existingNames={[]} />);
    const input = await startEditing(user);
    await user.clear(input);
    await user.type(input, "new-name");
    await user.keyboard("[Enter]");

    expect(screen.getByRole("status")).toHaveTextContent("Renaming…");
    expect(input).toHaveAttribute("readonly");
    expect(input).toHaveFocus();

    // Neither Escape, blur nor a second Enter can interrupt or repeat a request that is already out.
    await user.keyboard("[Escape]");
    await user.tab();
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onCancel).not.toHaveBeenCalled();
    expect(onRename).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("textbox", { name: "Edit tag name" })).toBeInTheDocument();

    resolveRename();
    await waitFor(() => expect(screen.queryByRole("textbox")).not.toBeInTheDocument());
  });

  it("does not commit while an input method is composing", async () => {
    const user = userEvent.setup();
    render(<EditableTagName {...defaultProps} />);
    const input = await startEditing(user);
    fireEvent.change(input, { target: { value: "新しい" } });

    fireEvent.keyDown(input, { key: "Enter", isComposing: true });

    expect(defaultProps.onRename).not.toHaveBeenCalled();
    expect(screen.getByRole("textbox", { name: "Edit tag name" })).toBeInTheDocument();
  });

  it("lets right-to-left names be typed in their own direction", async () => {
    const user = userEvent.setup();
    render(<EditableTagName {...defaultProps} />);
    const input = await startEditing(user);

    expect(input).toHaveAttribute("dir", "auto");
  });
});

describe("EditableTagName — where focus goes", () => {
  const Harness: React.FC<{ onRename?: (n: string) => Promise<void> }> = ({ onRename }) => {
    const [name, setName] = useState("old-tag");
    return (
      <EditableTagName
        name={name}
        onRename={async (next) => {
          await onRename?.(next);
          setName(next);
        }}
        onCancel={jest.fn()}
        existingNames={[]}
      />
    );
  };
  const trigger = (name: string) => screen.getByRole("button", { name: `Rename tag ${name}` });

  it("returns to the name after Escape", async () => {
    const user = userEvent.setup();
    render(<EditableTagName {...defaultProps} />);
    await user.dblClick(screen.getByText("old-tag"));

    await user.keyboard("[Escape]");

    expect(trigger("old-tag")).toHaveFocus();
  });

  it("returns to the name when the name was not changed", async () => {
    const user = userEvent.setup();
    render(<EditableTagName {...defaultProps} />);
    await user.dblClick(screen.getByText("old-tag"));

    await user.keyboard("[Enter]");

    expect(trigger("old-tag")).toHaveFocus();
  });

  it("returns to the renamed tag's name after a successful rename", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.dblClick(screen.getByText("old-tag"));
    const input = screen.getByRole("textbox", { name: "Edit tag name" });
    await user.clear(input);
    await user.type(input, "new-name");

    await user.keyboard("[Enter]");

    await waitFor(() => expect(trigger("new-name")).toHaveFocus());
  });

  describe("when the rename moves the tag off the page", () => {
    // The list drops the renamed tag, as a re-sort that pushes it onto another page does.
    const Page: React.FC = () => {
      const [names, setNames] = useState(["alpha", "beta", "gamma"]);
      return (
        <>
          {names.map((n) => (
            <EditableTagName
              key={n}
              name={n}
              existingNames={[]}
              onCancel={jest.fn()}
              onRename={async () => {
                setNames((prev) => prev.filter((x) => x !== n));
              }}
            />
          ))}
        </>
      );
    };
    const renameTo = async (user: ReturnType<typeof userEvent.setup>, from: string, to: string) => {
      await user.dblClick(screen.getByText(from));
      const input = screen.getByRole("textbox", { name: "Edit tag name" });
      await user.clear(input);
      await user.type(input, to);
      await user.keyboard("[Enter]");
    };

    it("lands on the tag that moved up into its place, not on the page", async () => {
      const user = userEvent.setup();
      render(<Page />);

      await renameTo(user, "beta", "zeta");

      await waitFor(() => expect(trigger("gamma")).toHaveFocus());
    });

    it("lands on the last tag when the renamed one was last", async () => {
      const user = userEvent.setup();
      render(<Page />);

      await renameTo(user, "gamma", "zeta");

      await waitFor(() => expect(trigger("beta")).toHaveFocus());
    });
  });

  it("leaves focus where the user put it when they click or tab away", async () => {
    const user = userEvent.setup();
    render(
      <>
        <EditableTagName {...defaultProps} />
        <button>elsewhere</button>
      </>
    );
    await user.dblClick(screen.getByText("old-tag"));

    await user.click(screen.getByRole("button", { name: "elsewhere" }));

    expect(screen.getByRole("button", { name: "elsewhere" })).toHaveFocus();
  });
});
