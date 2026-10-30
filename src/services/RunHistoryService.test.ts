import { RunHistoryService } from "./RunHistoryService";
import { mockExtensionDataManager, setMockProject } from "../test/mocks/azureDevopsSdkMock";

const source = { id: "old", name: "Old", url: "" };

it("keeps independently recorded runs without lost updates and groups them by stable project", async () => {
  const history = new RunHistoryService();
  const [first, second] = await Promise.all([
    history.begin("merge", [source], "Keep"),
    new RunHistoryService().begin("rename", [source], "New"),
  ]);
  expect(first.run.id).not.toBe(second.run.id);
  await Promise.all([
    first.card(101, { source: "Old", before: ["Old"], after: ["Keep"], outcome: "changed", verification: "confirmed" }),
    second.card(102, { source: "Old", before: ["Old"], after: ["New"], outcome: "changed", verification: "observed" }),
  ]);
  await Promise.all([first.finish("completed"), second.finish("completed")]);
  expect((await history.list()).map((run) => run.id).sort()).toEqual([first.run.id, second.run.id].sort());
  expect((await history.read(first.run.id)).cards[0].changes[0].after).toEqual(["Keep"]);
  setMockProject("Other project");
  expect(await history.list()).toEqual([]);
});

it("hides and cleans up history exactly 90 days after the run started", async () => {
  const history = new RunHistoryService();
  const run = await history.begin("delete", [source]);
  await run.card(101, { source: "Old", before: ["Old"], after: [], outcome: "changed", verification: "observed" });
  await run.finish("completed");
  expect(Date.parse(run.run.expiresAt) - Date.parse(run.run.startedAt)).toBe(90 * 24 * 60 * 60 * 1000);
  const clock = jest.spyOn(Date, "now");
  clock.mockReturnValue(Date.parse(run.run.expiresAt) - 1);
  expect(await history.list()).toHaveLength(1);
  clock.mockReturnValue(Date.parse(run.run.expiresAt));
  await expect(history.read(run.run.id)).rejects.toThrow("expired");
  expect(await history.list()).toEqual([]);
  await expect(history.read(run.run.id)).rejects.toThrow("Document not found");
});

it("preserves the last saved unknown outcome if saving a confirmed result fails", async () => {
  const history = new RunHistoryService();
  const run = await history.begin("merge", [source], "Keep");
  await run.card(101, { source: "Old", before: ["Old"], after: null, outcome: "unknown", verification: "unverified" });
  mockExtensionDataManager.updateDocument.mockRejectedValue(new Error("ETag conflict"));
  await expect(run.card(101, {
    source: "Old", before: ["Old"], after: ["Keep"], outcome: "changed", verification: "confirmed",
  })).rejects.toThrow("Run recording failed");
  const saved = await history.read(run.run.id);
  expect(saved.cards[0].changes[0].outcome).toBe("unknown");
  expect(run.report().unsaved).toBe(true);
  expect(run.report().cards[0].changes[0].after).toEqual(["Keep"]);
});

it("rejects oversized metadata instead of truncating the report", async () => {
  const history = new RunHistoryService();
  await expect(history.begin("rename", [{ ...source, name: "a".repeat(40000) }], "New"))
    .rejects.toThrow("32 KiB safety limit");
  expect(await history.list()).toEqual([]);
});

it("refuses a potentially truncated collection at the documented retrieval ceiling", async () => {
  mockExtensionDataManager.getDocuments.mockResolvedValue(new Array(100000));
  await expect(new RunHistoryService().list()).rejects.toThrow("cannot be read completely");
});

it("treats a nonexistent collection as empty but surfaces other storage errors", async () => {
  mockExtensionDataManager.getDocuments.mockRejectedValueOnce({ status: 404 });
  expect(await new RunHistoryService().list()).toEqual([]);
  mockExtensionDataManager.getDocuments.mockRejectedValue(new Error("Forbidden"));
  await expect(new RunHistoryService().list()).rejects.toThrow("Forbidden");
});

it("allows concurrent expiry cleanup when another reader already removed the same document", async () => {
  const history = new RunHistoryService();
  const run = await history.begin("delete", [source]);
  await run.card(101, { source: "Old", before: ["Old"], after: [], outcome: "changed", verification: "observed" });
  jest.spyOn(Date, "now").mockReturnValue(Date.parse(run.run.expiresAt));
  const remove = mockExtensionDataManager.deleteDocument.getMockImplementation()!;
  mockExtensionDataManager.deleteDocument.mockImplementation(async (collection: string, id: string) => {
    await remove(collection, id);
    throw { status: 404 };
  });
  await expect(history.list()).resolves.toEqual([]);
});
