import { TagCountCacheService } from "./TagCountCacheService";
import {
  mockGetService,
  mockGetAccessToken,
  mockExtensionDataManager,
  mockExtensionDataService,
} from "../test/mocks/azureDevopsSdkMock";

describe("TagCountCacheService", () => {
  const fetchMock = jest.fn();

  let consoleSpies: Record<"info" | "warn" | "error" | "debug", jest.SpyInstance>;

  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
    mockGetService.mockResolvedValue(mockExtensionDataService);
    window.localStorage.clear();
    consoleSpies = {
      info: jest.spyOn(console, "info").mockImplementation(() => undefined),
      warn: jest.spyOn(console, "warn").mockImplementation(() => undefined),
      error: jest.spyOn(console, "error").mockImplementation(() => undefined),
      debug: jest.spyOn(console, "debug").mockImplementation(() => undefined),
    };
  });

  const loggedText = (spy: jest.SpyInstance) =>
    (spy.mock.calls as unknown[][])
      .map((args) => args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "))
      .join("\n");

  // --- getCache ---

  it("returns null when no value is stored", async () => {
    mockExtensionDataManager.getValue.mockResolvedValue(undefined);

    const service = new TagCountCacheService();
    const result = await service.getCache();

    expect(result).toBeNull();
  });

  it("returns stored cache when present", async () => {
    const stored = { counts: { bug: 5 }, lastUpdated: "2026-04-26T10:00:00.000Z" };
    mockExtensionDataManager.getValue.mockResolvedValue(stored);

    const service = new TagCountCacheService();
    const result = await service.getCache();

    expect(result).toEqual(stored);
  });

  it("invalidates corrupted counts written by the old prototype-key accumulator", async () => {
    mockExtensionDataManager.getValue.mockResolvedValue({
      counts: JSON.parse('{"constructor":"function Object() { [native code] }3"}'),
      lastUpdated: new Date().toISOString(),
    });

    expect(await new TagCountCacheService().getCache()).toBeNull();
    expect(loggedText(consoleSpies.warn)).toMatch(/invalid.*cache/i);
  });

  it("reads with key 'orgTagCounts' and Default scope", async () => {
    mockExtensionDataManager.getValue.mockResolvedValue(undefined);

    const service = new TagCountCacheService();
    await service.getCache();

    expect(mockExtensionDataManager.getValue).toHaveBeenCalledWith(
      "orgTagCounts",
      { scopeType: "Default" }
    );
  });

  // --- setCache ---

  it("writes cache with key 'orgTagCounts' and Default scope", async () => {
    mockExtensionDataManager.setValue.mockResolvedValue(undefined);
    const cache = { counts: { bug: 3 }, lastUpdated: "2026-04-26T10:00:00.000Z" };

    const service = new TagCountCacheService();
    await service.setCache(cache);

    expect(mockExtensionDataManager.setValue).toHaveBeenCalledWith(
      "orgTagCounts",
      cache,
      { scopeType: "Default" }
    );
  });

  // --- fetchCounts: server-side aggregation by TagNames ---

  const okJson = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
  const failure = (status: number, text = "nope", retryAfter?: string) => ({
    ok: false,
    status,
    statusText: text,
    text: async () => text,
    headers: { get: (h: string) => (h.toLowerCase() === "retry-after" ? retryAfter ?? null : null) },
  });
  // Makes the first request (the aggregation) get rejected, as Analytics does
  // for an unsupported $apply, so the crawl fallback runs for the rest.
  const rejectAggregate = () => fetchMock.mockResolvedValueOnce(failure(400, "bad $apply"));

  it.each(["aggregate", "crawl"])("counts prototype-property tag names with %s and survives JSON storage", async (strategy) => {
    if (strategy === "aggregate") {
      fetchMock.mockResolvedValue(okJson({ value: [
        { TagNames: "constructor; __proto__; toString", Count: 2 },
        { TagNames: "constructor", Count: 1 },
      ] }));
    } else {
      rejectAggregate();
      fetchMock.mockResolvedValueOnce(okJson({ value: [
        { Tags: [{ TagName: "constructor" }, { TagName: "__proto__" }, { TagName: "toString" }] },
        { Tags: [{ TagName: "constructor" }, { TagName: "__proto__" }, { TagName: "toString" }] },
        { Tags: [{ TagName: "constructor" }] },
      ] }));
    }

    const counts = await new TagCountCacheService().fetchCounts("my-org");
    const stored = JSON.parse(JSON.stringify(counts));

    expect(counts["constructor"]).toBe(3);
    expect(counts["__proto__"]).toBe(2);
    expect(counts["tostring"]).toBe(2);
    expect(stored["constructor"]).toBe(3);
    expect(stored["__proto__"]).toBe(2);
    expect(stored["tostring"]).toBe(2);
  });

  const makeService = () => {
    const sleep = jest.fn().mockResolvedValue(undefined);
    return { service: new TagCountCacheService({ sleep }), sleep };
  };

  it("groups by TagNames with a bearer token and sums each combination into every tag", async () => {
    fetchMock.mockResolvedValue(
      okJson({
        value: [
          { TagNames: "Bug; UI", Count: 3 },
          { TagNames: "bug", Count: 2 },
        ],
      })
    );

    const { service } = makeService();
    const counts = await service.fetchCounts("my-org");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("analytics.dev.azure.com/my-org");
    expect(url).toContain(
      "$apply=filter(TagNames ne null)/groupby((TagNames),aggregate($count as Count))"
    );
    expect(url).not.toContain("$expand");
    expect((options.headers as Record<string, string>)["Authorization"]).toBe(
      "Bearer test-access-token"
    );
    expect(counts).toEqual({ bug: 5, ui: 3 });
  });

  it("counts a work item once when case variants of a tag appear in one combination", async () => {
    fetchMock.mockResolvedValue(okJson({ value: [{ TagNames: "Bug; bug; BUG", Count: 4 }] }));

    const { service } = makeService();
    expect(await service.fetchCounts("my-org")).toEqual({ bug: 4 });
  });

  it("ignores rows with null, empty or whitespace TagNames and non-numeric Count", async () => {
    fetchMock.mockResolvedValue(
      okJson({
        value: [
          { TagNames: "ops", Count: 1 },
          { TagNames: null, Count: 9 },
          { TagNames: "", Count: 9 },
          { TagNames: " ; ", Count: 9 },
          { TagNames: "skipped", Count: "many" },
        ],
      })
    );

    const { service } = makeService();
    expect(await service.fetchCounts("my-org")).toEqual({ ops: 1 });
  });

  it("follows @odata.nextLink across aggregate pages", async () => {
    fetchMock
      .mockResolvedValueOnce(
        okJson({
          value: [{ TagNames: "bug", Count: 1 }],
          "@odata.nextLink": "https://analytics.dev.azure.com/my-org/_odata/v4.0-preview/WorkItems?$skiptoken=abc",
        })
      )
      .mockResolvedValueOnce(okJson({ value: [{ TagNames: "bug; feature", Count: 2 }] }));

    const { service } = makeService();
    const counts = await service.fetchCounts("my-org");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect((fetchMock.mock.calls[1] as [string])[0]).toContain("$skiptoken=abc");
    expect(counts).toEqual({ bug: 3, feature: 2 });
  });

  it("requests a fresh access token for every page", async () => {
    mockGetAccessToken.mockClear();
    fetchMock
      .mockResolvedValueOnce(
        okJson({
          value: [{ TagNames: "bug", Count: 1 }],
          "@odata.nextLink": "https://analytics.dev.azure.com/my-org/_odata/v4.0-preview/WorkItems?$skiptoken=abc",
        })
      )
      .mockResolvedValueOnce(okJson({ value: [] }));

    const { service } = makeService();
    await service.fetchCounts("my-org");

    expect(mockGetAccessToken).toHaveBeenCalledTimes(2);
  });

  // --- fetchCounts: fallback to the paged crawl ---

  it("falls back to the paged $expand crawl when the aggregation is rejected with 400", async () => {
    rejectAggregate();
    fetchMock.mockResolvedValueOnce(
      okJson({
        value: [
          { Tags: [{ TagName: "Bug" }, { TagName: "Feature" }] },
          { Tags: [{ TagName: "Bug" }] },
        ],
      })
    );

    const { service } = makeService();
    const counts = await service.fetchCounts("my-org");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const crawlUrl = (fetchMock.mock.calls[1] as [string])[0];
    expect(crawlUrl).toContain("$expand=Tags");
    expect(crawlUrl).toContain("$filter=Tags/any()");
    expect(counts).toEqual({ bug: 2, feature: 1 });
  });

  it("skips crawl entries with null Tags or null TagName", async () => {
    rejectAggregate();
    fetchMock.mockResolvedValueOnce(
      okJson({
        value: [
          { Tags: [{ TagName: "ops" }] },
          { Tags: null },
          { Tags: [{ TagName: null }] },
        ],
      })
    );

    const { service } = makeService();
    expect(await service.fetchCounts("my-org")).toEqual({ ops: 1 });
  });

  it("follows @odata.nextLink during the crawl fallback", async () => {
    rejectAggregate();
    fetchMock
      .mockResolvedValueOnce(
        okJson({
          value: [{ Tags: [{ TagName: "bug" }] }],
          "@odata.nextLink": "https://analytics.dev.azure.com/my-org/_odata/v4.0-preview/WorkItems?$skiptoken=abc",
        })
      )
      .mockResolvedValueOnce(okJson({ value: [{ Tags: [{ TagName: "bug" }, { TagName: "feature" }] }] }));

    const { service } = makeService();
    const counts = await service.fetchCounts("my-org");

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(counts).toEqual({ bug: 2, feature: 1 });
  });

  it("does not fall back on auth failures", async () => {
    fetchMock.mockResolvedValue(failure(403, "Access denied"));

    const { service } = makeService();
    await expect(service.fetchCounts("my-org")).rejects.toThrow("403");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("surfaces the error when the crawl fallback also fails", async () => {
    rejectAggregate();
    fetchMock.mockResolvedValueOnce(failure(500, "boom"));

    const { service } = makeService();
    await expect(service.fetchCounts("my-org")).rejects.toThrow("500");
  });

  // --- fetchCounts: throttling ---

  it.each([429, 503])("retries a %i honouring Retry-After (seconds)", async (status) => {
    fetchMock
      .mockResolvedValueOnce(failure(status, "slow down", "7"))
      .mockResolvedValueOnce(okJson({ value: [{ TagNames: "bug", Count: 1 }] }));

    const { service, sleep } = makeService();
    const counts = await service.fetchCounts("my-org");

    expect(counts).toEqual({ bug: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(7000);
  });

  it("backs off exponentially when Retry-After is absent", async () => {
    fetchMock
      .mockResolvedValueOnce(failure(429))
      .mockResolvedValueOnce(failure(429))
      .mockResolvedValueOnce(okJson({ value: [] }));

    const { service, sleep } = makeService();
    await service.fetchCounts("my-org");

    expect(sleep.mock.calls.map((c) => c[0])).toEqual([1000, 2000]);
  });

  it("does not refetch pages that already succeeded when a later page is throttled", async () => {
    fetchMock
      .mockResolvedValueOnce(
        okJson({
          value: [{ TagNames: "bug", Count: 1 }],
          "@odata.nextLink": "https://analytics.dev.azure.com/my-org/_odata/v4.0-preview/WorkItems?$skiptoken=abc",
        })
      )
      .mockResolvedValueOnce(failure(429, "slow", "1"))
      .mockResolvedValueOnce(okJson({ value: [{ TagNames: "bug", Count: 2 }] }));

    const { service } = makeService();
    const counts = await service.fetchCounts("my-org");

    expect(counts).toEqual({ bug: 3 });
    const urls = fetchMock.mock.calls.map((c) => (c as [string])[0]);
    expect(urls.filter((u) => !u.includes("skiptoken"))).toHaveLength(1);
  });

  it("gives up after 5 retries and throws the 429", async () => {
    fetchMock.mockResolvedValue(failure(429, "slow down"));

    const { service, sleep } = makeService();
    await expect(service.fetchCounts("my-org")).rejects.toThrow("429");
    expect(fetchMock).toHaveBeenCalledTimes(6);
    expect(sleep).toHaveBeenCalledTimes(5);
  });

  it("does not retry other server errors", async () => {
    fetchMock.mockResolvedValue(failure(500, "boom"));

    const { service, sleep } = makeService();
    await expect(service.fetchCounts("my-org")).rejects.toThrow("500");
    expect(sleep).not.toHaveBeenCalled();
  });

  // --- refreshCache ---

  it("fetches counts, stores cache, and returns the new cache object", async () => {
    fetchMock.mockResolvedValue(okJson({ value: [{ TagNames: "ops", Count: 1 }] }));
    mockExtensionDataManager.setValue.mockResolvedValue(undefined);

    const { service } = makeService();
    const result = await service.refreshCache("my-org");

    expect(result.counts).toEqual({ ops: 1 });
    expect(result.lastUpdated).toBeDefined();
    expect(new Date(result.lastUpdated).getTime()).toBeGreaterThan(0);
    expect(mockExtensionDataManager.setValue).toHaveBeenCalledWith(
      "orgTagCounts",
      expect.objectContaining({ counts: { ops: 1 } }),
      { scopeType: "Default" }
    );
  });

  it("on failure leaves the stored counts untouched and records the failed attempt", async () => {
    fetchMock.mockResolvedValue(failure(500, "boom"));
    mockExtensionDataManager.setValue.mockResolvedValue(undefined);

    const { service } = makeService();
    await expect(service.refreshCache("my-org")).rejects.toThrow("500");

    const keys = mockExtensionDataManager.setValue.mock.calls.map((c) => c[0]);
    expect(keys).not.toContain("orgTagCounts");
    expect(mockExtensionDataManager.setValue).toHaveBeenCalledWith(
      "orgTagCountsAttempt",
      expect.objectContaining({ at: expect.any(String), error: expect.stringContaining("500") }),
      { scopeType: "Default" }
    );
  });

  it("rethrows the original error even if recording the attempt fails", async () => {
    fetchMock.mockResolvedValue(failure(500, "boom"));
    mockExtensionDataManager.setValue.mockRejectedValue(new Error("storage down"));

    const { service } = makeService();
    await expect(service.refreshCache("my-org")).rejects.toThrow("500");
  });

  // --- diagnostics: stats + logging ---

  describe("diagnostics", () => {
    const nextLink = "https://analytics.dev.azure.com/my-org/_odata/v4.0-preview/WorkItems?$skiptoken=SECRETISH123";

    it("records aggregate stats on the cache: requests, retries and rows", async () => {
      mockExtensionDataManager.setValue.mockResolvedValue(undefined);
      fetchMock
        .mockResolvedValueOnce(okJson({ value: [{ TagNames: "bug", Count: 1 }], "@odata.nextLink": nextLink }))
        .mockResolvedValueOnce(failure(429, "slow", "1"))
        .mockResolvedValueOnce(okJson({ value: [{ TagNames: "ui", Count: 2 }] }));

      const { service } = makeService();
      const cache = await service.refreshCache("my-org");

      expect(cache.stats).toEqual({
        strategy: "aggregate",
        requests: 3,
        retries: 1,
        rows: 2,
        durationMs: expect.any(Number),
      });
      expect(cache.stats?.fallbackReason).toBeUndefined();
      expect(mockExtensionDataManager.setValue).toHaveBeenCalledWith(
        "orgTagCounts",
        expect.objectContaining({ stats: expect.objectContaining({ strategy: "aggregate" }) }),
        { scopeType: "Default" }
      );
    });

    it("records the crawl strategy and why the aggregate was abandoned", async () => {
      mockExtensionDataManager.setValue.mockResolvedValue(undefined);
      rejectAggregate();
      fetchMock.mockResolvedValueOnce(
        okJson({ value: [{ Tags: [{ TagName: "a" }] }, { Tags: [{ TagName: "b" }] }] })
      );

      const { service } = makeService();
      const cache = await service.refreshCache("my-org");

      expect(cache.stats).toEqual({
        strategy: "crawl",
        requests: 2,
        retries: 0,
        rows: 2,
        durationMs: expect.any(Number),
        fallbackReason: expect.stringContaining("400"),
      });
    });

    it("logs one info line per refresh naming the strategy and totals", async () => {
      mockExtensionDataManager.setValue.mockResolvedValue(undefined);
      fetchMock.mockResolvedValue(okJson({ value: [{ TagNames: "bug", Count: 1 }] }));

      const { service } = makeService();
      await service.refreshCache("my-org");

      expect(consoleSpies.info).toHaveBeenCalledTimes(1);
      const line = loggedText(consoleSpies.info);
      expect(line).toContain("[TagToolkit]");
      expect(line).toContain("aggregate");
      expect(line).toMatch(/1 request/);
      expect(line).toMatch(/1 tag/);
    });

    it("warns when falling back to the crawl, with the reason", async () => {
      rejectAggregate();
      fetchMock.mockResolvedValueOnce(okJson({ value: [] }));

      const { service } = makeService();
      await service.fetchCounts("my-org");

      const warning = loggedText(consoleSpies.warn);
      expect(warning).toContain("crawl");
      expect(warning).toContain("400");
    });

    it("warns on each throttle retry with status and delay", async () => {
      fetchMock
        .mockResolvedValueOnce(failure(429, "slow", "3"))
        .mockResolvedValueOnce(okJson({ value: [] }));

      const { service } = makeService();
      await service.fetchCounts("my-org");

      const warning = loggedText(consoleSpies.warn);
      expect(warning).toContain("429");
      expect(warning).toContain("3000ms");
      expect(warning).toMatch(/retry 1\/5/i);
    });

    it("logs an error when the refresh fails, without recording stats", async () => {
      mockExtensionDataManager.setValue.mockResolvedValue(undefined);
      fetchMock.mockResolvedValue(failure(500, "boom"));

      const { service } = makeService();
      await expect(service.refreshCache("my-org")).rejects.toThrow("500");

      expect(loggedText(consoleSpies.error)).toContain("500");
    });

    it("stays quiet at debug level unless tagToolkitDebug is enabled", async () => {
      fetchMock.mockResolvedValue(okJson({ value: [] }));

      const { service } = makeService();
      await service.fetchCounts("my-org");

      expect(consoleSpies.debug).not.toHaveBeenCalled();
    });

    it("with tagToolkitDebug on, logs each request's query, status, rows and timing", async () => {
      window.localStorage.setItem("tagToolkitDebug", "1");
      fetchMock
        .mockResolvedValueOnce(okJson({ value: [{ TagNames: "bug", Count: 1 }], "@odata.nextLink": nextLink }))
        .mockResolvedValueOnce(okJson({ value: [{ TagNames: "ui", Count: 1 }] }));

      const { service } = makeService();
      await service.fetchCounts("my-org");

      expect(consoleSpies.debug).toHaveBeenCalledTimes(2);
      const text = loggedText(consoleSpies.debug);
      expect(text).toContain("TagNames");
      expect(text).toContain("200");
      expect(text).toMatch(/\d+ms/);
      expect(text).not.toContain("SECRETISH123");
    });

    it("never logs the access token or Authorization header at any level", async () => {
      window.localStorage.setItem("tagToolkitDebug", "1");
      mockExtensionDataManager.setValue.mockResolvedValue(undefined);
      rejectAggregate();
      fetchMock
        .mockResolvedValueOnce(failure(429, "Bearer test-access-token rejected", "1"))
        .mockResolvedValueOnce(okJson({ value: [] }));

      const { service } = makeService();
      await service.refreshCache("my-org");

      const all = Object.values(consoleSpies).map(loggedText).join("\n");
      expect(all).not.toContain("test-access-token");
      expect(all.toLowerCase()).not.toContain("bearer");
      expect(all.toLowerCase()).not.toContain("authorization");
    });
  });

  // --- isStaleCacheOrMissing ---

  it("returns true when cache is null", () => {
    const service = new TagCountCacheService();
    expect(service.isStaleCacheOrMissing(null)).toBe(true);
  });

  it("returns true when lastUpdated is more than 24 hours ago", () => {
    const old = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    const service = new TagCountCacheService();
    expect(service.isStaleCacheOrMissing({ counts: {}, lastUpdated: old })).toBe(true);
  });

  it("returns false when lastUpdated is less than 24 hours ago", () => {
    const recent = new Date(Date.now() - 60 * 1000).toISOString();
    const service = new TagCountCacheService();
    expect(service.isStaleCacheOrMissing({ counts: {}, lastUpdated: recent })).toBe(false);
  });

  // --- shouldAutoRefresh (staleness + failure cooldown) ---

  describe("shouldAutoRefresh", () => {
    const minutesAgo = (m: number) => new Date(Date.now() - m * 60 * 1000).toISOString();
    const staleCache = { counts: { bug: 1 }, lastUpdated: minutesAgo(25 * 60) };

    const storeAttempt = (attempt: unknown) =>
      mockExtensionDataManager.getValue.mockImplementation(async (key: string) =>
        key === "orgTagCountsAttempt" ? attempt : undefined
      );

    it("is false for a fresh cache", async () => {
      storeAttempt(undefined);
      const { service } = makeService();
      expect(await service.shouldAutoRefresh({ counts: {}, lastUpdated: minutesAgo(1) })).toBe(false);
    });

    it("is true for a stale cache with no recorded failure", async () => {
      storeAttempt(undefined);
      const { service } = makeService();
      expect(await service.shouldAutoRefresh(staleCache)).toBe(true);
    });

    it("is true when there is no cache and no recorded failure", async () => {
      storeAttempt(undefined);
      const { service } = makeService();
      expect(await service.shouldAutoRefresh(null)).toBe(true);
    });

    it("is false while a recent failure is inside the cooldown", async () => {
      storeAttempt({ at: minutesAgo(1), error: "Analytics OData: 500" });
      const { service } = makeService();
      expect(await service.shouldAutoRefresh(staleCache)).toBe(false);
      expect(await service.shouldAutoRefresh(null)).toBe(false);
    });

    it("is true again once the cooldown has passed", async () => {
      storeAttempt({ at: minutesAgo(20), error: "Analytics OData: 500" });
      const { service } = makeService();
      expect(await service.shouldAutoRefresh(staleCache)).toBe(true);
    });

    it("ignores a failure recorded before the last successful refresh", async () => {
      const cache = { counts: {}, lastUpdated: minutesAgo(25 * 60) };
      storeAttempt({ at: minutesAgo(25 * 60 + 5), error: "old" });
      const { service } = makeService();
      expect(await service.shouldAutoRefresh(cache)).toBe(true);
    });

    it("treats an unreadable attempt record as no failure", async () => {
      mockExtensionDataManager.getValue.mockRejectedValue(new Error("storage down"));
      const { service } = makeService();
      expect(await service.shouldAutoRefresh(staleCache)).toBe(true);
    });
  });
});
