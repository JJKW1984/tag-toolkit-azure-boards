import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mockTagService = {
  getAllTags: jest.fn(),
  getProjectName: jest.fn(),
  deleteTagById: jest.fn(),
  renameTagById: jest.fn(),
  mergeTag: jest.fn(),
};

jest.mock("../services/TagService", () => ({
  TagService: jest.fn(() => mockTagService),
}));

const mockTagCountCacheService = {
  getCache: jest.fn(),
  refreshCache: jest.fn(),
  shouldAutoRefresh: jest.fn(),
};

jest.mock("../services/TagCountCacheService", () => ({
  TagCountCacheService: jest.fn(() => mockTagCountCacheService),
}));

import { TagManagerApp } from "./TagManagerApp";

beforeEach(() => {
  localStorage.clear();
  Object.values(mockTagService).forEach((fn) => (fn as jest.Mock).mockReset());
  Object.values(mockTagCountCacheService).forEach((fn) => fn.mockReset());
  mockTagCountCacheService.getCache.mockResolvedValue(null);
  mockTagCountCacheService.shouldAutoRefresh.mockResolvedValue(false);
  mockTagService.getProjectName.mockResolvedValue("Demo Project");
  mockTagService.getAllTags.mockResolvedValue([
    { id: "1", name: "alpha", url: "u" },
    { id: "2", name: "beta", url: "u" },
  ]);
  mockTagService.renameTagById.mockResolvedValue({ id: "1", name: "renamed-tag", url: "u" });
});

