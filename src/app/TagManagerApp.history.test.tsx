import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { TagManagerApp } from "./TagManagerApp";
import { mockWorkItemTrackingClient } from "../test/mocks/azureDevopsApiMock";
import { mockExtensionDataManager } from "../test/mocks/azureDevopsSdkMock";
import * as SDKMocks from "../test/mocks/azureDevopsSdkMock";

const tags = [
  { id: "1", name: "Old", url: "" },
  { id: "2", name: "Keep", url: "" },
];

async function mergeOld() {
  await screen.findByText("Old");
  fireEvent.click(screen.getByRole("checkbox", { name: "Select Old" }));
  fireEvent.click(screen.getByRole("button", { name: /^Merge/ }));
  fireEvent.change(await screen.findByPlaceholderText("Type to search or create a tag"), {
    target: { value: "Keep" },
  });
  fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Merge" }));
}

beforeEach(() => {
  mockExtensionDataManager.getValue.mockImplementation(async (key: string) =>
    key === "orgTagCounts" ? { counts: {}, lastUpdated: new Date().toISOString() } : undefined);
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ value: tags }),
  });

  mockWorkItemTrackingClient.queryByWiql.mockResolvedValue({ workItems: [{ id: 101 }] });
  mockWorkItemTrackingClient.getWorkItemsBatch.mockResolvedValue([
    { id: 101, rev: 1, fields: { "System.Tags": "Old; Other" } },
  ]);
});

it("opens a merge report and retains its per-card evidence after remount", async () => {
  const app = render(<TagManagerApp />);
  await screen.findByText("Old");
  fireEvent.click(screen.getByRole("checkbox", { name: "Select Old" }));
  fireEvent.click(screen.getByRole("button", { name: /^Merge/ }));
  fireEvent.change(await screen.findByPlaceholderText("Type to search or create a tag"), {
    target: { value: "Keep" },
  });
  fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Merge" }));
  fireEvent.click(await screen.findByRole("button", { name: "View latest run" }));
  const report = await screen.findByRole("region", { name: "Run report" });
  expect(report).toHaveTextContent("Test User");
  expect(report).toHaveTextContent("confirmed");
  expect(within(report).getByRole("link", { name: "101" })).toHaveAttribute(
    "href", "https://dev.azure.com/demo-org/demo-project-id/_workitems/edit/101"
  );
  expect(report).toHaveTextContent("Other");
  expect(report).toHaveTextContent("Keep");
  app.unmount();
  render(<TagManagerApp />);
  fireEvent.click(await screen.findByRole("button", { name: "Run history" }));
  fireEvent.click(await screen.findByRole("button", { name: /^Open merge run/ }));
  expect(await screen.findByRole("region", { name: "Run report" })).toHaveTextContent("101");
});

