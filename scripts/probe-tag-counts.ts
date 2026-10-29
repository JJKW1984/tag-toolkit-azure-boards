// scripts/probe-tag-counts.ts
//
// Read-only probe for issue #17. Compares the server-side TagNames aggregation
// against the current paged $expand crawl on a real org, so the design in
// docs/superpowers/specs/2026-10-25-tag-count-aggregation-design.md rests on
// measurements rather than assumptions.
//
//   ADO_ORG=myorg ADO_PAT=... pnpm tsx scripts/probe-tag-counts.ts [--skip-crawl]
//
// The PAT comes from the environment, not argv, so it cannot land in shell
// history or process listings. It needs "Analytics (read)" only. Nothing is
// written to the org.
import { parseTags } from "../src/utils/tagString";
import { sanitizeError } from "../src/utils/sanitizeError";

const org = process.env.ADO_ORG;
const pat = process.env.ADO_PAT;
if (!org || !pat) {
  console.error("Set ADO_ORG (org name, not URL) and ADO_PAT.");
  process.exit(2);
}
const skipCrawl = process.argv.includes("--skip-crawl");

const BASE = `https://analytics.dev.azure.com/${encodeURIComponent(org)}/_odata/v4.0-preview/WorkItems`;
const auth = `Basic ${Buffer.from(`:${pat}`).toString("base64")}`;

interface Page {
  value?: Array<Record<string, unknown>>;
  "@odata.nextLink"?: string;
}

interface RunStats {
  label: string;
  ok: boolean;
  requests: number;
  rows: number;
  bytes: number;
  ms: number;
  retries429: number;
  error?: string;
  counts?: Record<string, number>;
}

async function getPage(url: string, stats: RunStats): Promise<Page> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { headers: { Authorization: auth } });
    if (res.status === 429 && attempt < 5) {
      stats.retries429++;
      const waitS = Number(res.headers.get("retry-after")) || 2 ** attempt;
      await new Promise((r) => setTimeout(r, waitS * 1000));
      continue;
    }
    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
    }
    const text = await res.text();
    stats.requests++;
    stats.bytes += text.length;
    return JSON.parse(text) as Page;
  }
}

async function run(
  label: string,
  query: string,
  fold: (rows: Array<Record<string, unknown>>, counts: Record<string, number>) => void
): Promise<RunStats> {
  const stats: RunStats = { label, ok: false, requests: 0, rows: 0, bytes: 0, ms: 0, retries429: 0 };
  const counts: Record<string, number> = {};
  const started = Date.now();
  try {
    let url: string | null = `${BASE}?${query}`;
    while (url) {
      const page: Page = await getPage(url, stats);
      const rows = page.value ?? [];
      stats.rows += rows.length;
      fold(rows, counts);
      url = page["@odata.nextLink"] ?? null;
    }
    stats.ok = true;
    stats.counts = counts;
  } catch (e) {
    stats.error = sanitizeError(e);
  }
  stats.ms = Date.now() - started;
  return stats;
}

// Shape of the tag-set distribution, filled in while folding. Row reduction
// hinges on how many work items share a combination; with a long tail of rare
// tags, most combinations can be singletons and the aggregate saves little.
const comboShape = { combos: 0, singletons: 0, maxTagsPerItem: 0 };

const foldTagNames = (rows: Array<Record<string, unknown>>, counts: Record<string, number>) => {
  for (const row of rows) {
    const n = Number(row.Count ?? 0);
    comboShape.combos++;
    if (n === 1) comboShape.singletons++;
    comboShape.maxTagsPerItem = Math.max(
      comboShape.maxTagsPerItem,
      parseTags(String(row.TagNames ?? "")).length
    );
    // A tag appearing twice in one combination (case variants) counts once per work item.
    const unique = new Set(parseTags(String(row.TagNames ?? "")).map((t) => t.toLowerCase()));
    for (const tag of unique) counts[tag] = (counts[tag] ?? 0) + n;
  }
};

const foldExpand = (rows: Array<Record<string, unknown>>, counts: Record<string, number>) => {
  for (const row of rows) {
    const tags = (row.Tags as Array<{ TagName: string | null }> | null) ?? [];
    for (const t of tags) {
      if (t?.TagName) {
        const name = t.TagName.toLowerCase();
        counts[name] = (counts[name] ?? 0) + 1;
      }
    }
  }
};

