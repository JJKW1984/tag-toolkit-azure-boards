// src/services/TagCountCacheService.ts
import * as SDK from "azure-devops-extension-sdk";
import { CommonServiceIds, IExtensionDataService } from "azure-devops-extension-api/Common/CommonServices";
import { RefreshStats, TagCountCache } from "../types";
import * as log from "../utils/debugLog";
import { sanitizeError } from "../utils/sanitizeError";
import { parseTags } from "../utils/tagString";

const CACHE_KEY = "orgTagCounts";
const ATTEMPT_KEY = "orgTagCountsAttempt";
const STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000;
// After a failed refresh, wait this long before the hub auto-retries, so a slow
// or throttled org is not re-crawled on every page load by every user.
const RETRY_COOLDOWN_MS = 15 * 60 * 1000;
const MAX_RETRIES = 5;
const MAX_RETRY_DELAY_MS = 60 * 1000;
const RETRYABLE_STATUSES = new Set([429, 503]);

const ANALYTICS_WORK_ITEMS = (orgName: string) =>
  `https://analytics.dev.azure.com/${encodeURIComponent(orgName)}/_odata/v4.0-preview/WorkItems`;

/** The most recent failed refresh, kept apart from the counts so a failure never clobbers them. */
interface RefreshAttempt {
  at: string;
  error: string;
}

class AnalyticsHttpError extends Error {
  constructor(readonly status: number, detail: string) {
    super(`Analytics OData: ${status} ${detail}`);
  }
}

/** Mutable tally for one refresh; becomes RefreshStats once the strategy that produced the counts is known. */
interface RunTally {
  requests: number;
  retries: number;
  rows: number;
}

/** Request path + query for debug logs: the org's own URL minus origin, with the opaque paging token elided. */
function describeUrl(url: string): string {
  return url
    .replace(/^https:\/\/analytics\.dev\.azure\.com/i, "")
    .replace(/(\$skiptoken=)[^&]+/i, "$1…");
}

interface ODataPage<T> {
  value?: T[];
  "@odata.nextLink"?: string;
}

export interface TagCountCacheServiceOptions {
  /** Injectable so retry back-off does not make tests slow. */
  sleep?: (ms: number) => Promise<void>;
}

