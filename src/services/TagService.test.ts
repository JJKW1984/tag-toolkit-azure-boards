import { TagService } from "./TagService";

import { mockWorkItemTrackingClient } from "../test/mocks/azureDevopsApiMock";
import { setMockProject } from "../test/mocks/azureDevopsSdkMock";

type MockResponse = {
  ok: boolean;
  status: number;
  statusText: string;
  json: () => Promise<unknown>;
  text: () => Promise<string>;
};

function createJsonResponse(payload: unknown): MockResponse {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  };
}

function createDeleteResponse(): MockResponse {
  return {
    ok: true,
    status: 204,
    statusText: "No Content",
    json: async () => undefined,
    text: async () => "",
  };
}

describe("TagService", () => {
  const fetchMock = jest.fn();

  beforeEach(() => {
    setMockProject("Demo Project");
    fetchMock.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  it("loads and sorts tags by name", async () => {
    fetchMock.mockResolvedValue(
      createJsonResponse({
        value: [
          { id: "2", name: "zeta", url: "u2" },
          { id: "1", name: "alpha", url: "u1" },
        ],
      })
    );

    const service = new TagService();
    const result = await service.getAllTags();

    expect(result.map((t) => t.name)).toEqual(["alpha", "zeta"]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: "GET" });
  });

  it("deletes a tag by id", async () => {
    fetchMock.mockResolvedValue(createDeleteResponse());

    const service = new TagService();
    await service.deleteTagById("tag-1");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: "DELETE" });
  });

  it("renames a tag by id", async () => {
    fetchMock.mockResolvedValue(
      createJsonResponse({ id: "tag-1", name: "backend", url: "u" })
    );

    const service = new TagService();
    const result = await service.renameTagById("tag-1", "backend");

    expect(result.name).toBe("backend");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: "PATCH" });
  });

  it("returns work item ids that contain a tag", async () => {
    mockWorkItemTrackingClient.queryByWiql.mockResolvedValue({
      workItems: [{ id: 100 }, { id: 101 }],
    });

    const service = new TagService();
    const ids = await service.getWorkItemsWithTag("ops");

    expect(ids).toEqual([100, 101]);
  });

  it("replaces the source per work item without deleting the project tag", async () => {
    mockWorkItemTrackingClient.queryByWiql.mockResolvedValue({
      workItems: [{ id: 10 }, { id: 11 }],
    });
    mockWorkItemTrackingClient.getWorkItemsBatch.mockResolvedValue([
      { id: 10, rev: 1, fields: { "System.Tags": "Old; Alpha" } },
      { id: 11, rev: 1, fields: { "System.Tags": "old; New" } },
    ]);
    mockWorkItemTrackingClient.updateWorkItem.mockResolvedValue({});
    fetchMock.mockResolvedValue(createDeleteResponse());

    const service = new TagService();
    const source = { id: "old-id", name: "Old", url: "u" };
    const result = await service.mergeTag(source.id, source.name, "New");

    expect(result.affectedCount).toBe(2);
    expect(result.workItemIds).toEqual([10, 11]);
    expect(mockWorkItemTrackingClient.updateWorkItem).toHaveBeenCalledTimes(2);

    const patchOps = mockWorkItemTrackingClient.updateWorkItem.mock.calls[0][0] as Array<{
      path: string;
      value: string | number;
    }>;
    const tagValue = String(patchOps.find((op) => op.path === "/fields/System.Tags")?.value).toLowerCase();
    expect(tagValue).not.toContain("old");
    expect(tagValue).toContain("alpha");
    expect(tagValue).toContain("new");

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("updates every source without any project-wide deletion", async () => {
    const order: string[] = [];
    mockWorkItemTrackingClient.queryByWiql
      .mockResolvedValueOnce({ workItems: [{ id: 1 }] })
      .mockResolvedValueOnce({ workItems: [{ id: 2 }] });
    mockWorkItemTrackingClient.getWorkItemsBatch
      .mockResolvedValueOnce([{ id: 1, rev: 1, fields: { "System.Tags": "A" } }])
      .mockResolvedValueOnce([{ id: 2, rev: 1, fields: { "System.Tags": "B" } }]);
    mockWorkItemTrackingClient.updateWorkItem.mockImplementation(async () => {
      order.push("update");
      return {};
    });
    fetchMock.mockImplementation(async () => {
      order.push("delete");
      return createDeleteResponse();
    });

    const service = new TagService();
    await service.mergeTags(
      [
        { id: "a", name: "A", url: "u" },
        { id: "b", name: "B", url: "u" },
      ],
      "Target"
    );

    expect(order).toEqual(["update", "update"]);
  });

  it("reports failed sources independently without globally deleting successful sources", async () => {
    mockWorkItemTrackingClient.queryByWiql
      .mockResolvedValueOnce({ workItems: [{ id: 1 }] })
      .mockResolvedValueOnce({ workItems: [{ id: 2 }] });
    mockWorkItemTrackingClient.getWorkItemsBatch
      .mockResolvedValueOnce([{ id: 1, rev: 1, fields: { "System.Tags": "A" } }])
      .mockResolvedValue([{ id: 2, rev: 1, fields: { "System.Tags": "B" } }]);
    mockWorkItemTrackingClient.updateWorkItem.mockImplementation(async (_ops, id) => {
      if (id === 2) throw new Error("patch failed");
      return {};
    });
    fetchMock.mockResolvedValue(createDeleteResponse());

    const service = new TagService();
    const res = await service.mergeTags(
      [
        { id: "a", name: "A", url: "u" },
        { id: "b", name: "B", url: "u" },
      ],
      "Target"
    );

    expect(res.succeeded.map((s) => s.source.id)).toEqual(["a"]);
    expect(res.failed.map((f) => f.source.id)).toEqual(["b"]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("preserves source tags added to other items after enumeration", async () => {
    const items = new Map<number, string>([[1, "Old; Alpha"]]);
    mockWorkItemTrackingClient.queryByWiql.mockResolvedValue({ workItems: [{ id: 1 }] });
    mockWorkItemTrackingClient.getWorkItemsBatch.mockImplementation(async () => {
      items.set(2, "Old");
      return [{ id: 1, rev: 1, fields: { "System.Tags": items.get(1) } }];
    });
    mockWorkItemTrackingClient.updateWorkItem.mockImplementation(async (document, id) => {
      const ops = document as Array<{ path: string; value: string | number }>;
      items.set(id, String(ops.find((op) => op.path === "/fields/System.Tags")?.value));
      return {};
    });
    fetchMock.mockImplementation(async () => {
      for (const [id, tags] of items) items.set(id, tags.replace(/Old;? ?/g, ""));
      return createDeleteResponse();
    });

    const result = await new TagService().mergeTags([{ id: "old-id", name: "Old", url: "u" }], "New");

    expect(result.failed).toEqual([]);
    expect(items.get(1)).toBe("Alpha; New");
    expect(items.get(2)).toBe("Old");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not modify substring matches that do not carry the source tag", async () => {
    mockWorkItemTrackingClient.queryByWiql.mockResolvedValue({ workItems: [{ id: 1 }] });
    mockWorkItemTrackingClient.getWorkItemsBatch.mockResolvedValue([
      { id: 1, rev: 1, fields: { "System.Tags": "Older; Alpha" } },
    ]);

    const result = await new TagService().mergeTags([{ id: "old-id", name: "Old", url: "u" }], "New");

    expect(result.failed).toEqual([]);
    expect(result.succeeded[0].affectedCount).toBe(0);
    expect(mockWorkItemTrackingClient.updateWorkItem).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not merge a tag into itself", async () => {
    const result = await new TagService().mergeTags([{ id: "old-id", name: "Old", url: "u" }], "old");

    expect(result).toEqual({ succeeded: [], failed: [] });
    expect(mockWorkItemTrackingClient.queryByWiql).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not patch work items when transformed tag set is unchanged", async () => {
    const service = new TagService();

    mockWorkItemTrackingClient.getWorkItemsBatch.mockResolvedValue([
      { id: 1, rev: 1, fields: { "System.Tags": "A; B" } },
    ]);

    const result = await (service as unknown as {
      applyTagUpdate: (
        ids: number[],
        transform: (tags: string[]) => string[]
      ) => Promise<{ affectedCount: number; workItemIds: number[] }>;
    }).applyTagUpdate([1], (tags) => [...tags].reverse());

    expect(result).toEqual({ affectedCount: 0, workItemIds: [] });
    expect(mockWorkItemTrackingClient.updateWorkItem).not.toHaveBeenCalled();
  });

  it("loads work items in batches of 200 for updates", async () => {
    const ids = Array.from({ length: 205 }, (_v, i) => i + 1);
    const service = new TagService();

    mockWorkItemTrackingClient.getWorkItemsBatch.mockImplementation(
      async (request: unknown) =>
        (request as { ids: number[] }).ids.map((id) => ({
          id,
          rev: 1,
          fields: { "System.Tags": "" },
        }))
    );

    await (service as unknown as {
      applyTagUpdate: (
        workItemIds: number[],
        transform: (tags: string[]) => string[]
      ) => Promise<unknown>;
    }).applyTagUpdate(ids, () => ["X"]);

    expect(mockWorkItemTrackingClient.getWorkItemsBatch).toHaveBeenCalledTimes(2);
    expect(mockWorkItemTrackingClient.updateWorkItem).toHaveBeenCalledTimes(205);
  });

  it("throws when project context is unavailable", async () => {
    setMockProject(null);

    const service = new TagService();

    await expect(service.getProjectName()).rejects.toThrow(
      "No project context available"
    );
  });

  describe("concurrent work-item edits", () => {
    type PatchOperation = { op: string; path: string; value: string | number };
    const source = { id: "old-id", name: "Old", url: "u" };

    it.each([
      ["addition", "Old; Alpha; Concurrent", "Alpha; Concurrent; New"],
      ["removal", "Old", "New"],
      ["source removal", "Alpha", "Alpha"],
    ])("preserves a concurrent tag %s when retrying a revision conflict", async (_kind, concurrent, expected) => {
      let current = { rev: 1, tags: "Old; Alpha" };
      mockWorkItemTrackingClient.queryByWiql.mockResolvedValue({ workItems: [{ id: 1 }] });
      mockWorkItemTrackingClient.getWorkItemsBatch.mockImplementation(async () => [
        { id: 1, rev: current.rev, fields: { "System.Tags": current.tags } },
      ]);
      let changed = false;
      mockWorkItemTrackingClient.updateWorkItem.mockImplementation(async (document) => {
        if (!changed) {
          changed = true;
          current = { rev: 2, tags: concurrent };
        }
        const ops = document as PatchOperation[];
        const revision = ops.find((op) => op.op === "test" && op.path === "/rev");
        if (revision && revision.value !== current.rev) throw new Error("revision conflict");
        current.tags = String(ops.find((op) => op.path === "/fields/System.Tags")?.value);
        current.rev++;
        return {};
      });
      fetchMock.mockResolvedValue(createDeleteResponse());

      const result = await new TagService().mergeTags([source], "New");

      expect(result.failed).toEqual([]);
      expect(current.tags).toBe(expected);
      expect(result.succeeded[0].workItemIds).toEqual(_kind === "source removal" ? [] : [1]);
    });

    it("stops after three conflict retries and leaves the source available", async () => {
      let rev = 1;
      mockWorkItemTrackingClient.queryByWiql.mockResolvedValue({ workItems: [{ id: 1 }] });
      mockWorkItemTrackingClient.getWorkItemsBatch.mockImplementation(async () => [
        { id: 1, rev, fields: { "System.Tags": "Old" } },
      ]);
      mockWorkItemTrackingClient.updateWorkItem.mockImplementation(async () => {
        rev++;
        throw new Error("revision conflict");
      });

      const result = await new TagService().mergeTags([source], "New");

      expect(result.succeeded).toEqual([]);
      expect(result.failed).toEqual([{ source, error: "revision conflict" }]);
      expect(mockWorkItemTrackingClient.updateWorkItem).toHaveBeenCalledTimes(4);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("does not retry a failed patch when the revision has not changed", async () => {
      mockWorkItemTrackingClient.queryByWiql.mockResolvedValue({ workItems: [{ id: 1 }] });
      mockWorkItemTrackingClient.getWorkItemsBatch.mockResolvedValue([
        { id: 1, rev: 1, fields: { "System.Tags": "Old" } },
      ]);
      mockWorkItemTrackingClient.updateWorkItem.mockRejectedValue(new Error("permission denied"));

      const result = await new TagService().mergeTags([source], "New");

      expect(result.failed).toEqual([{ source, error: "permission denied" }]);
      expect(mockWorkItemTrackingClient.updateWorkItem).toHaveBeenCalledTimes(1);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("does not delete the source when a returned work item lacks a revision", async () => {
      mockWorkItemTrackingClient.queryByWiql.mockResolvedValue({ workItems: [{ id: 1 }] });
      mockWorkItemTrackingClient.getWorkItemsBatch.mockResolvedValue([
        { id: 1, fields: { "System.Tags": "Old" } },
      ]);
      fetchMock.mockResolvedValue(createDeleteResponse());

      const result = await new TagService().mergeTags([source], "New");

      expect(result.succeeded).toEqual([]);
      expect(result.failed[0].error).toMatch(/revision/i);
      expect(mockWorkItemTrackingClient.updateWorkItem).not.toHaveBeenCalled();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("does not delete the source when an enumerated work item is missing from the batch", async () => {
      mockWorkItemTrackingClient.queryByWiql.mockResolvedValue({ workItems: [{ id: 1 }] });
      mockWorkItemTrackingClient.getWorkItemsBatch.mockResolvedValue([]);
      fetchMock.mockResolvedValue(createDeleteResponse());

      const result = await new TagService().mergeTags([source], "New");

      expect(result.succeeded).toEqual([]);
      expect(result.failed[0].error).toMatch(/work item 1/i);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });
});