it("records rename observations without claiming confirmed attribution", async () => {
  mockWorkItemTrackingClient.getWorkItemsBatch
    .mockResolvedValueOnce([{ id: 101, rev: 1, fields: { "System.Tags": "Old; Other" } }])
    .mockResolvedValueOnce([{ id: 101, rev: 2, fields: { "System.Tags": "New; Other; Concurrent" } }]);
  global.fetch = jest.fn().mockImplementation(async (_url: string, init?: RequestInit) => ({
    ok: true, json: async () => init?.method === "PATCH" ? { id: "1", name: "New", url: "" } : { value: tags },
  }));
  render(<TagManagerApp />);
  fireEvent.doubleClick(await screen.findByRole("button", { name: "Rename tag Old" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Edit tag name" }), { target: { value: "New" } });
  fireEvent.keyDown(screen.getByRole("textbox", { name: "Edit tag name" }), { key: "Enter" });
  fireEvent.click(await screen.findByRole("button", { name: "View latest run" }));
  const report = await screen.findByRole("region", { name: "Run report" });
  expect(report).toHaveTextContent("observed");
  expect(report).not.toHaveTextContent("confirmed");
  expect(report).toHaveTextContent("Concurrent");
});

it("reports a batch delete as one observed card row and discloses pull-request exclusions", async () => {
  mockWorkItemTrackingClient.getWorkItemsBatch
    .mockResolvedValueOnce([{ id: 101, rev: 1, fields: { "System.Tags": "Old; Keep; Other" } }])
    .mockResolvedValueOnce([{ id: 101, rev: 2, fields: { "System.Tags": "Keep; Other" } }])
    .mockResolvedValueOnce([{ id: 101, rev: 3, fields: { "System.Tags": "Other" } }]);
  render(<TagManagerApp />);
  await screen.findByText("Old");
  fireEvent.click(screen.getByRole("checkbox", { name: "Select Old" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "Select Keep" }));
  fireEvent.click(screen.getByRole("button", { name: /^Delete/ }));
  fireEvent.click(await screen.findByRole("button", { name: "Delete 2 tags" }));
  await screen.findByText("Deleted 2 tags.");
  fireEvent.click(screen.getByRole("button", { name: "View latest run" }));
  const report = await screen.findByRole("region", { name: "Run report" });
  expect(within(report).getAllByRole("link", { name: "101" })).toHaveLength(1);
  expect(report).toHaveTextContent("Pull-request effects are not enumerated.");
  expect(report).toHaveTextContent("observed");
  expect(report).toHaveTextContent("completed");
});

it("preserves partial merge success even when no entire source succeeds", async () => {
  mockWorkItemTrackingClient.queryByWiql.mockResolvedValue({ workItems: [{ id: 101 }, { id: 102 }] });
  mockWorkItemTrackingClient.getWorkItemsBatch.mockResolvedValue([
    { id: 101, rev: 1, fields: { "System.Tags": "Old" } },
    { id: 102, rev: 1, fields: { "System.Tags": "Old" } },
  ]);
  mockWorkItemTrackingClient.updateWorkItem.mockResolvedValueOnce({}).mockRejectedValue(new Error("Forbidden"));
  render(<TagManagerApp />);
  await mergeOld();
  await screen.findByText(/Couldn't merge 1 tag/);
  fireEvent.click(screen.getByRole("button", { name: "View latest run" }));
  const report = await screen.findByRole("region", { name: "Run report" });
  expect(report).toHaveTextContent("partial");
  expect(within(report).getByRole("link", { name: "101" }).closest("tr")).toHaveTextContent("confirmed");
  expect(within(report).getByRole("link", { name: "102" }).closest("tr")).toHaveTextContent("Forbidden");
});

it("disables other edit commands while a rename is capturing its baseline", async () => {
  mockWorkItemTrackingClient.queryByWiql.mockReturnValue(new Promise(() => {}));
  render(<TagManagerApp />);
  await screen.findByText("Old");
  fireEvent.click(screen.getByRole("checkbox", { name: "Select Old" }));
  fireEvent.doubleClick(screen.getByRole("button", { name: "Rename tag Old" }));
  const input = screen.getByRole("textbox", { name: "Edit tag name" });
  fireEvent.change(input, { target: { value: "New" } });
  fireEvent.keyDown(input, { key: "Enter" });
  await waitFor(() => expect(screen.getByRole("button", { name: /^Delete/ })).toBeDisabled());
});

it("blocks all merge edits if the initial run cannot be saved", async () => {
  mockExtensionDataManager.createDocument.mockRejectedValue(new Error("Storage unavailable"));
  render(<TagManagerApp />);
  await mergeOld();
  await screen.findByText("Storage unavailable");
  expect(mockWorkItemTrackingClient.updateWorkItem).not.toHaveBeenCalled();
});

it("stops further edits and exposes the unsaved confirmed result in recovery CSV", async () => {
  mockWorkItemTrackingClient.queryByWiql.mockResolvedValue({ workItems: [{ id: 101 }, { id: 102 }] });
  mockWorkItemTrackingClient.getWorkItemsBatch.mockResolvedValue([
    { id: 101, rev: 1, fields: { "System.Tags": "Old" } },
    { id: 102, rev: 1, fields: { "System.Tags": "Old" } },
  ]);
  const save = mockExtensionDataManager.updateDocument.getMockImplementation()!;
  mockExtensionDataManager.updateDocument.mockImplementation(async (collection: string, doc: { payload: string }) => {
    if (doc.payload.includes('"outcome":"changed"')) throw new Error("Write quota exceeded");
    return save(collection, doc);
  });
  render(<TagManagerApp />);
  await mergeOld();
  await screen.findByText(/Run recording failed: Write quota exceeded/);
  expect(mockWorkItemTrackingClient.updateWorkItem).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "View latest run" }));
  const report = await screen.findByRole("region", { name: "Run report" });
  expect(within(report).getByRole("link", { name: "101" }).closest("tr")).toHaveTextContent("confirmed");
  expect(within(report).getByRole("link", { name: "102" }).closest("tr")).toHaveTextContent("not attempted");
  expect(within(report).getByRole("button", { name: "Download recovery CSV" })).toBeEnabled();
});

it("blocks rename when the initial card snapshot fails", async () => {
  mockWorkItemTrackingClient.getWorkItemsBatch.mockRejectedValue(new Error("Snapshot forbidden"));
  render(<TagManagerApp />);
  fireEvent.doubleClick(await screen.findByRole("button", { name: "Rename tag Old" }));
  const input = screen.getByRole("textbox", { name: "Edit tag name" });
  fireEvent.change(input, { target: { value: "New" } });
  fireEvent.keyDown(input, { key: "Enter" });
  await screen.findByText(/Couldn't rename.*Snapshot forbidden/);
  expect(global.fetch).not.toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ method: "PATCH" }));
  fireEvent.click(screen.getByRole("button", { name: "View latest run" }));
  const report = await screen.findByRole("region", { name: "Run report" });
  expect(report).toHaveTextContent("failed");
  expect(report).toHaveTextContent("No card records captured");
});

