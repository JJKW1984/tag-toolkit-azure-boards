// live-test/adoClient.test.ts
import { AdoClient, orgNameFromUrl } from "./adoClient";
import { isNotFound, NotFoundError } from "./errors";

function response(body: unknown, status: number, contentType: string): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: "",
    headers: { get: (name: string) => (name === "content-type" ? contentType : null) },
    json: async () => body,
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
  } as unknown as Response;
}

function jsonResponse(body: unknown, status = 200): Response {
  return response(body, status, "application/json; charset=utf-8");
}

function newClient(): AdoClient {
  return new AdoClient({
    orgUrl: "https://dev.azure.com/myorg",
    project: "My Project",
    pat: "secret-pat",
  });
}

describe("orgNameFromUrl", () => {
  it("extracts the org name from a dev.azure.com URL", () => {
    expect(orgNameFromUrl("https://dev.azure.com/myorg")).toBe("myorg");
  });

  it("tolerates a trailing slash", () => {
    expect(orgNameFromUrl("https://dev.azure.com/myorg/")).toBe("myorg");
  });

  it("rejects a URL that is not an Azure DevOps Services org URL", () => {
    expect(() => orgNameFromUrl("https://example.com")).toThrow(
      /expected https:\/\/dev\.azure\.com\/<org>/
    );
  });
});

describe("listTags", () => {
  it("calls the project tags endpoint with Basic PAT auth", async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValue(jsonResponse({ value: [{ id: "1", name: "bug", url: "u" }] }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const tags = await newClient().listTags();

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(
      "https://dev.azure.com/myorg/My%20Project/_apis/wit/tags?api-version=7.1"
    );
    expect(init.method).toBe("GET");
    expect(init.headers.Authorization).toBe(
      `Basic ${Buffer.from(":secret-pat").toString("base64")}`
    );
    expect(tags).toEqual([{ id: "1", name: "bug", url: "u" }]);
  });

  it("returns an empty array when the project has no tags", async () => {
    global.fetch = jest.fn().mockResolvedValue(jsonResponse({})) as unknown as typeof fetch;
    expect(await newClient().listTags()).toEqual([]);
  });

  it("throws a sanitized error on a non-OK response", async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue(jsonResponse({ message: "nope" }, 403)) as unknown as typeof fetch;

    await expect(newClient().listTags()).rejects.toThrow(/403/);
  });

  it("throws a NotFoundError on a 404 so cleanup can treat it as already gone", async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue(jsonResponse({ message: "gone" }, 404)) as unknown as typeof fetch;

    // This branch drives the cleanup not-found contract and the CI sweep's exit
    // code: if a 404 stopped mapping to NotFoundError, every phantom tag would
    // count as unresolved and pin every run in-progress forever.
    await expect(newClient().listTags()).rejects.toThrow(NotFoundError);
    await expect(newClient().listTags()).rejects.toThrow(/404/);
  });

  it("classifies the 404 as not-found via isNotFound", async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue(jsonResponse({ message: "gone" }, 404)) as unknown as typeof fetch;

    const error = await newClient()
      .deleteTag("1")
      .then(() => undefined)
      .catch((e: unknown) => e);

    expect(isNotFound(error)).toBe(true);
  });
});

describe("non-JSON success responses", () => {
  it("names authentication as the likely cause of an HTTP 203 sign-in page", async () => {
    // A bad PAT gets 203 + HTML, not 401, and res.ok is true for 203.
    global.fetch = jest
      .fn()
      .mockResolvedValue(
        response("<html><body>Sign In</body></html>", 203, "text/html")
      ) as unknown as typeof fetch;

    await expect(newClient().listTags()).rejects.toThrow(/203/);
    await expect(newClient().listTags()).rejects.toThrow(/authentication failed/);
  });

  it("rejects a 200 whose body is not JSON rather than surfacing a parse error", async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue(response("<html></html>", 200, "text/html")) as unknown as typeof fetch;

    const error = await newClient()
      .listTags()
      .then(() => undefined)
      .catch((e: unknown) => e as Error);

    expect(error?.message).toContain("non-JSON body");
    expect(error?.message).not.toContain("Unexpected token");
  });
});

describe("renameTag", () => {
  it("PATCHes the tag by id with the new name", async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValue(jsonResponse({ id: "1", name: "new", url: "u" }));
    global.fetch = fetchMock as unknown as typeof fetch;

    await newClient().renameTag("1", "new");

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(
      "https://dev.azure.com/myorg/My%20Project/_apis/wit/tags/1?api-version=7.1"
    );
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body)).toEqual({ name: "new" });
  });
});

describe("deleteTag", () => {
  it("DELETEs the tag and tolerates an empty 204 body", async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 204,
      statusText: "No Content",
      json: async () => {
        throw new Error("no body");
      },
      text: async () => "",
    } as unknown as Response);
    global.fetch = fetchMock as unknown as typeof fetch;

    await expect(newClient().deleteTag("1")).resolves.toBeUndefined();
    expect(fetchMock.mock.calls[0][1].method).toBe("DELETE");
  });
});

