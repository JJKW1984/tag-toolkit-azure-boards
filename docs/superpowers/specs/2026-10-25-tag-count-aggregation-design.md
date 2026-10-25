# Server-Side Tag Count Aggregation

**Date:** 2026-10-25
**Issue:** #17 — Possible performance issues with odata aggregation
**Status:** Direction 1 + resilience implemented (decision: visible-page counts, §4, not pursued; owner confirmed only 25 visible rows matter but chose the aggregate). Query shape still **unverified against a live org** — run the probe. The crawl fallback covers a rejected aggregate.

## Context

`TagCountCacheService.fetchCounts` pages through every tagged work item in the org (`$expand=Tags`, `@odata.nextLink`, 10k rows/page, sequential) and counts client-side. Cost is linear in tagged work items, not in distinct tags. Issue #17 proposes `$apply=groupby((Tags/TagName),aggregate($count as Count))`.

That exact query was the original implementation (2026-04-26 spec) and was removed in b64c3bc because `Tags` is a collection-valued navigation property and OData `groupby` only accepts single-valued paths. The commit also fixed a missing `vso.analytics` scope (401s), so the groupby failure was never isolated from the auth failure. The probe in `scripts/probe-tag-counts.ts` re-tests it (variant `L`) to settle that.

### What the issue gets wrong, and right

| Claim | Assessment |
|-------|-----------|
| Memory heavy | Overstated. Only the counts map is retained; pages are transient. |
| Bandwidth/time heavy | Correct. ~N/10,000 serial round trips plus full `Tags` expansion per row. |
| Throttling/timeouts | Correct, and unhandled: no 429/`Retry-After` handling, and one failed page discards all progress. |

### Amplifying failure mode

`lastUpdated` is written only on success, so `isStaleCacheOrMissing` stays true after a failure. Every hub open by every user re-triggers the full crawl. A slow-but-failing org gets hammered, not backed off.

## Scale facts (from the owner, 2026-10-25)