export class TagCountCacheService {
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(options: TagCountCacheServiceOptions = {}) {
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  private async getDataManager() {
    const dataService = await SDK.getService<IExtensionDataService>(
      CommonServiceIds.ExtensionDataService
    );
    const extensionId = SDK.getExtensionContext().id;
    const token = await SDK.getAccessToken();
    return dataService.getExtensionDataManager(extensionId, token);
  }

  async getCache(): Promise<TagCountCache | null> {
    const manager = await this.getDataManager();
    const value = await manager.getValue<TagCountCache>(CACHE_KEY, { scopeType: "Default" });
    return value ?? null;
  }

  async setCache(cache: TagCountCache): Promise<void> {
    const manager = await this.getDataManager();
    await manager.setValue(CACHE_KEY, cache, { scopeType: "Default" });
  }

  /** Counts per tag, without the diagnostics. See fetchCountsWithStats. */
  async fetchCounts(orgName: string): Promise<Record<string, number>> {
    return (await this.fetchCountsWithStats(orgName)).counts;
  }

  /**
   * Counts work items per tag (lowercased), org-wide, plus how the run went.
   *
   * Groups by the single-valued TagNames string so the server returns one row
   * per distinct tag combination instead of one per work item. `Tags` itself is
   * a collection-valued navigation property, which `groupby` cannot traverse.
   * If Analytics rejects the aggregation (400) we fall back to paging every
   * tagged work item and counting client-side.
   */
  async fetchCountsWithStats(
    orgName: string
  ): Promise<{ counts: Record<string, number>; stats: RefreshStats }> {
    const started = Date.now();
    const tally: RunTally = { requests: 0, retries: 0, rows: 0 };
    try {
      const counts = await this.fetchAggregatedCounts(orgName, tally);
      return { counts, stats: { strategy: "aggregate", ...tally, durationMs: Date.now() - started } };
    } catch (e) {
      if (!(e instanceof AnalyticsHttpError && e.status === 400)) throw e;
      const fallbackReason = sanitizeError(e);
      log.warn(`Aggregation was rejected (${fallbackReason}); falling back to the paged crawl.`);
      tally.rows = 0;
      const counts = await this.fetchCrawledCounts(orgName, tally);
      return {
        counts,
        stats: { strategy: "crawl", ...tally, durationMs: Date.now() - started, fallbackReason },
      };
    }
  }

  private async fetchAggregatedCounts(
    orgName: string,
    tally: RunTally
  ): Promise<Record<string, number>> {
    const counts: Record<string, number> = {};
    let url: string | null =
      `${ANALYTICS_WORK_ITEMS(orgName)}` +
      `?$apply=filter(TagNames ne null)/groupby((TagNames),aggregate($count as Count))`;

    while (url) {
      const data: ODataPage<{ TagNames: string | null; Count: unknown }> =
        await this.getJson(url, tally);
      for (const row of data.value ?? []) {
        if (typeof row.Count !== "number") continue;
        // Case variants of one tag in a single combination are one tag on that work item.
        const names = new Set(parseTags(row.TagNames ?? "").map((t) => t.toLowerCase()));
        for (const name of names) counts[name] = (counts[name] ?? 0) + row.Count;
      }
      url = data["@odata.nextLink"] ?? null;
    }
    return counts;
  }

  private async fetchCrawledCounts(
    orgName: string,
    tally: RunTally
  ): Promise<Record<string, number>> {
    const counts: Record<string, number> = {};
    let url: string | null =
      `${ANALYTICS_WORK_ITEMS(orgName)}` +
      `?$select=WorkItemId&$expand=Tags($select=TagName)&$filter=Tags/any()`;

    while (url) {
      const data: ODataPage<{ Tags: Array<{ TagName: string | null }> | null }> =
        await this.getJson(url, tally);
      for (const item of data.value ?? []) {
        for (const tag of item.Tags ?? []) {
          if (tag?.TagName) {
            const name = tag.TagName.toLowerCase();
            counts[name] = (counts[name] ?? 0) + 1;
          }
        }
      }
      url = data["@odata.nextLink"] ?? null;
    }
    return counts;
  }

  /**
   * GET one Analytics page. A fresh token is fetched per request so a long
   * crawl outlives token expiry, and throttling (429/503) is retried here so a
   * page that already succeeded is never refetched.
   */
  private async getJson<T extends ODataPage<unknown>>(url: string, tally: RunTally): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      const token = await SDK.getAccessToken();
      const requestStarted = Date.now();
      tally.requests++;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });

      if (res.ok) {
        const data = (await res.json()) as T;
        const rows = data.value?.length ?? 0;
        tally.rows += rows;
        log.debug(`GET ${describeUrl(url)} -> ${res.status}, ${rows} rows, ${Date.now() - requestStarted}ms`);
        return data;
      }

      if (RETRYABLE_STATUSES.has(res.status) && attempt < MAX_RETRIES) {
        const delayMs = this.retryDelayMs(res, attempt);
        tally.retries++;
        log.warn(`Throttled (${res.status}); retry ${attempt + 1}/${MAX_RETRIES} in ${delayMs}ms.`);
        await this.sleep(delayMs);
        continue;
      }
      log.debug(`GET ${describeUrl(url)} -> ${res.status}, ${Date.now() - requestStarted}ms`);
      const text = await res.text().catch(() => res.statusText);
      throw new AnalyticsHttpError(res.status, text);
    }
  }

  private retryDelayMs(res: Response, attempt: number): number {
    const seconds = Number(res.headers?.get?.("retry-after"));
    const ms = Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 1000 * 2 ** attempt;
    return Math.min(ms, MAX_RETRY_DELAY_MS);
  }

  async refreshCache(orgName: string): Promise<TagCountCache> {
    let fetched: Awaited<ReturnType<TagCountCacheService["fetchCountsWithStats"]>>;
    try {
      fetched = await this.fetchCountsWithStats(orgName);
    } catch (e) {
      log.error(`Tag count refresh failed: ${sanitizeError(e)}`);
      await this.recordFailedAttempt(e);
      throw e;
    }
    const { counts, stats } = fetched;
    const cache: TagCountCache = { counts, lastUpdated: new Date().toISOString(), stats };
    await this.setCache(cache);
    log.info(
      `Refreshed counts for ${Object.keys(counts).length} tag(s) via ${stats.strategy}: ` +
        `${stats.requests} request${stats.requests === 1 ? "" : "s"}, ` +
        `${stats.rows} rows, ${stats.retries} throttle retries, ${stats.durationMs}ms.`
    );
    return cache;
  }

  private async recordFailedAttempt(error: unknown): Promise<void> {
    try {
      const manager = await this.getDataManager();
      const attempt: RefreshAttempt = { at: new Date().toISOString(), error: sanitizeError(error) };
      await manager.setValue(ATTEMPT_KEY, attempt, { scopeType: "Default" });
    } catch {
      // Best effort: failing to note the failure must not mask the real error.
    }
  }

  private async getLastFailedAttempt(): Promise<RefreshAttempt | null> {
    try {
      const manager = await this.getDataManager();
      return (await manager.getValue<RefreshAttempt>(ATTEMPT_KEY, { scopeType: "Default" })) ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Whether the hub should kick off a background refresh on load: the cache is
   * stale or missing AND no refresh has failed since the last success within
   * the cooldown. The manual "Refresh Counts" button bypasses this.
   */
  async shouldAutoRefresh(cache: TagCountCache | null): Promise<boolean> {
    if (!this.isStaleCacheOrMissing(cache)) return false;
    const attempt = await this.getLastFailedAttempt();
    if (!attempt) return true;
    const failedAt = new Date(attempt.at).getTime();
    if (Number.isNaN(failedAt)) return true;
    if (cache) {
      const succeededAt = new Date(cache.lastUpdated).getTime();
      if (!Number.isNaN(succeededAt) && failedAt <= succeededAt) return true;
    }
    return Date.now() - failedAt > RETRY_COOLDOWN_MS;
  }

  isStaleCacheOrMissing(cache: TagCountCache | null): boolean {
    if (!cache) return true;
    const ts = new Date(cache.lastUpdated).getTime();
    if (Number.isNaN(ts)) return true;
    return Date.now() - ts > STALE_THRESHOLD_MS;
  }
}
