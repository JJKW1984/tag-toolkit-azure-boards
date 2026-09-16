// live-test/types.ts
import { TagItem } from "../src/types";

/** On-disk record of everything one run created, so cleanup survives a crash. */
export interface RunManifest {
  runId: string;
  /** Full org URL, e.g. https://dev.azure.com/myorg */
  org: string;
  project: string;
  status: "in-progress" | "cleaned";
  workItems: number[];
  tags: string[];
}

export interface AbilityResult {
  name: string;
  status: "pass" | "fail";
  durationMs: number;
  /** Failure reason, or a notable observation on pass. Always sanitized. */
  detail?: string;
}

export interface RunReport {
  runId: string;
  org: string;
  project: string;
  startedAt: string;
  finishedAt: string;
  results: AbilityResult[];
}

export interface WorkItemTags {
  id: number;
  tags: string[];
  /**
   * System.Title, when the reader supplied it. Cleanup uses it to prove an id
   * belongs to the harness before deleting it — see `testWorkItemTitle`.
   * Optional so a test double asserting only on tags stays valid.
   */
  title?: string;
}

/**
 * The Azure DevOps surface the abilities depend on. Abilities are written
 * against this interface so they can be unit-tested against an in-memory fake.
 */
export interface IAdoClient {
  listTags(): Promise<TagItem[]>;
  renameTag(tagId: string, newName: string): Promise<TagItem>;
  deleteTag(tagIdOrName: string): Promise<void>;
  /** Work item count for one tag, via the Analytics OData endpoint. */
  countWorkItemsWithTag(tag: string): Promise<number>;
  createWorkItem(type: string, title: string, tags: string[]): Promise<number>;
  getWorkItemTags(ids: number[]): Promise<WorkItemTags[]>;
  setWorkItemTags(id: number, tags: string[]): Promise<void>;
  deleteWorkItem(id: number): Promise<void>;
  queryWorkItemIdsByTag(tag: string): Promise<number[]>;
  queryWorkItemIdsByRunId(runId: string): Promise<number[]>;
  listRunTags(runId: string): Promise<string[]>;
}

export interface AbilityContext {
  client: IAdoClient;
  runId: string;
  /**
   * Creates a work item of the configured type, records it and its tags in the
   * run manifest, and returns its id. Abilities must create work items only
   * through this method — it is what guarantees cleanup can find them.
   */
  createWorkItem(tags: string[], title?: string): Promise<number>;
  /** Records a tag the ability is about to bring into existence by other means. */
  recordTag(name: string): void;
}

export interface Ability {
  name: string;
  run(ctx: AbilityContext): Promise<AbilityResult>;
}

export interface CliOptions {
  mode: "run" | "cleanup" | "cleanup-all";
  /** Required for mode "run". */
  org?: string;
  /** Required for mode "run". */
  project?: string;
  pat: string;
  yes: boolean;
  workItemType: string;
  /** Required for mode "cleanup". */
  manifestPath?: string;
}
