// live-test/adoClient.ts
import { TagItem } from "../src/types";
import { sanitizeError } from "../src/utils/sanitizeError";

export interface AdoClientOptions {
  /** Full org URL, e.g. https://dev.azure.com/myorg */
  orgUrl: string;
  project: string;
  pat: string;
}

/** Azure DevOps Services org URLs are https://dev.azure.com/<org>. */
export function orgNameFromUrl(orgUrl: string): string {
  const match = /^https:\/\/dev\.azure\.com\/([^/]+)\/?$/.exec(orgUrl.trim());
  if (!match) {
    throw new Error(
      `Unsupported org URL "${orgUrl}" — expected https://dev.azure.com/<org>`
    );
  }
  return match[1];
}

export class AdoClient {
  private readonly orgUrl: string;
  private readonly orgName: string;
  private readonly project: string;
  private readonly authHeader: string;

  constructor(opts: AdoClientOptions) {
    this.orgUrl = opts.orgUrl.trim().replace(/\/$/, "");
    this.orgName = orgNameFromUrl(opts.orgUrl);
    this.project = opts.project;
    this.authHeader = `Basic ${Buffer.from(`:${opts.pat}`).toString("base64")}`;
  }

  private async request<T>(
    method: string,
    url: string,
    body?: object
  ): Promise<T | undefined> {
    const res = await fetch(url, {
      method,
      headers: {
        Authorization: this.authHeader,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      throw new Error(sanitizeError(`${method} failed: ${res.status} ${text}`));
    }

    if (res.status === 204) return undefined;
    return (await res.json()) as T;
  }

  private tagsUrl(suffix = ""): string {
    return `${this.orgUrl}/${encodeURIComponent(this.project)}/_apis/wit/tags${suffix}?api-version=7.1`;
  }

  async listTags(): Promise<TagItem[]> {
    const data = await this.request<{ value?: TagItem[] }>("GET", this.tagsUrl());
    return data?.value ?? [];
  }

  async renameTag(tagId: string, newName: string): Promise<TagItem> {
    const updated = await this.request<TagItem>(
      "PATCH",
      this.tagsUrl(`/${encodeURIComponent(tagId)}`),
      { name: newName }
    );
    return updated as TagItem;
  }

  async deleteTag(tagIdOrName: string): Promise<void> {
    await this.request<void>(
      "DELETE",
      this.tagsUrl(`/${encodeURIComponent(tagIdOrName)}`)
    );
  }

  /**
   * Counts work items carrying one tag via Analytics OData. Same endpoint and
   * $expand shape as TagCountCacheService, plus a server-side $filter so a
   * single tag lookup does not page through every tagged item in the org.
   */
  async countWorkItemsWithTag(tag: string): Promise<number> {
    // Only the tag value is arbitrary data; the rest of the query is a
    // literal OData skeleton. Encoding the whole composed string with
    // encodeURI (which deliberately leaves & # $ = ( ) ' : untouched) would
    // let a tag containing & or # forge a query-string boundary or get
    // split off into a URL fragment. Encode just the value instead.
    const escaped = tag.replace(/'/g, "''");
    const query =
      `$select=WorkItemId&$expand=Tags($select=TagName)` +
      `&$filter=Tags/any(t: t/TagName eq '${encodeURIComponent(escaped)}')`;
    let url: string | null =
      `https://analytics.dev.azure.com/${encodeURIComponent(this.orgName)}` +
      `/_odata/v4.0-preview/WorkItems?${query}`;

    let total = 0;
    while (url) {
      // Explicit annotation required: without it, tsc reports TS7022
      // ("'page' implicitly has type 'any' ... referenced ... in its own
      // initializer") because `url` is reassigned from `page` later in this
      // same loop body, and strict-mode control-flow analysis can't resolve
      // page's type without it being stated up front.
      const page: { value?: unknown[]; "@odata.nextLink"?: string } | undefined =
        await this.request<{
          value?: unknown[];
          "@odata.nextLink"?: string;
        }>("GET", url);
      total += page?.value?.length ?? 0;
      url = page?.["@odata.nextLink"] ?? null;
    }
    return total;
  }
}
