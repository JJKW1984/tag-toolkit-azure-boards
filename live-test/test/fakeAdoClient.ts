// live-test/test/fakeAdoClient.ts
import { TagItem } from "../../src/types";
import { IAdoClient, WorkItemTags } from "../types";

interface FakeWorkItem {
  id: number;
  tags: string[];
  deleted: boolean;
}

/**
 * In-memory stand-in for Azure DevOps. Models the two behaviors the abilities
 * assert on: deleting a tag cascades it off every work item, and renaming a tag
 * rewrites it in place everywhere.
 */
export class FakeAdoClient implements IAdoClient {
  private nextId = 100;
  private readonly items = new Map<number, FakeWorkItem>();
  /** tag id -> tag name */
  private readonly tags = new Map<string, string>();
  private nextTagId = 1;
  private readonly failures = new Map<string, string>();

  private maybeFail(method: string): void {
    const message = this.failures.get(method);
    if (message) {
      this.failures.delete(method);
      throw new Error(message);
    }
  }

  failNext(method: keyof IAdoClient, message: string): void {
    this.failures.set(method, message);
  }

  seedWorkItem(tags: string[]): number {
    const id = this.nextId++;
    this.items.set(id, { id, tags: [...tags], deleted: false });
    for (const t of tags) this.registerTag(t);
    return id;
  }

  tagNames(): string[] {
    return [...this.tags.values()];
  }

  tagsOf(id: number): string[] {
    const item = this.items.get(id);
    if (!item || item.deleted) return [];
    return [...item.tags];
  }

  private registerTag(name: string): void {
    if (![...this.tags.values()].includes(name)) {
      this.tags.set(String(this.nextTagId++), name);
    }
  }

  private live(): FakeWorkItem[] {
    return [...this.items.values()].filter((i) => !i.deleted);
  }

  async listTags(): Promise<TagItem[]> {
    this.maybeFail("listTags");
    return [...this.tags.entries()].map(([id, name]) => ({ id, name, url: "" }));
  }

  async renameTag(tagId: string, newName: string): Promise<TagItem> {
    this.maybeFail("renameTag");
    const current = this.tags.get(tagId);
    if (!current) throw new Error(`404 no tag ${tagId}`);
    // Deliberately not emulating a merge-on-collision: real ADO's behavior when
    // renaming onto an existing tag name is unverified, and a guessed emulation
    // would be worse than a loud refusal. Refuse instead of creating two
    // registry entries that resolve to the same name — a state real ADO can't be in.
    const collision = [...this.tags.entries()].find(
      ([id, name]) => id !== tagId && name === newName
    );
    if (collision) {
      throw new Error(`409 tag name "${newName}" already in use`);
    }
    this.tags.set(tagId, newName);
    for (const item of this.items.values()) {
      item.tags = item.tags.map((t) => (t === current ? newName : t));
    }
    return { id: tagId, name: newName, url: "" };
  }

  async deleteTag(tagIdOrName: string): Promise<void> {
    this.maybeFail("deleteTag");
    let id = this.tags.has(tagIdOrName) ? tagIdOrName : undefined;
    if (!id) {
      id = [...this.tags.entries()].find(([, name]) => name === tagIdOrName)?.[0];
    }
    if (!id) throw new Error(`404 no tag ${tagIdOrName}`);
    const name = this.tags.get(id) as string;
    this.tags.delete(id);
    for (const item of this.items.values()) {
      item.tags = item.tags.filter((t) => t !== name);
    }
  }

  async countWorkItemsWithTag(tag: string): Promise<number> {
    this.maybeFail("countWorkItemsWithTag");
    return this.live().filter((i) => i.tags.includes(tag)).length;
  }

  async createWorkItem(_type: string, _title: string, tags: string[]): Promise<number> {
    this.maybeFail("createWorkItem");
    return this.seedWorkItem(tags);
  }

  async getWorkItemTags(ids: number[]): Promise<WorkItemTags[]> {
    this.maybeFail("getWorkItemTags");
    if (ids.length === 0) return [];
    // Real getWorkItemsBatch sends no errorPolicy, so ADO's default (Fail)
    // rejects the whole batch if any requested id is missing or deleted —
    // it does not silently return a shorter array.
    for (const id of ids) {
      const item = this.items.get(id);
      if (!item || item.deleted) throw new Error(`404 no work item ${id}`);
    }
    return ids.map((id) => {
      const item = this.items.get(id) as FakeWorkItem;
      return { id: item.id, tags: [...item.tags] };
    });
  }

  async setWorkItemTags(id: number, tags: string[]): Promise<void> {
    this.maybeFail("setWorkItemTags");
    const item = this.items.get(id);
    if (!item || item.deleted) throw new Error(`404 no work item ${id}`);
    item.tags = [...tags];
    for (const t of tags) this.registerTag(t);
  }

  async deleteWorkItem(id: number): Promise<void> {
    this.maybeFail("deleteWorkItem");
    const item = this.items.get(id);
    if (!item) throw new Error(`404 no work item ${id}`);
    item.deleted = true;
  }

  async queryWorkItemIdsByTag(tag: string): Promise<number[]> {
    this.maybeFail("queryWorkItemIdsByTag");
    return this.live()
      .filter((i) => i.tags.includes(tag))
      .map((i) => i.id);
  }
}