describe("TagManagerApp — rename flow", () => {
  it("calls renameTagById with the correct id and new name", async () => {
    const user = userEvent.setup();
    render(<TagManagerApp />);

    await waitFor(() => expect(screen.getByText("alpha")).toBeInTheDocument());

    await user.dblClick(screen.getByText("alpha"));
    const input = screen.getByRole("textbox", { name: "Edit tag name" });
    await user.clear(input);
    await user.type(input, "renamed-tag");
    await user.keyboard("[Enter]");

    await waitFor(() => {
      expect(mockTagService.renameTagById).toHaveBeenCalledWith("1", "renamed-tag");
    });
  });

  it("updates the tag name in the list after a successful rename", async () => {
    const user = userEvent.setup();
    render(<TagManagerApp />);

    await waitFor(() => expect(screen.getByText("alpha")).toBeInTheDocument());

    await user.dblClick(screen.getByText("alpha"));
    const input = screen.getByRole("textbox", { name: "Edit tag name" });
    await user.clear(input);
    await user.type(input, "renamed-tag");
    await user.keyboard("[Enter]");

    await waitFor(() => {
      expect(screen.getByText("renamed-tag")).toBeInTheDocument();
      expect(screen.queryByText("alpha")).not.toBeInTheDocument();
    });
  });

  it("keeps tags alphabetically ordered after a successful rename", async () => {
    mockTagService.renameTagById.mockResolvedValue({ id: "1", name: "zeta", url: "u" });
    const user = userEvent.setup();
    render(<TagManagerApp />);

    await waitFor(() => expect(screen.getByText("alpha")).toBeInTheDocument());

    await user.dblClick(screen.getByText("alpha"));
    const input = screen.getByRole("textbox", { name: "Edit tag name" });
    await user.clear(input);
    await user.type(input, "zeta");
    await user.keyboard("[Enter]");

    await waitFor(() => {
      const beta = screen.getByText("beta");
      const zeta = screen.getByText("zeta");
      expect(beta.compareDocumentPosition(zeta) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });
  });
});

const renameAlpha = async (to: string) => {
  const user = userEvent.setup();
  await waitFor(() => expect(screen.getByText("alpha")).toBeInTheDocument());
  await user.dblClick(screen.getByText("alpha"));
  const input = screen.getByRole("textbox", { name: "Edit tag name" });
  await user.clear(input);
  await user.type(input, to);
  return { user, input };
};

describe("TagManagerApp — rename feedback", () => {
  it("confirms a rename with a toast that says it applied to every work item", async () => {
    render(<TagManagerApp />);
    const { user } = await renameAlpha("renamed-tag");

    await user.keyboard("[Enter]");

    expect(await screen.findByText(/Renamed “alpha” to “renamed-tag” on every work item that used it\./)).toBeInTheDocument();
  });

  it("says how many work items the tag was on when that was last counted", async () => {
    mockTagCountCacheService.getCache.mockResolvedValue({
      counts: { alpha: 38, beta: 1 },
      lastUpdated: new Date().toISOString(),
    });
    render(<TagManagerApp />);
    const { user } = await renameAlpha("renamed-tag");

    await user.keyboard("[Enter]");

    expect(
      await screen.findByText("Renamed “alpha” to “renamed-tag” on every work item that used it (38 work items when last counted).")
    ).toBeInTheDocument();
  });

  it("uses the singular for a tag on one work item", async () => {
    mockTagCountCacheService.getCache.mockResolvedValue({
      counts: { alpha: 1 },
      lastUpdated: new Date().toISOString(),
    });
    render(<TagManagerApp />);
    const { user } = await renameAlpha("renamed-tag");

    await user.keyboard("[Enter]");

    expect(await screen.findByText(/\(1 work item when last counted\)/)).toBeInTheDocument();
  });

  it("does not call the service, or toast, when the name is unchanged", async () => {
    render(<TagManagerApp />);
    const { user } = await renameAlpha("alpha");

    await user.keyboard("[Enter]");

    expect(mockTagService.renameTagById).not.toHaveBeenCalled();
    expect(screen.queryByText(/Renamed/)).not.toBeInTheDocument();
  });

  it("does not rename when focus leaves the field", async () => {
    render(<TagManagerApp />);
    const { user } = await renameAlpha("renamed-tag");

    await user.click(screen.getByPlaceholderText("Search tags…"));

    expect(mockTagService.renameTagById).not.toHaveBeenCalled();
    expect(screen.getByText("alpha")).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Edit tag name" })).not.toBeInTheDocument();
  });
});

describe("TagManagerApp — rename failure", () => {
  it("leaves the original tag name in the list when rename fails", async () => {
    mockTagService.renameTagById.mockRejectedValue(new Error("permission denied"));
    render(<TagManagerApp />);
    const { user } = await renameAlpha("new-name");

    await user.keyboard("[Enter]");
    await screen.findByRole("alert");
    expect(mockTagService.renameTagById).toHaveBeenCalled();

    // Abandoning the edit shows the tag as it still is: nothing was renamed.
    await user.keyboard("[Escape]");

    expect(screen.getByText("alpha")).toBeInTheDocument();
    expect(screen.queryByText("new-name")).not.toBeInTheDocument();
  });

  it("keeps the editor open with what was typed, and says why beside the field", async () => {
    mockTagService.renameTagById.mockRejectedValue(new Error("permission denied"));
    render(<TagManagerApp />);
    const { user } = await renameAlpha("new-name");

    await user.keyboard("[Enter]");

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Couldn't rename “alpha”: permission denied");
    expect(screen.getByRole("textbox", { name: "Edit tag name" })).toHaveValue("new-name");
    expect(screen.getByRole("textbox", { name: "Edit tag name" })).toHaveFocus();
  });

  it("says it once, not in the editor and again in a page banner", async () => {
    mockTagService.renameTagById.mockRejectedValue(new Error("permission denied"));
    render(<TagManagerApp />);
    const { user } = await renameAlpha("new-name");

    await user.keyboard("[Enter]");

    await screen.findByRole("alert");
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(screen.queryByText("Dismiss")).not.toBeInTheDocument();
  });

  it("lets the user retry the same name after a failure", async () => {
    mockTagService.renameTagById
      .mockRejectedValueOnce(new Error("temporarily unavailable"))
      .mockResolvedValueOnce({ id: "1", name: "new-name", url: "u" });
    render(<TagManagerApp />);
    const { user } = await renameAlpha("new-name");

    await user.keyboard("[Enter]");
    await screen.findByRole("alert");
    await user.keyboard("[Enter]");

    await waitFor(() => expect(screen.getByText("new-name")).toBeInTheDocument());
    expect(mockTagService.renameTagById).toHaveBeenCalledTimes(2);
  });
});