describe("countWorkItemsWithTag", () => {
  it("filters the Analytics query server-side and counts the rows", async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValue(jsonResponse({ value: [{ WorkItemId: 1 }, { WorkItemId: 2 }] }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const count = await newClient().countWorkItemsWithTag("livetest-r1-count-a");

    expect(count).toBe(2);
    const [url] = fetchMock.mock.calls[0];
    expect(url).toContain("https://analytics.dev.azure.com/myorg/_odata/v4.0-preview/WorkItems");
    expect(decodeURIComponent(url as string)).toContain(
      "$filter=Tags/any(t: t/TagName eq 'livetest-r1-count-a')"
    );
  });

  it("follows @odata.nextLink and sums every page", async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ value: [{ WorkItemId: 1 }], "@odata.nextLink": "https://next" })
      )
      .mockResolvedValueOnce(jsonResponse({ value: [{ WorkItemId: 2 }] }));
    global.fetch = fetchMock as unknown as typeof fetch;

    expect(await newClient().countWorkItemsWithTag("t")).toBe(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("escapes single quotes in the tag name", async () => {
    const fetchMock = jest.fn().mockResolvedValue(jsonResponse({ value: [] }));
    global.fetch = fetchMock as unknown as typeof fetch;

    await newClient().countWorkItemsWithTag("it's");

    expect(decodeURIComponent(fetchMock.mock.calls[0][0] as string)).toContain("'it''s'");
  });

  it("percent-encodes & and # in the tag so they cannot forge a query boundary or URL fragment", async () => {
    const fetchMock = jest.fn().mockResolvedValue(jsonResponse({ value: [] }));
    global.fetch = fetchMock as unknown as typeof fetch;

    await newClient().countWorkItemsWithTag("A&B#C");

    const [rawUrl] = fetchMock.mock.calls[0];
    const parsed = new URL(rawUrl as string);
    expect(parsed.hash).toBe("");
    expect(decodeURIComponent(parsed.search)).toContain(
      "$filter=Tags/any(t: t/TagName eq 'A&B#C')"
    );
  });
});

const mockWit = {
  createWorkItem: jest.fn(),
  getWorkItemsBatch: jest.fn(),
  updateWorkItem: jest.fn(),
  deleteWorkItem: jest.fn(),
  queryByWiql: jest.fn(),
};

jest.mock("azure-devops-node-api", () => ({
  getPersonalAccessTokenHandler: jest.fn(() => ({})),
  WebApi: jest.fn().mockImplementation(() => ({
    getWorkItemTrackingApi: async () => mockWit,
  })),
}));

describe("work item operations", () => {
  beforeEach(() => {
    Object.values(mockWit).forEach((fn) => fn.mockReset());
  });

  it("creates a work item with a title and joined tags, returning its id", async () => {
    mockWit.createWorkItem.mockResolvedValue({ id: 101 });

    const id = await newClient().createWorkItem("Task", "live test", ["a", "b"]);

    expect(id).toBe(101);
    const [, patch, project, type] = mockWit.createWorkItem.mock.calls[0];
    expect(project).toBe("My Project");
    expect(type).toBe("Task");
    expect(patch).toEqual([
      { op: "add", path: "/fields/System.Title", value: "live test" },
      { op: "add", path: "/fields/System.Tags", value: "a; b" },
    ]);
  });

  it("throws when the API returns a work item without an id", async () => {
    mockWit.createWorkItem.mockResolvedValue({});
    await expect(newClient().createWorkItem("Task", "t", [])).rejects.toThrow(
      /did not return an id/
    );
  });

  it("reads tags for a batch of work items", async () => {
    mockWit.getWorkItemsBatch.mockResolvedValue([
      { id: 1, fields: { "System.Tags": "a; b" } },
      { id: 2, fields: {} },
    ]);

    const result = await newClient().getWorkItemTags([1, 2]);

    expect(result).toEqual([
      { id: 1, tags: ["a", "b"] },
      { id: 2, tags: [] },
    ]);
    const [request, project] = mockWit.getWorkItemsBatch.mock.calls[0];
    expect(request).toEqual({ ids: [1, 2], fields: ["System.Tags"] });
    expect(project).toBe("My Project");
  });

  it("returns an empty array without calling the API for an empty id list", async () => {
    expect(await newClient().getWorkItemTags([])).toEqual([]);
    expect(mockWit.getWorkItemsBatch).not.toHaveBeenCalled();
  });

  it("chunks batch reads at 200 ids", async () => {
    mockWit.getWorkItemsBatch.mockResolvedValue([]);
    await newClient().getWorkItemTags(Array.from({ length: 250 }, (_, i) => i + 1));
    expect(mockWit.getWorkItemsBatch).toHaveBeenCalledTimes(2);
    expect(mockWit.getWorkItemsBatch.mock.calls[0][0].ids).toHaveLength(200);
    expect(mockWit.getWorkItemsBatch.mock.calls[1][0].ids).toHaveLength(50);
  });

  it("writes tags back as a joined string", async () => {
    mockWit.updateWorkItem.mockResolvedValue({});

    await newClient().setWorkItemTags(7, ["a", "b"]);

    const [, patch, id, project] = mockWit.updateWorkItem.mock.calls[0];
    expect(patch).toEqual([
      { op: "add", path: "/fields/System.Tags", value: "a; b" },
    ]);
    expect(id).toBe(7);
    expect(project).toBe("My Project");
  });

  it("soft-deletes a work item", async () => {
    mockWit.deleteWorkItem.mockResolvedValue({});
    await newClient().deleteWorkItem(7);
    expect(mockWit.deleteWorkItem).toHaveBeenCalledWith(7, "My Project");
  });

  it("queries work item ids by tag with an escaped WIQL literal", async () => {
    mockWit.queryByWiql.mockResolvedValue({ workItems: [{ id: 3 }, { id: 4 }] });

    const ids = await newClient().queryWorkItemIdsByTag("it's");

    expect(ids).toEqual([3, 4]);
    const [wiql, teamContext] = mockWit.queryByWiql.mock.calls[0];
    expect(wiql.query).toContain("'it''s'");
    expect(teamContext).toEqual({ project: "My Project" });
  });

  it("returns an empty array when the query matches nothing", async () => {
    mockWit.queryByWiql.mockResolvedValue({});
    expect(await newClient().queryWorkItemIdsByTag("x")).toEqual([]);
  });
});