const foldLegacy = (rows: Array<Record<string, unknown>>, counts: Record<string, number>) => {
  for (const row of rows) {
    const name = (row.Tags as { TagName?: string } | null)?.TagName;
    if (name) counts[name.toLowerCase()] = Number(row.Count ?? 0);
  }
};

function report(s: RunStats): void {
  const kb = (s.bytes / 1024).toFixed(0);
  console.log(
    `${s.ok ? "OK  " : "FAIL"} ${s.label}\n` +
      `     requests=${s.requests} rows=${s.rows} payload=${kb}KB time=${s.ms}ms 429s=${s.retries429}` +
      (s.error ? `\n     error: ${s.error}` : "")
  );
}

function diff(a: Record<string, number>, b: Record<string, number>): string[] {
  const out: string[] = [];
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if ((a[k] ?? 0) !== (b[k] ?? 0)) out.push(`${k}: aggregate=${a[k] ?? 0} crawl=${b[k] ?? 0}`);
  }
  return out;
}

async function main(): Promise<void> {
  console.log(`Probing org "${org}" (read-only)\n`);

  // Variants of the TagNames aggregation, tried in order of preference.
  const filtered = await run(
    "A1 groupby TagNames (filtered)",
    "$apply=filter(TagNames ne null)/groupby((TagNames),aggregate($count as Count))",
    foldTagNames
  );
  report(filtered);
  const unfiltered = filtered.ok
    ? undefined
    : await run(
        "A2 groupby TagNames (unfiltered)",
        "$apply=groupby((TagNames),aggregate($count as Count))",
        foldTagNames
      );
  if (unfiltered) report(unfiltered);

  // Evidence for the historical failure in commit b64c3bc.
  report(
    await run(
      "L  groupby Tags/TagName (original, expected to fail)",
      "$apply=groupby((Tags/TagName),aggregate($count as Count))",
      foldLegacy
    )
  );

  const aggregate = [filtered, unfiltered].find((s) => s?.ok);

  // Cardinality: how much does grouping by tag set actually collapse?
  if (aggregate?.counts) {
    let taggedItems = 0;
    const tagged = await run(
      "C  tagged work item count",
      "$apply=filter(TagNames ne null)/aggregate($count as Count)",
      (rows) => {
        taggedItems = Number(rows[0]?.Count ?? 0);
      }
    );
    report(tagged);
    const distinctTags = Object.keys(aggregate.counts).length;
    const cacheBytes = Buffer.byteLength(
      JSON.stringify({ counts: aggregate.counts, lastUpdated: new Date().toISOString() })
    );
    console.log(
      `\nCardinality\n` +
        `     tagged items=${taggedItems} tag-set groups=${comboShape.combos} ` +
        `reduction=${comboShape.combos ? (taggedItems / comboShape.combos).toFixed(1) : "n/a"}x\n` +
        `     singleton groups=${comboShape.singletons} ` +
        `(${comboShape.combos ? Math.round((100 * comboShape.singletons) / comboShape.combos) : 0}% of groups)\n` +
        `     max tags on one item=${comboShape.maxTagsPerItem} distinct tags=${distinctTags}\n` +
        `     serialized cache document=${(cacheBytes / 1024).toFixed(0)}KB`
    );
  }

  if (skipCrawl) {
    console.log("\n--skip-crawl: not comparing against the current crawl.");
    return;
  }

  const crawl = await run(
    "B  current crawl ($expand=Tags, paged)",
    "$select=WorkItemId&$expand=Tags($select=TagName)&$filter=Tags/any()",
    foldExpand
  );
  report(crawl);

  if (aggregate?.counts && crawl.counts) {
    const mismatches = diff(aggregate.counts, crawl.counts);
    console.log(
      `\nTags: aggregate=${Object.keys(aggregate.counts).length} crawl=${Object.keys(crawl.counts).length}`
    );
    console.log(
      mismatches.length === 0
        ? "Counts identical."
        : `Counts differ for ${mismatches.length} tags:\n  ${mismatches.slice(0, 20).join("\n  ")}`
    );
    console.log(`Row reduction: ${crawl.rows} -> ${aggregate.rows}`);
  }
}

main().catch((e) => {
  console.error(sanitizeError(e));
  process.exit(1);
});
