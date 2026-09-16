// live-test/adoClient.ts
import * as azdev from "azure-devops-node-api";
import { IWorkItemTrackingApi } from "azure-devops-node-api/WorkItemTrackingApi";
import { TagItem } from "../src/types";
import { sanitizeError } from "../src/utils/sanitizeError";
import { joinTags, parseTags } from "../src/utils/tagString";
import { NotFoundError } from "./errors";
import { liveTestTagPrefix, liveTestWorkItemMarker } from "./naming";
import { IAdoClient, WorkItemTags } from "./types";

export interface AdoClientOptions {
  /** Full org URL, e.g. https://dev.azure.com/myorg */
  orgUrl: string;
  project: string;
  pat: string;
}

const REQUEST_TIMEOUT_MS = 30_000;

/** Azure DevOps Services org URLs are https://dev.azure.com/<org>. */
export function orgNameFromUrl(orgUrl: string): string {
  const match = /^https:\/\/dev\.azure\.com\/([^/]+)\/?$/.exec(orgUrl.trim());
  if (!match) {
    throw new Error("Unsupported org URL — expected https://dev.azure.com/<org>");
  }
  return match[1];
}

export class AdoClient implements IAdoClient {
  private readonly orgUrl: string;
  private readonly orgName: string;
  private readonly project: string;
  private readonly authHeader: string;
  private readonly connection: azdev.WebApi;
  private witApi?: IWorkItemTrackingApi;

  constructor(opts: AdoClientOptions) {
    this.orgUrl = opts.orgUrl.trim().replace(/\/$/, "");
    this.orgName = orgNameFromUrl(opts.orgUrl);
    this.project = opts.project;
    this.authHeader = `Basic ${Buffer.from(`:${opts.pat}`).toString("base64")}`;
    this.connection = new azdev.WebApi(
      this.orgUrl,
      azdev.getPersonalAccessTokenHandler(opts.pat)
    );
  }