it("marks rename results unverified when the post-edit read fails", async () => {
  mockWorkItemTrackingClient.getWorkItemsBatch
    .mockResolvedValueOnce([{ id: 101, rev: 1, fields: { "System.Tags": "Old" } }])
    .mockRejectedValue(new Error("Verification forbidden"));
  global.fetch = jest.fn().mockImplementation(async (_url: string, init?: RequestInit) => ({
    ok: true, json: async () => init?.method === "PATCH" ? { id: "1", name: "New", url: "" } : { value: tags },
  }));
  render(<TagManagerApp />);
  fireEvent.doubleClick(await screen.findByRole("button", { name: "Rename tag Old" }));
  const input = screen.getByRole("textbox", { name: "Edit tag name" });
  fireEvent.change(input, { target: { value: "New" } });
  fireEvent.keyDown(input, { key: "Enter" });
  await screen.findByRole("button", { name: "Rename tag New" });
  fireEvent.click(screen.getByRole("button", { name: "View latest run" }));
  const report = await screen.findByRole("region", { name: "Run report" });
  expect(report).toHaveTextContent("partial");
  expect(report).toHaveTextContent("unverified");
  expect(report).toHaveTextContent("Unknown");
  expect(report).not.toHaveTextContent("confirmed");
});

it("exports cards beyond the visible page and includes the run context", async () => {
  const ids = Array.from({ length: 26 }, (_, index) => 101 + index);
  mockWorkItemTrackingClient.queryByWiql.mockResolvedValue({ workItems: ids.map((id) => ({ id })) });
  mockWorkItemTrackingClient.getWorkItemsBatch.mockResolvedValue(
    ids.map((id) => ({ id, rev: 1, fields: { "System.Tags": 'Old; Unicode-雪; A,"quoted"' } }))
  );
  let exported: Blob | undefined;
  URL.createObjectURL = jest.fn((blob: Blob) => { exported = blob; return "blob:test"; });
  URL.revokeObjectURL = jest.fn();
  jest.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  render(<TagManagerApp />);
  await mergeOld();
  await screen.findByText(/Updated 26 work items/);
  fireEvent.click(screen.getByRole("button", { name: "View latest run" }));
  const report = await screen.findByRole("region", { name: "Run report" });
  expect(within(report).queryByRole("link", { name: "126" })).not.toBeInTheDocument();
  fireEvent.click(within(report).getByRole("button", { name: "Export run to CSV" }));
  const text = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(exported!);
  });
  expect(text).toContain('"126"');
  expect(text).toContain('"Test User"');
  expect(text).toContain('"confirmed"');
  expect(text).toContain("Unicode-雪");
  expect(text).toContain('A,\\""quoted\\""');
});

it("reports the successful retry baseline without attributing another user's added tag", async () => {
  mockWorkItemTrackingClient.getWorkItemsBatch
    .mockResolvedValueOnce([{ id: 101, rev: 1, fields: { "System.Tags": "Old" } }])
    .mockResolvedValueOnce([{ id: 101, rev: 2, fields: { "System.Tags": "Old; Added by someone else" } }]);
  mockWorkItemTrackingClient.updateWorkItem.mockRejectedValueOnce(new Error("Revision conflict")).mockResolvedValue({});
  render(<TagManagerApp />);
  await mergeOld();
  await screen.findByText(/Updated 1 work item/);
  fireEvent.click(screen.getByRole("button", { name: "View latest run" }));
  const report = await screen.findByRole("region", { name: "Run report" });
  const row = within(report).getByRole("link", { name: "101" }).closest("tr")!;
  const cells = within(row).getAllByRole("cell");
  expect(cells[1]).toHaveTextContent("Old; Added by someone else");
  expect(cells[2]).toHaveTextContent("Added by someone else; Keep");
  expect(cells[3]).toHaveTextContent("Keep");
  expect(cells[3]).not.toHaveTextContent("Added by someone else");
});

