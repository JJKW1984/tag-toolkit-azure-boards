// live-test/adoClient.test.ts
import { AdoClient, orgNameFromUrl } from "./adoClient";

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: "",
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
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
});
