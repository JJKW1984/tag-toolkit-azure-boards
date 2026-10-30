// src/services/TagService.ts
import * as SDK from "azure-devops-extension-sdk";
import { getClient } from "azure-devops-extension-api";
import { WorkItemTrackingRestClient } from "azure-devops-extension-api/WorkItemTracking";
import { CommonServiceIds, IProjectPageService } from "azure-devops-extension-api/Common/CommonServices";
import { WorkItem, WorkItemBatchGetRequest } from "azure-devops-extension-api/WorkItemTracking";
import { sanitizeError } from "../utils/sanitizeError";
import { joinTags, parseTags } from "../utils/tagString";
import { HistoryWriteError, MergeEvidence } from "../types/runHistory";
import {
  TagItem,
  TagOperationResult,
  BatchMergeResult,
  MergeSourceResult,
  MergeSourceFailure,
} from "../types";

export class TagService {
  private async getProject(): Promise<string> {
    const svc = await SDK.getService<IProjectPageService>(
      CommonServiceIds.ProjectPageService
    );
    const project = await svc.getProject();
    if (!project) throw new Error("No project context available");
    return project.name;
  }

  async getProjectName(): Promise<string> {
    return this.getProject();
  }

  /** Build an authenticated fetch call to the _apis/wit/tags endpoint */
  private async tagsApiRequest<T>(
    method: string,
    project: string,
    suffix = "",
    body?: object
  ): Promise<T> {
    const token = await SDK.getAccessToken();
    const host = SDK.getHost();
    const org = host.name;
    const url = `https://dev.azure.com/${encodeURIComponent(org)}/${encodeURIComponent(project)}/_apis/wit/tags${suffix}?api-version=7.1`;

    const res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      throw new Error(`Tags API ${method} ${suffix}: ${res.status} ${text}`);
    }

    // DELETE returns 204 No Content with empty body
    if (method === "DELETE") return undefined as unknown as T;