  private async withTimeout<T>(
    description: string,
    run: (signal: AbortSignal) => Promise<T>
  ): Promise<T> {
    const controller = new AbortController();
    let timer: NodeJS.Timeout | undefined;
    const timedOut = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error(`${description} timed out after ${REQUEST_TIMEOUT_MS}ms`));
      }, REQUEST_TIMEOUT_MS);
    });

    try {
      return await Promise.race([run(controller.signal), timedOut]);
    } catch (e) {
      if ((e as { name?: string } | null)?.name === "AbortError") {
        throw new Error(`${description} timed out after ${REQUEST_TIMEOUT_MS}ms`);
      }
      throw e;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private async witCall<T>(
    description: string,
    run: (wit: IWorkItemTrackingApi) => Promise<T>
  ): Promise<T> {
    const wit = await this.wit();
    return await this.withTimeout(description, async () => await run(wit));
  }

  private async request<T>(
    method: string,
    url: string,
    body: object | undefined,
    description: string
  ): Promise<T | undefined> {
    const res = await this.withTimeout(description, async (signal) =>
      await fetch(url, {
        method,
        headers: {
          Authorization: this.authHeader,
          "Content-Type": "application/json",
        },
        body: body ? JSON.stringify(body) : undefined,
        signal,
      })
    );

    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      const message = sanitizeError(`${method} failed: ${res.status} ${text}`);
      if (res.status === 404) {
        throw new NotFoundError(
          `${description} returned 404 in project "${this.project}": ${message}`
        );
      }
      throw new Error(message);
    }

    if (res.status === 204) return undefined;

    // A PAT that is wrong, expired, or lacking scope does not reliably get a
    // 401 from Azure DevOps: it characteristically gets HTTP 203 plus an HTML
    // sign-in page, and `res.ok` is true for 203. Handing that to res.json()
    // throws "Unexpected token '<'", which sanitizes down to a fragment that
    // cannot distinguish "your PAT is wrong" from "the API changed shape".
    const contentType = res.headers?.get("content-type") ?? "";
    if (res.status === 203 || !/\bjson\b/i.test(contentType)) {
      throw new Error(
        sanitizeError(
          `${method} returned HTTP ${res.status} with a non-JSON body ` +
            `(content-type: ${contentType || "none"}) — this usually means PAT ` +
            `authentication failed; check the token's validity and scopes`
        )
      );
    }

    return (await res.json()) as T;
  }

  private tagsUrl(suffix = ""): string {
    return `${this.orgUrl}/${encodeURIComponent(this.project)}/_apis/wit/tags${suffix}?api-version=7.1`;
  }

  async listTags(): Promise<TagItem[]> {
    const data = await this.request<{ value?: TagItem[] }>(
      "GET",
      this.tagsUrl(),
      undefined,
      "List tags"
    );
    return data?.value ?? [];
  }

  async renameTag(tagId: string, newName: string): Promise<TagItem> {
    const updated = await this.request<TagItem>(
      "PATCH",
      this.tagsUrl(`/${encodeURIComponent(tagId)}`),
      { name: newName },
      `Rename tag ${tagId}`
    );
    return updated as TagItem;
  }

  async deleteTag(tagIdOrName: string): Promise<void> {
    await this.request<void>(
      "DELETE",
      this.tagsUrl(`/${encodeURIComponent(tagIdOrName)}`),
      undefined,
      `Delete tag ${tagIdOrName}`
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
        }>("GET", url, undefined, `Count work items with tag ${tag}`);
      total += page?.value?.length ?? 0;
      url = page?.["@odata.nextLink"] ?? null;
    }
    return total;
  }

  private async wit(): Promise<IWorkItemTrackingApi> {
    if (!this.witApi) {
      this.witApi = await this.withTimeout(
        "Create Work Item Tracking API client",
        async () => await this.connection.getWorkItemTrackingApi()
      );
    }
    return this.witApi;
  }

  async createWorkItem(type: string, title: string, tags: string[]): Promise<number> {
    const patch = [
      { op: "add", path: "/fields/System.Title", value: title },
      { op: "add", path: "/fields/System.Tags", value: joinTags(tags) },
    ];
    const created = await this.witCall(
      `Create ${type} work item in project "${this.project}"`,
      async (wit) => await wit.createWorkItem(null, patch, this.project, type)
    );
    if (typeof created?.id !== "number") {
      throw new Error(`Creating a ${type} did not return an id`);
    }
    return created.id;
  }

  async getWorkItemTags(ids: number[]): Promise<WorkItemTags[]> {
    if (ids.length === 0) return [];
    const out: WorkItemTags[] = [];
    for (let i = 0; i < ids.length; i += 200) {
      const batch = await this.witCall(
        `Read work item tags in project "${this.project}"`,
        async (wit) =>
          await wit.getWorkItemsBatch(
            // System.Title comes back too: it is the only provenance signal that
            // survives a tag being cascaded off an item, and cleanup needs it.
            { ids: ids.slice(i, i + 200), fields: ["System.Tags", "System.Title"] },
            this.project
          )
      );
      for (const item of batch ?? []) {
        out.push({
          id: item.id as number,
          tags: parseTags((item.fields?.["System.Tags"] as string) ?? ""),
          title: (item.fields?.["System.Title"] as string) ?? "",
        });
      }
    }
    return out;
  }

  async setWorkItemTags(id: number, tags: string[]): Promise<void> {
    await this.witCall(
      `Set work item ${id} tags in project "${this.project}"`,
      async (wit) =>
        await wit.updateWorkItem(
          null,
          [{ op: "add", path: "/fields/System.Tags", value: joinTags(tags) }],
          id,
          this.project
        )
    );
  }

  /** Soft delete — the work item goes to the project Recycle Bin. */
  async deleteWorkItem(id: number): Promise<void> {
    await this.witCall(
      `Delete work item ${id} in project "${this.project}"`,
      async (wit) => await wit.deleteWorkItem(id, this.project)
    );
  }

  async queryWorkItemIdsByTag(tag: string): Promise<number[]> {
    const escaped = tag.replace(/'/g, "''");
    const result = await this.witCall(
      `Query work items by tag in project "${this.project}"`,
      async (wit) =>
        await wit.queryByWiql(
          {
            query:
              `SELECT [System.Id] FROM WorkItems ` +
              `WHERE [System.Tags] CONTAINS '${escaped}' ` +
              `AND [System.TeamProject] = @project ORDER BY [System.Id]`,
          },
          { project: this.project }
        )
    );
    return (result?.workItems ?? []).map((wi) => wi.id as number);
  }

  async queryWorkItemIdsByRunId(runId: string): Promise<number[]> {
    const marker = liveTestWorkItemMarker(runId).replace(/'/g, "''");
    const prefix = liveTestTagPrefix(runId).replace(/'/g, "''");
    const result = await this.witCall(
      `Query run work items in project "${this.project}"`,
      async (wit) =>
        await wit.queryByWiql(
          {
            query:
              `SELECT [System.Id] FROM WorkItems ` +
              `WHERE (` +
              `[System.Title] CONTAINS '${marker}' ` +
              `OR [System.Tags] CONTAINS '${prefix}'` +
              `) AND [System.TeamProject] = @project ORDER BY [System.Id]`,
          },
          { project: this.project }
        )
    );
    return (result?.workItems ?? []).map((wi) => wi.id as number);
  }

  async listRunTags(runId: string): Promise<string[]> {
    const prefix = liveTestTagPrefix(runId);
    return (await this.listTags()).map((tag) => tag.name).filter((tag) => tag.startsWith(prefix));
  }
}