- **>50,000 distinct tags** in the org; **<10 tags per work item**.
- The UI shows 25 tags per page, alphabetical, with search and an A–Z filter ([TagManagerApp.tsx:30](../../../src/app/TagManagerApp.tsx#L30)). There is no sort or filter by count, so counts are only *read* for the 25 visible rows.

Consequences:

1. **Row reduction from grouping by `TagNames` is uncertain.** It depends on how many items share an identical tag set. A long tail of rare tags produces many singleton combinations, each costing one row exactly like a work item does. Expect a real but possibly modest win (low single digits to ~10x), not orders of magnitude. The probe now reports tagged items, tag-set groups, the reduction ratio, and the singleton share, so this is measured rather than guessed.
2. **Per-tag server counting (old option 2) is dead** at 50k tags (50k requests). It survives only as a per-*visible-page* query, see §4.
3. **The cache document is large.** A 50k-entry map is roughly 1–2 MB serialized. A per-document size limit for `IExtensionDataService.setValue` isn't documented in the Microsoft Learn data-storage pages I checked, so treat it as unknown. If `setValue` rejects the document, every refresh fails after doing all the work. The probe prints the serialized size; sharding the cache (see §5) is the mitigation.
4. **<10 tags/item bounds the crawl's per-row cost**, so the crawl is slow mainly from item *count* and serial round trips, not payload per row. That makes request count, not bytes, the metric that matters.

## Design

### 1. Group by `TagNames`, expand client-side

`TagNames` is a single-valued string on `WorkItems` (`"bug; ui; P1"`), so it is a legal `groupby` key.

```
GET https://analytics.dev.azure.com/{org}/_odata/v4.0-preview/WorkItems
  ?$apply=filter(TagNames ne null)/groupby((TagNames),aggregate($count as Count))
```

Response rows are one per *distinct tag combination*:

```json
{ "value": [ { "TagNames": "bug; ui", "Count": 340 }, { "TagNames": "bug", "Count": 1210 } ] }
```

Client folding: split each `TagNames` with the existing `parseTags` (`src/utils/tagString.ts`), lowercase, de-duplicate within the combination, and add `Count` to each tag. Result is the same `Record<string, number>` the cache already stores — **no change to `TagCountCache`, `TagManagerApp`, or `TagTable`**.

Row count is bounded by distinct tag *sets*, not work items. Worst case (every item has a unique combination) degrades to today's cost, never worse. Still follows `@odata.nextLink` for the >10k-combination case. At 50k tags the >10k-group case is likely, so this still pages; the win is fewer pages, not one page.

Correctness notes:
- ADO separates tags with `;`, so tag names cannot contain it; splitting is safe.
- `"Bug; UI"` and `"bug; ui"` may or may not collapse server-side. Folding lowercases and sums, so totals are right either way.
- A tag appearing twice in one combination (case variants) counts once per work item, matching the crawl.

### 2. Resilient fetching (applies to any query shape)

- **429 / 503:** retry with `Retry-After` (fallback: exponential backoff), max 5 attempts, per request. A page that succeeded is never refetched.
- **Failure backoff:** a failed refresh writes `{ at, error }` (error sanitized) to a separate key, `orgTagCountsAttempt`, so it can never clobber or fake a `TagCountCache`. `isStaleCacheOrMissing` stays about data age; the async `shouldAutoRefresh(cache)` additionally suppresses auto-refresh for 15 minutes after a failure that happened *after* the last success. The manual "Refresh Counts" button ignores the cooldown. An unreadable attempt record counts as no failure.
- **Keep the old counts on failure:** a failed refresh must not clobber a good cache. Only a successful fetch overwrites `counts`/`lastUpdated`.
- **Token lifetime:** fetch a fresh token per page, not once per refresh, so long crawls survive token expiry.

### 3. Fallback chain

```
try aggregate (TagNames groupby)
  400 (query rejected)  → fall back to existing paged crawl, log once
  other failure         → retry per §2, then surface error
```

The existing crawl is retained as the fallback rather than deleted. If the probe shows the aggregate is rejected everywhere we care about, the crawl stays primary and only §2 ships.

### 4. Decision rule: full refresh vs. visible-page counts

Because only 25 rows are shown at a time and nothing sorts by count, a second shape fits the data: count only the visible page, on demand.

```
GET .../WorkItems?$apply=filter(Tags/any(t:t/TagName eq '<tag>'))/aggregate($count as Count)
```

25 small parallel requests per page view, results cached per tag with a TTL. Microsoft's Analytics guidance recommends the `Tags` navigation filter for exactly this kind of lookup. It costs nothing at hub open and scales with tags *viewed*, not 50k.

It loses whole-org features: sorting by count, finding unused tags, and counts for tags in a merge/delete selection that span pages (those would query on demand at confirmation time, which is arguably better since it's fresh).

Pick from the probe's reduction ratio `R = tagged items / tag-set groups`:

| Probe result | Choice |
|--------------|--------|
| aggregate rejected | Crawl stays; ship §2 only; evaluate visible-page counts |
| accepted, `R` ≥ ~10 | Ship §1 + §2 (full-refresh cache) |
| accepted, `R` < ~10 | Full refresh remains slow; prefer visible-page counts (§4) + §2, keep the cache only for the sort/unused-tag features if wanted |

The ~10 threshold is a judgment call, not a measured constant: it roughly turns "50 serial pages" into "5", which is where a background refresh stops mattering.

### 5. Cache size mitigation (only if the probe's document size or `setValue` says so)

Shard `orgTagCounts` by first character of the lowercased tag name (the UI's A–Z filter already partitions this way), one document per bucket, with a shared `lastUpdated` manifest. `getCache` reads buckets lazily for the visible filter. Not built unless needed; the probe's serialized size and a real `setValue` attempt decide.

## Diagnostics

An extension has no server-side log, so diagnostics live in the cache document, the UI, and the browser console.

- **Stored stats** (`TagCountCache.stats`, optional so older caches still load): `strategy` (`aggregate` | `crawl`), `requests` (every HTTP request, including retries and a rejected aggregate), `retries`, `rows` (tag-set groups for aggregate, work items for crawl), `durationMs`, and `fallbackReason` when the aggregate was abandoned. Written only on success.
- **UI:** next to "Last updated", a one-line summary, e.g. `Aggregate · 12 requests · 48,210 rows · 8.4s`, or `Crawl (fallback)` when the aggregate was rejected. The tooltip adds throttle retries and the fallback reason. Hidden for caches without stats.
- **Console** (`[TagToolkit]` prefix, `src/utils/debugLog.ts`): `info` once per successful refresh; `warn` on a fallback and on every throttle retry; `error` on a failed refresh.
- **Verbose mode:** run `localStorage.tagToolkitDebug = "1"` in the page console (extension frame) to log every request as `GET <path+query> -> status, rows, ms` with the paging token elided. Per browser, off by default.
- **Never logged:** access tokens, the Authorization header, or response bodies; error text goes through `sanitizeError`. A test asserts this at every log level.

The first thing to check in the field is the "Crawl (fallback)" label: it means the aggregate is being rejected and #17 is not actually fixed.

## Verification gate

Before implementing, run the probe against an org with representative data:

```
ADO_ORG=<org> ADO_PAT=<analytics-read PAT> pnpm tsx scripts/probe-tag-counts.ts
```

It reports, for each variant: request count, rows, payload size, time, 429s, and (when both run) whether aggregate and crawl counts are identical.

| Question | Decides |
|----------|---------|
| Does A1 (filtered) succeed? A2 (unfiltered)? | Query shape; whether fallback is needed |
| Does `L` (original) actually fail, and with what error? | Whether the 2026-04 diagnosis was right |
| Row reduction crawl → aggregate, and singleton-group share | §4 decision rule: full refresh vs. visible-page counts |
| Serialized cache document size | Whether sharding (§5) is required |
| Counts identical? | Correctness of the folding |

A small test org (hundreds of items) will confirm correctness but cannot show the performance win. Treat the row-reduction ratio as the extrapolation basis, and state that limit when reporting.

## Files

| File | Change |
|------|--------|
| `src/services/TagCountCacheService.ts` | Add aggregate fetch + fold; retry helper; keep crawl as fallback; cooldown logic |
| `src/services/TagCountCacheService.test.ts` | Tests: fold (dedupe, case, null), pagination of aggregate, 400→fallback, 429 retry, cooldown, cache preserved on failure |
| `src/types/index.ts` | Unchanged — failure record lives under its own storage key |
| `src/app/TagManagerApp.tsx` | Use `shouldAutoRefresh` on load, not awaited so the table doesn't wait on the extra read |
| `live-test/adoClient.ts` | Optional: `countWorkItemsWithTag` could use the same helper; out of scope unless trivial |
| `scripts/probe-tag-counts.ts` | New, read-only verification probe |

## Non-goals

- Per-tag counting for the whole org (50k requests). Per-*visible-page* counting is in scope as the §4 alternative.
- Parallel partitioned crawl. Revisit only if both aggregate and fallback prove too slow.
- Project-scoped counts. The cache is org-wide by design.

## Open questions

1. Does Analytics honor `groupby` on a string property that is not indexed? (Probe answers.)
1a. Does anyone rely on the full count cache beyond the 25 visible rows (finding unused tags, deciding what to merge)? If yes, §4's visible-page model can't replace it. This is a product question the probe can't answer.
2. Is 15 min the right cooldown? It trades staleness after transient failure against load. Needs no data, just a decision.
3. Does the cache document grow meaningfully with `lastError`? Keep it to a short sanitized string.