    return res.json() as Promise<T>;
  }

  /**
   * Returns all tags defined in the current project via the Tags API.
   * No work-item counts are included.
   */
  async getAllTags(): Promise<TagItem[]> {
    const project = await this.getProject();
    const data = await this.tagsApiRequest<{ value: TagItem[] }>(
      "GET",
      project
    );
    return (data.value ?? []).sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Deletes a tag from the project by its ID (or name).
   * ADO cascades removal from all work items and PRs automatically.
   */
  async deleteTagById(tagIdOrName: string): Promise<void> {
    const project = await this.getProject();
    await this.tagsApiRequest<void>(
      "DELETE",
      project,
      `/${encodeURIComponent(tagIdOrName)}`
    );
  }

  /**
   * Renames a tag via the Tags API (single call, reflected everywhere).
   */
  async renameTagById(tagId: string, newName: string): Promise<TagItem> {
    const project = await this.getProject();
    return this.tagsApiRequest<TagItem>(
      "PATCH",
      project,
      `/${encodeURIComponent(tagId)}`,
      { name: newName }
    );
  }

  /**
   * Returns the IDs of all work items that contain the given tag in the current project.
   */
  async getWorkItemsWithTag(tag: string): Promise<number[]> {
    const project = await this.getProject();
    const client = getClient(WorkItemTrackingRestClient);
    const escaped = tag.replace(/'/g, "''");
    const result = await client.queryByWiql(
      {
        query: `SELECT [System.Id] FROM WorkItems WHERE [System.Tags] CONTAINS '${escaped}' AND [System.TeamProject] = @project ORDER BY [System.Id]`,
      },
      project
    );
    return (result.workItems ?? []).map((wi) => wi.id);
  }

  async readWorkItemTags(
    ids: number[], onBatch?: (snapshot: Map<number, string[]>) => Promise<void>
  ): Promise<Map<number, string[]>> {
    const project = await this.getProject();
    const client = getClient(WorkItemTrackingRestClient);
    const result = new Map<number, string[]>();
    for (let offset = 0; offset < ids.length; offset += 200) {
      const batch = ids.slice(offset, offset + 200);
      const items = await client.getWorkItemsBatch(
        { ids: batch, fields: ["System.Tags"] } as WorkItemBatchGetRequest, project
      );
      const captured = new Map<number, string[]>();
      for (const id of batch) {
        const item = items.find((entry) => entry.id === id);
        if (!item?.fields) throw new Error(`Couldn't capture tags for work item ${id}`);
        const value: unknown = item.fields["System.Tags"];
        if (value !== undefined && typeof value !== "string") {
          throw new Error(`Invalid tags returned for work item ${id}`);
        }
        const tags = parseTags(value ?? "");
        result.set(id, tags);
        captured.set(id, tags);
      }
      await onBatch?.(captured);
    }
    return result;
  }

  /**
   * Replaces source tags with targetName on the work items found for each source.
   * Each item is revision-checked; the project tag catalog is never deleted from,
   * so items acquiring a source after enumeration retain it for a later merge.
   * A source can be partially processed on failure and safely retried.
   */
  async mergeTags(
    sources: TagItem[],
    targetName: string,
    observe?: (source: string, event: MergeEvidence) => Promise<void>
  ): Promise<BatchMergeResult> {
    const succeeded: MergeSourceResult[] = [];
    const failed: MergeSourceFailure[] = [];

    for (const source of sources) {
      if (source.name.toLowerCase() === targetName.toLowerCase()) continue;
      try {
        const ids = await this.getWorkItemsWithTag(source.name);
        await observe?.(source.name, { kind: "discovered", ids });
        const result = await this.applyTagUpdate(ids, (tags) => {
          if (!tags.some((tag) => tag.toLowerCase() === source.name.toLowerCase())) return tags;
          const remaining = tags.filter((tag) => tag.toLowerCase() !== source.name.toLowerCase());
          return remaining.some((tag) => tag.toLowerCase() === targetName.toLowerCase())
            ? remaining
            : [...remaining, targetName];
        }, observe ? (event) => observe(source.name, event) : undefined);
        succeeded.push({ source, ...result });
      } catch (e) {
        if (e instanceof HistoryWriteError) throw e;
        failed.push({ source, error: sanitizeError(e) });
        await observe?.(source.name, { kind: "source failed", error: sanitizeError(e) });
      }
    }

    return { succeeded, failed };
  }

  /**
   * Single-source convenience wrapper around mergeTags.
   * Throws if the source failed to merge (preserves prior call-site semantics).
   */
  async mergeTag(
    sourceId: string,
    sourceName: string,
    targetName: string
  ): Promise<TagOperationResult> {
    const source: TagItem = { id: sourceId, name: sourceName, url: "" };
    const { succeeded, failed } = await this.mergeTags([source], targetName);
    if (failed.length > 0) {
      throw new Error(failed[0].error);
    }
    // mergeTags skips a source whose name matches the target (case-insensitively), leaving nothing succeeded.
    const { affectedCount, workItemIds } = succeeded[0] ?? { affectedCount: 0, workItemIds: [] };
    return { affectedCount, workItemIds };
  }

  /**
   * Fetches each work item, applies the tag transform, and PATCHes only changed items.
   */
  private async applyTagUpdate(
    workItemIds: number[],
    transform: (tags: string[]) => string[],
    observe?: (event: MergeEvidence) => Promise<void>
  ): Promise<TagOperationResult> {
    if (workItemIds.length === 0) return { affectedCount: 0, workItemIds: [] };

    const project = await this.getProject();
    const client = getClient(WorkItemTrackingRestClient);
    const affectedIds: number[] = [];

    const workItemMap = new Map<number, WorkItem>();
    for (let i = 0; i < workItemIds.length; i += 200) {
      const batch = workItemIds.slice(i, i + 200);
      const workItems = await client.getWorkItemsBatch(
        { ids: batch, fields: ["System.Tags"] } as WorkItemBatchGetRequest,
        project
      );
      for (const wi of workItems) {
        workItemMap.set(wi.id, wi);
      }
    }

    for (const id of workItemIds) {
      let item = workItemMap.get(id);
      for (let retries = 0; ; retries++) {
        if (!item) throw new Error(`Couldn't read work item ${id}; its tags were not updated.`);
        if (!Number.isInteger(item.rev) || item.rev < 1) {
          throw new Error(`Work item ${id} has no valid revision; its tags were not updated.`);
        }
        const original = parseTags((item.fields?.["System.Tags"] as string) ?? "");
        const updated = transform(original);
        const normalizedOriginal = [...new Set(original)].sort().join(";");
        const normalizedUpdated = [...new Set(updated)].sort().join(";");
        if (normalizedOriginal === normalizedUpdated) {
          await observe?.({ kind: "card", id, change: {
            attempt: retries, before: original, after: original, outcome: "unchanged",
            verification: retries > 0 ? "observed" : "confirmed",
          } });
          break;
        }

        await observe?.({ kind: "card", id, change: {
          attempt: retries, before: original, after: null, intendedAfter: updated,
          outcome: "unknown", verification: "unverified",
        } });
        try {
          await client.updateWorkItem(
            [
              { op: "test", path: "/rev", value: item.rev },
              { op: "add", path: "/fields/System.Tags", value: joinTags([...new Set(updated)]) },
            ],
            id,
            project
          );
        } catch (e) {
          await observe?.({ kind: "card", id, change: {
            attempt: retries, before: original, after: null, intendedAfter: updated,
            outcome: "unknown", verification: "unverified",
            error: `${sanitizeError(e)}. The update may have committed without a response.`,
          } });
          if (retries >= 3) throw e;
          const current = await client.getWorkItemsBatch(
            { ids: [id], fields: ["System.Tags"] } as WorkItemBatchGetRequest,
            project
          );
          const latest = current.find((wi) => wi.id === id);
          // A changed revision confirms a concurrent edit without depending on localized API errors.
          if (!latest || latest.rev === item.rev) {
            await observe?.({ kind: "card", id, change: {
              attempt: retries, before: original, after: null, intendedAfter: updated,
              outcome: latest ? "failed" : "unknown", verification: "unverified", error: sanitizeError(e),
            } });
            throw e;
          }
          item = latest;
          continue;
        }
        affectedIds.push(id);
        await observe?.({ kind: "card", id, change: {
          attempt: retries, before: original, after: [...new Set(updated)], outcome: "changed", verification: "confirmed",
        } });
        break;
      }
    }

    return { affectedCount: affectedIds.length, workItemIds: affectedIds };
  }
}
