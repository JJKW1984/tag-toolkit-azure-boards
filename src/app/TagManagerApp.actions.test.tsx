import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const mockTagService = {
  getWorkItemsWithTag: jest.fn(),
  readWorkItemTags: jest.fn(),
  getAllTags: jest.fn(),
  deleteTagById: jest.fn(),
  renameTagById: jest.fn(),
  mergeTags: jest.fn(),
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

const tag = (id: string, name: string) => ({ id, name, url: "u" });

/** A promise the test settles by hand, to observe the app mid-operation. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function renderAndSelect(names: string[]) {
  render(<TagManagerApp />);
  await screen.findByText(names[0]);
  names.forEach((name) =>
    fireEvent.click(screen.getByRole("checkbox", { name: `Select ${name}` }))
  );
}

describe("TagManagerApp — delete feedback", () => {
  beforeEach(() => {
    Object.values(mockTagService).forEach((fn) => fn.mockReset());
    mockTagService.getWorkItemsWithTag.mockResolvedValue([]);
    mockTagService.readWorkItemTags.mockResolvedValue(new Map());
    Object.values(mockTagCountCacheService).forEach((fn) => fn.mockReset());
    mockTagCountCacheService.getCache.mockResolvedValue(null);
    mockTagCountCacheService.shouldAutoRefresh.mockResolvedValue(false);
    mockTagService.getAllTags.mockResolvedValue([tag("1", "alpha"), tag("2", "beta"), tag("3", "gamma")]);
  });

  it("confirms a delete with a toast once the dialog has closed", async () => {
    mockTagService.deleteTagById.mockResolvedValue(undefined);
    await renderAndSelect(["alpha", "beta"]);

    fireEvent.click(screen.getByRole("button", { name: /^Delete/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Delete 2 tags" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Deleted 2 tags.");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("keeps the dialog open with progress while tags are being deleted", async () => {
    const first = deferred<void>();
    mockTagService.deleteTagById.mockReturnValueOnce(first.promise).mockResolvedValue(undefined);
    await renderAndSelect(["alpha", "beta"]);

    fireEvent.click(screen.getByRole("button", { name: /^Delete/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Delete 2 tags" }));

    const working = await screen.findByRole("button", { name: "Deleting 0 of 2…" });
    expect(working).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();

    first.resolve();
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("reports every failure with a sanitized reason and keeps failed tags selected", async () => {
    mockTagService.deleteTagById
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("Forbidden: https://dev.azure.com/secret-org/_apis/wit/tags/2"))
      .mockRejectedValueOnce(new Error("Gone"));
    await renderAndSelect(["alpha", "beta", "gamma"]);

    fireEvent.click(screen.getByRole("button", { name: /^Delete/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Delete 3 tags" }));

    const message = await screen.findByText(/Couldn't delete 2 tags/);
    expect(message).toHaveTextContent("beta (Forbidden: [redacted-url])");
    expect(message).toHaveTextContent("gamma (Gone)");
    expect(message).not.toHaveTextContent("secret-org");
    expect(message).toHaveTextContent("still selected");

    expect(screen.getByRole("alert")).toHaveTextContent("Deleted 1 tag.");
    expect(screen.queryByText("alpha")).not.toBeInTheDocument();
    expect(screen.getByTestId("selection-status")).toHaveTextContent("2 tags selected");
  });

  it("dismisses the toast from its action", async () => {
    mockTagService.deleteTagById.mockResolvedValue(undefined);
    await renderAndSelect(["alpha"]);

    fireEvent.click(screen.getByRole("button", { name: /^Delete/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Delete 1 tag" }));
    await screen.findByRole("alert");

    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));

    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
  });
});

describe("TagManagerApp — merge feedback", () => {
  beforeEach(() => {
    Object.values(mockTagService).forEach((fn) => fn.mockReset());
    Object.values(mockTagCountCacheService).forEach((fn) => fn.mockReset());
    mockTagCountCacheService.getCache.mockResolvedValue(null);
    mockTagCountCacheService.shouldAutoRefresh.mockResolvedValue(false);
    mockTagService.getAllTags.mockResolvedValue([tag("1", "alpha"), tag("2", "beta")]);
  });

  const openMergeInto = async (target: string) => {
    fireEvent.click(screen.getByRole("button", { name: /^Merge/ }));
    await screen.findByRole("dialog");
    fireEvent.change(screen.getByPlaceholderText("Type to search or create a tag"), {
      target: { value: target },
    });
    fireEvent.click(screen.getByRole("button", { name: "Merge" }));
  };

  it("confirms a merge with what changed and that counts are now out of date", async () => {
    mockTagService.mergeTags.mockResolvedValue({
      succeeded: [{ source: tag("2", "beta"), affectedCount: 5, workItemIds: [1, 2, 3, 4, 5] }],
      failed: [],
    });
    await renderAndSelect(["alpha", "beta"]);

    await openMergeInto("alpha");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Merged 1 tag into “alpha”. Updated 5 work items. Source tags remain in the project catalog. Refresh counts to update the numbers."
    );
  });

  it("does not claim zero work items were re-tagged when the target was already on all of them", async () => {
    mockTagService.mergeTags.mockResolvedValue({
      succeeded: [{ source: tag("2", "beta"), affectedCount: 0, workItemIds: [] }],
      failed: [],
    });
    await renderAndSelect(["alpha", "beta"]);

    await openMergeInto("alpha");

    const toast = await screen.findByRole("alert");
    expect(toast).toHaveTextContent("Merged 1 tag into “alpha”.");
    expect(toast).not.toHaveTextContent("re-tagged");
  });

  it("keeps successfully merged source tags visible in the project catalog", async () => {
    mockTagService.mergeTags.mockResolvedValue({
      succeeded: [{ source: tag("2", "beta"), affectedCount: 1, workItemIds: [1] }],
      failed: [],
    });
    await renderAndSelect(["beta"]);
    const reload = deferred<ReturnType<typeof tag>[]>();
    mockTagService.getAllTags.mockReturnValueOnce(reload.promise);

    await openMergeInto("alpha");
    await screen.findByRole("alert");

    expect(screen.getByText("beta")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Source tags remain in the project catalog");
    reload.resolve([tag("1", "alpha"), tag("2", "beta")]);
    await waitFor(() => expect(mockTagService.getAllTags).toHaveBeenCalledTimes(2));
  });

  it("counts a work item updated for several sources only once", async () => {
    mockTagService.mergeTags.mockResolvedValue({
      succeeded: [
        { source: tag("1", "alpha"), affectedCount: 1, workItemIds: [1] },
        { source: tag("2", "beta"), affectedCount: 1, workItemIds: [1] },
      ],
      failed: [],
    });
    await renderAndSelect(["alpha", "beta"]);

    await openMergeInto("target");

    expect(await screen.findByRole("alert")).toHaveTextContent("Updated 1 work item.");
  });

  it("keeps the table on screen while it reloads after a merge", async () => {
    mockTagService.mergeTags.mockResolvedValue({
      succeeded: [{ source: tag("2", "beta"), affectedCount: 1, workItemIds: [1] }],
      failed: [],
    });
    await renderAndSelect(["alpha", "beta"]);
    const reload = deferred<ReturnType<typeof tag>[]>();
    mockTagService.getAllTags.mockReturnValueOnce(reload.promise);

    await openMergeInto("alpha");
    await screen.findByRole("alert");

    expect(screen.queryByText(/Loading tags/)).not.toBeInTheDocument();
    expect(screen.getByText("alpha")).toBeInTheDocument();

    reload.resolve([tag("1", "alpha")]);
    await waitFor(() => expect(mockTagService.getAllTags).toHaveBeenCalledTimes(2));
  });

  it("does not wipe the failure message when the list reloads, and re-selects failed tags", async () => {
    mockTagService.mergeTags.mockResolvedValue({
      succeeded: [],
      failed: [{ source: tag("2", "beta"), error: "Rate limited" }],
    });
    await renderAndSelect(["alpha", "beta"]);

    await openMergeInto("alpha");

    const message = await screen.findByText(/Couldn't merge 1 tag into “alpha”/);
    expect(message).toHaveTextContent("beta (Rate limited)");
    expect(message).toHaveTextContent("still selected");
    await waitFor(() =>
      expect(screen.getByTestId("selection-status")).toHaveTextContent("1 tag selected")
    );
    expect(screen.getByText(/Couldn't merge 1 tag/)).toBeInTheDocument();
  });

  it("keeps tags selected during the reload after a merge, dropping only ones that are gone", async () => {
    mockTagService.getAllTags.mockResolvedValue([tag("1", "alpha"), tag("2", "beta"), tag("3", "gamma")]);
    mockTagService.mergeTags.mockResolvedValue({
      succeeded: [{ source: tag("2", "beta"), affectedCount: 1, workItemIds: [1] }],
      failed: [],
    });
    await renderAndSelect(["beta"]);
    const reload = deferred<ReturnType<typeof tag>[]>();
    mockTagService.getAllTags.mockReturnValueOnce(reload.promise);

    await openMergeInto("alpha");
    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("checkbox", { name: "Select gamma" }));
    reload.resolve([tag("1", "alpha"), tag("3", "gamma")]);

    await waitFor(() => expect(mockTagService.getAllTags).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(screen.getByTestId("selection-status")).toHaveTextContent("1 tag selected")
    );
    expect(screen.getByRole("checkbox", { name: "Select gamma" })).toBeChecked();
  });

  it("keeps later selections alongside failed sources after a partial merge", async () => {
    mockTagService.getAllTags.mockResolvedValue([tag("1", "alpha"), tag("2", "beta"), tag("3", "gamma")]);
    mockTagService.mergeTags.mockResolvedValue({
      succeeded: [],
      failed: [{ source: tag("2", "beta"), error: "Rate limited" }],
    });
    await renderAndSelect(["beta"]);
    const reload = deferred<ReturnType<typeof tag>[]>();
    mockTagService.getAllTags.mockReturnValueOnce(reload.promise);

    await openMergeInto("alpha");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole("checkbox", { name: "Select gamma" }));
    reload.resolve([tag("1", "alpha"), tag("2", "beta"), tag("3", "gamma")]);

    await screen.findByText(/Couldn't merge 1 tag/);
    expect(screen.getByTestId("selection-status")).toHaveTextContent("2 tags selected");
  });

  it("does not close a dialog the user opened while the post-merge reload was pending", async () => {
    mockTagService.getAllTags.mockResolvedValue([tag("1", "alpha"), tag("2", "beta"), tag("3", "gamma")]);
    mockTagService.mergeTags.mockResolvedValue({
      succeeded: [{ source: tag("2", "beta"), affectedCount: 1, workItemIds: [1] }],
      failed: [],
    });
    await renderAndSelect(["beta"]);
    const reload = deferred<ReturnType<typeof tag>[]>();
    mockTagService.getAllTags.mockReturnValueOnce(reload.promise);

    await openMergeInto("alpha");
    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("checkbox", { name: "Select gamma" }));
    fireEvent.click(screen.getByRole("button", { name: /^Delete/ }));
    await screen.findByRole("dialog");

    reload.resolve([tag("1", "alpha"), tag("3", "gamma")]);
    await waitFor(() => expect(mockTagService.getAllTags).toHaveBeenCalledTimes(2));
    await screen.findByRole("checkbox", { name: "Select gamma" });

    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("closes the dialog and shows an error when the merge request itself throws", async () => {
    mockTagService.mergeTags.mockRejectedValue(new Error("Network down"));
    await renderAndSelect(["alpha", "beta"]);

    await openMergeInto("alpha");

    expect(await screen.findByText("Network down")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

describe("TagManagerApp — dialog counts timestamp", () => {
  beforeEach(() => {
    Object.values(mockTagService).forEach((fn) => fn.mockReset());
    Object.values(mockTagCountCacheService).forEach((fn) => fn.mockReset());
    mockTagCountCacheService.shouldAutoRefresh.mockResolvedValue(false);
    mockTagService.getAllTags.mockResolvedValue([tag("1", "alpha")]);
  });

  it("keeps the counts age the dialog opened with when a refresh finishes behind it", async () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    mockTagCountCacheService.getCache.mockResolvedValue({
      counts: { alpha: 7 },
      lastUpdated: twoHoursAgo,
    });
    mockTagCountCacheService.refreshCache.mockResolvedValue({
      counts: { alpha: 0 },
      lastUpdated: new Date().toISOString(),
    });
    await renderAndSelect(["alpha"]);

    fireEvent.click(screen.getByRole("button", { name: /^Delete/ }));
    await screen.findByRole("dialog");
    fireEvent.click(screen.getByRole("button", { name: "Refresh counts" }));
    await waitFor(() => expect(mockTagCountCacheService.refreshCache).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByRole("button", { name: "Refresh counts" })).toBeEnabled());

    expect(screen.getByTestId("tag-count-alpha")).toHaveTextContent("7");
    expect(screen.getByTestId("counts-note")).toHaveTextContent("counted 2 hours ago");
  });
});