it("describes inactivity as possible interruption, never definitive abandonment", async () => {
  mockWorkItemTrackingClient.queryByWiql.mockReturnValue(new Promise(() => {}));
  const app = render(<TagManagerApp />);
  await mergeOld();
  fireEvent.click(await screen.findByRole("button", { name: "View latest run" }));
  const report = await screen.findByRole("region", { name: "Run report" });
  expect(report).toHaveTextContent("running");
  app.unmount();
  jest.spyOn(Date, "now").mockReturnValue(Date.now() + 6 * 60 * 1000);
  render(<TagManagerApp />);
  fireEvent.click(await screen.findByRole("button", { name: "Run history" }));
  fireEvent.click(await screen.findByRole("button", { name: /^Open merge run/ }));
  expect(await screen.findByRole("region", { name: "Run report" })).toHaveTextContent("may still be running");
  expect(mockWorkItemTrackingClient.updateWorkItem).not.toHaveBeenCalled();
});

it("keeps an ambiguous merge attempt when the PATCH commits but its response is lost", async () => {
  mockWorkItemTrackingClient.getWorkItemsBatch
    .mockResolvedValueOnce([{ id: 101, rev: 1, fields: { "System.Tags": "Old" } }])
    .mockResolvedValueOnce([{ id: 101, rev: 2, fields: { "System.Tags": "Keep" } }]);
  mockWorkItemTrackingClient.updateWorkItem.mockRejectedValue(new Error("Response lost"));
  render(<TagManagerApp />);
  await mergeOld();
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  fireEvent.click(screen.getByRole("button", { name: "View latest run" }));
  const report = await screen.findByRole("region", { name: "Run report" });
  const row = within(report).getByRole("link", { name: "101" }).closest("tr")!;
  expect(row).toHaveTextContent("Response lost");
  expect(row).toHaveTextContent("unknown");
  expect(row).not.toHaveTextContent("confirmed");
  expect(report).toHaveTextContent("partial");
});

it("retains earlier snapshot batches when a later batch fails without issuing a rename", async () => {
  const ids = Array.from({ length: 201 }, (_, index) => index + 1);
  mockWorkItemTrackingClient.queryByWiql.mockResolvedValue({ workItems: ids.map((id) => ({ id })) });
  mockWorkItemTrackingClient.getWorkItemsBatch
    .mockResolvedValueOnce(ids.slice(0, 200).map((id) => ({ id, rev: 1, fields: { "System.Tags": "Old" } })))
    .mockRejectedValueOnce(new Error("Second batch unreadable"));
  render(<TagManagerApp />);
  fireEvent.doubleClick(await screen.findByRole("button", { name: "Rename tag Old" }));
  const input = screen.getByRole("textbox", { name: "Edit tag name" });
  fireEvent.change(input, { target: { value: "New" } });
  fireEvent.keyDown(input, { key: "Enter" });
  await screen.findByText(/Couldn't rename.*Second batch unreadable/, {}, { timeout: 10000 });
  fireEvent.click(screen.getByRole("button", { name: "View latest run" }));
  const report = await screen.findByRole("region", { name: "Run report" });
  expect(report).toHaveTextContent("Card page 1 of 8");
  expect(report).toHaveTextContent("not attempted");
  expect(global.fetch).not.toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ method: "PATCH" }));
});

it("exports zero-card context and neutralizes formula-like user names", async () => {
  jest.spyOn(SDKMocks, "getUser").mockReturnValue({ id: "user-id", name: "tester", displayName: "=SUM(1,1)" });
  mockWorkItemTrackingClient.queryByWiql.mockResolvedValue({ workItems: [] });
  let exported: Blob | undefined;
  URL.createObjectURL = jest.fn((blob: Blob) => { exported = blob; return "blob:test"; });
  URL.revokeObjectURL = jest.fn();
  jest.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  render(<TagManagerApp />);
  await mergeOld();
  await screen.findByText(/Merged 1 tag/);
  fireEvent.click(screen.getByRole("button", { name: "View latest run" }));
  const report = await screen.findByRole("region", { name: "Run report" });
  fireEvent.click(within(report).getByRole("button", { name: "Export run to CSV" }));
  const text = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(exported!);
  });
  expect(text).toContain('"\'=SUM(1,1)"');
  expect(text).toContain('"completed"');
  expect(text).toContain("No card records captured");
  expect(text).toContain('"Demo Project"');
});
