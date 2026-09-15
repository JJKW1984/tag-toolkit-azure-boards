// src/services/TagService.ts
import * as SDK from "azure-devops-extension-sdk";
import { getClient } from "azure-devops-extension-api";
import { WorkItemTrackingRestClient } from "azure-devops-extension-api/WorkItemTracking";
import { CommonServiceIds, IProjectPageService } from "azure-devops-extension-api/Common/CommonServices";
import { WorkItemBatchGetRequest } from "azure-devops-extension-api/WorkItemTracking";
import { sanitizeError } from "../utils/sanitizeError";
import { joinTags, parseTags } from "../utils/tagString";
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

  /**
   * Merges one or more source tags into targetName, atomically:
   * Phase 1 (additive) — add targetName to every affected work item across ALL
   *   sources; nothing is removed.
   * Phase 2 (destructive) — delete only the source tags whose additions all
   *   succeeded. ADO cascades each delete to strip that source tag everywhere.
   * Sources that hit any failure are returned in `failed` (not deleted) for retry.
   */
  async mergeTags(
    sources: TagItem[],
    targetName: string
  ): Promise<BatchMergeResult> {
    const addTarget = (tags: string[]): string[] =>
      tags.some((t) => t.toLowerCase() === targetName.toLowerCase())
        ? tags
        : [...tags, targetName];

    const succeeded: MergeSourceResult[] = [];
    const failed: MergeSourceFailure[] = [];

    // Phase 1 — additive across the whole batch (no deletes yet).
    for (const source of sources) {
      try {
        const ids = await this.getWorkItemsWithTag(source.name);
        const result = await this.applyTagUpdate(ids, addTarget);
        succeeded.push({ source, ...result });
      } catch (e) {
        failed.push({ source, error: sanitizeError(e) });
      }
    }

    // Phase 2 — delete only sources whose additions fully succeeded.
    for (const entry of [...succeeded]) {
      try {
        await this.deleteTagById(entry.source.id);
      } catch (e) {
        // Additions done but delete failed: treat as failed (retry is idempotent).
        succeeded.splice(succeeded.indexOf(entry), 1);
        failed.push({ source: entry.source, error: sanitizeError(e) });
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
    const { affectedCount, workItemIds } = succeeded[0];
    return { affectedCount, workItemIds };
  }

  /**
   * Fetches each work item, applies the tag transform, and PATCHes only changed items.
   */
  private async applyTagUpdate(
    workItemIds: number[],
    transform: (tags: string[]) => string[]
  ): Promise<TagOperationResult> {
    if (workItemIds.length === 0) return { affectedCount: 0, workItemIds: [] };

    const project = await this.getProject();
    const client = getClient(WorkItemTrackingRestClient);
    const affectedIds: number[] = [];

    const workItemMap = new Map<number, string>();
    for (let i = 0; i < workItemIds.length; i += 200) {
      const batch = workItemIds.slice(i, i + 200);
      const workItems = await client.getWorkItemsBatch(
        { ids: batch, fields: ["System.Tags"] } as WorkItemBatchGetRequest,
        project
      );
      for (const wi of workItems) {
        workItemMap.set(wi.id, (wi.fields?.["System.Tags"] as string) ?? "");
      }
    }

    for (const [id, rawTags] of workItemMap.entries()) {
      const original = parseTags(rawTags);
      const updated = transform(original);
      const normalizedOriginal = [...new Set(original)].sort().join(";");
      const normalizedUpdated = [...new Set(updated)].sort().join(";");
      if (normalizedOriginal === normalizedUpdated) continue;

      await client.updateWorkItem(
        [{ op: "add", path: "/fields/System.Tags", value: joinTags([...new Set(updated)]) }],
        id,
        project
      );
      affectedIds.push(id);
    }

    return { affectedCount: affectedIds.length, workItemIds: affectedIds };
  }
}
