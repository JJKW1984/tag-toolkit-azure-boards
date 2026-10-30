import * as SDK from "azure-devops-extension-sdk";
import { CommonServiceIds, IExtensionDataService, IProjectPageService } from "azure-devops-extension-api/Common/CommonServices";
import { TagItem } from "../types";
import { CardChange, CardRecord, EditAction, HistoryWriteError, RunInfo, RunOutcome, RunReport } from "../types/runHistory";
import { sanitizeError } from "../utils/sanitizeError";

const RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
const MAX_DOCUMENT_BYTES = 32 * 1024;
const COLLECTION_LIMIT = 100000;
type Document = { id: string; __etag?: number; payload: string };

function document(id: string, value: unknown, etag?: number): Document {
  const doc = { id, payload: JSON.stringify(value), ...(etag === undefined ? {} : { __etag: etag }) };
  // An application safety bound, not a claim about a platform quota.
  if (new Blob([JSON.stringify(doc)]).size > MAX_DOCUMENT_BYTES) {
    throw new Error("Report document exceeds the 32 KiB safety limit; no data was truncated");
  }
  return doc;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function decode<T>(doc: unknown, valid: (value: unknown) => value is T): { value: T; etag: number } {
  if (!isObject(doc) || typeof doc.payload !== "string" || typeof doc.__etag !== "number") {
    throw new Error("Invalid history document");
  }
  const value: unknown = JSON.parse(doc.payload);
  if (!valid(value)) throw new Error("Invalid history record");
  return { value, etag: doc.__etag };
}

const strings = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string");
const tags = (value: unknown): value is string[] | null => value === null || strings(value);
function isRun(value: unknown): value is RunInfo {
  return isObject(value) &&
    ["id", "projectId", "projectName", "organization", "startedAt", "updatedAt", "expiresAt"].every((key) => typeof value[key] === "string") &&
    ["startedAt", "updatedAt", "expiresAt"].every((key) => Number.isFinite(Date.parse(String(value[key])))) &&
    (value.endedAt === undefined || (typeof value.endedAt === "string" && Number.isFinite(Date.parse(value.endedAt)))) &&
    isObject(value.actor) && typeof value.actor.id === "string" && typeof value.actor.name === "string" &&
    ["rename", "delete", "merge"].includes(String(value.action)) &&
    ["running", "completed", "partial", "failed", "incomplete"].includes(String(value.outcome)) &&
    Array.isArray(value.sources) && value.sources.every((tag) =>
      isObject(tag) && typeof tag.id === "string" && typeof tag.name === "string" && typeof tag.url === "string") &&
    (value.target === undefined || typeof value.target === "string") &&
    strings(value.errors) && Number.isInteger(value.capturedCount) && Number(value.capturedCount) >= 0;
}
function isCard(value: unknown): value is CardRecord {
  return isObject(value) && typeof value.id === "string" && /^\d+$/.test(value.id) &&
    Array.isArray(value.changes) && value.changes.length > 0 && value.changes.every((change) =>
      isObject(change) && typeof change.source === "string" && tags(change.before) && tags(change.after) &&
      (change.attempt === undefined || (Number.isInteger(change.attempt) && Number(change.attempt) >= 0)) &&
      (change.intendedAfter === undefined || strings(change.intendedAfter)) &&
      ["not attempted", "unknown", "changed", "unchanged", "failed"].includes(String(change.outcome)) &&
      ["confirmed", "observed", "unverified"].includes(String(change.verification)) &&
      (change.error === undefined || typeof change.error === "string"));
}

async function manager() {
  const service = await SDK.getService<IExtensionDataService>(CommonServiceIds.ExtensionDataService);
  return service.getExtensionDataManager(SDK.getExtensionContext().id, await SDK.getAccessToken());
}

function missingCollection(error: unknown): boolean {
  return isObject(error) && (error.status === 404 || error.statusCode === 404);
}

async function allDocuments(collection: string): Promise<unknown[]> {
  const data = await manager();
  let docs: unknown[];
  try {
    docs = await data.getDocuments(collection);
  } catch (error) {
    if (missingCollection(error)) return [];
    throw error;
  }
  if (docs.length >= COLLECTION_LIMIT) {
    throw new Error("History collection reached the platform retrieval limit; the report cannot be read completely");
  }
  return docs;
}

const runsCollection = (projectId: string) => `tagEditRuns-${projectId}`;
const cardsCollection = (runId: string) => `tagEditCards-${runId}`;

async function removeExpiredDocument(collection: string, id: string): Promise<void> {
  const data = await manager();
  try {
    await data.deleteDocument(collection, id);
  } catch (error) {
    if (!missingCollection(error)) throw error;
  }
}

export class RunHistoryService {
  async project() {
    const service = await SDK.getService<IProjectPageService>(CommonServiceIds.ProjectPageService);
    const project = await service.getProject();
    if (!project?.id || !project.name) throw new Error("No stable project context available for history");
    return project;
  }

  async list(): Promise<RunInfo[]> {
    const project = await this.project();
    const docs = await allDocuments(runsCollection(project.id));
    const result: RunInfo[] = [];
    for (const doc of docs) {
      const { value: run } = decode(doc, isRun);
      if (run.projectId !== project.id) throw new Error("History project mismatch");
      if (Date.parse(run.expiresAt) <= Date.now()) {
        for (const card of await allDocuments(cardsCollection(run.id))) {
          const { value } = decode(card, isCard);
          await removeExpiredDocument(cardsCollection(run.id), value.id);
        }
        await removeExpiredDocument(runsCollection(project.id), run.id);
      } else {
        result.push(run);
      }
    }
    return result.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }

  async read(id: string): Promise<RunReport> {
    const project = await this.project();
    const data = await manager();
    const { value: run } = decode(await data.getDocument(runsCollection(project.id), id), isRun);
    if (run.projectId !== project.id) throw new Error("History project mismatch");
    if (Date.parse(run.expiresAt) <= Date.now()) throw new Error("This run has expired");
    const cards = (await allDocuments(cardsCollection(id))).map((doc) => decode(doc, isCard).value);
    if (cards.length < run.capturedCount) throw new Error("History is missing captured card records");
    return { run, cards: cards.sort((a, b) => Number(a.id) - Number(b.id)), unsaved: false };
  }

  async begin(action: EditAction, sources: TagItem[], target?: string): Promise<RunRecorder> {
    await this.list();
    const project = await this.project();
    const user = SDK.getUser();
    if (!user?.id || !user.displayName) throw new Error("No initiating user identity available");
    const now = new Date();
    const random = new Uint32Array(4);
    crypto.getRandomValues(random);
    const id = [...random].map((part) => part.toString(16).padStart(8, "0")).join("");
    const run: RunInfo = {
      id, action, sources, target, projectId: project.id, projectName: project.name,
      organization: SDK.getHost().name, actor: { id: user.id, name: user.displayName },
      startedAt: now.toISOString(), updatedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + RETENTION_MS).toISOString(),
      outcome: "running", errors: [], capturedCount: 0,
    };
    const data = await manager();
    const { etag } = decode(await data.createDocument(runsCollection(project.id), document(id, run)), isRun);
    return new RunRecorder(run, etag);
  }
}

export class RunRecorder {
  private readonly cards = new Map<string, CardRecord>();
  private readonly cardEtags = new Map<string, number>();
  private unsaved = false;
  onChange?: (report: RunReport) => void;

  constructor(readonly run: RunInfo, private etag: number) {}

  report(): RunReport {
    return {
      run: { ...this.run, errors: [...this.run.errors] },
      cards: [...this.cards.values()].map((card) => ({ ...card, changes: [...card.changes] })),
      unsaved: this.unsaved,
    };
  }

  private async write(operation: () => Promise<void>): Promise<void> {
    if (this.unsaved) throw new HistoryWriteError("Previous history write did not complete");
    try {
      await operation();
    } catch (error) {
      this.unsaved = true;
      this.run.outcome = "incomplete";
      this.run.errors.push(sanitizeError(error));
      throw new HistoryWriteError(sanitizeError(error));
    } finally {
      this.onChange?.(this.report());
    }
  }

  async checkpoint(): Promise<void> {
    await this.write(async () => {
      this.run.updatedAt = new Date().toISOString();
      this.run.capturedCount = this.cards.size;
      const data = await manager();
      const result = await data.updateDocument(
        runsCollection(this.run.projectId), document(this.run.id, this.run, this.etag)
      );
      this.etag = decode(result, isRun).etag;
    });
  }

  async card(id: number, change: CardChange): Promise<void> {
    const key = String(id);
    const previous = this.cards.get(key);
    const changes = [...(previous?.changes ?? [])];
    // Replace the pending result of this source, but preserve other source attempts.
    const index = changes.findIndex((entry) =>
      entry.source === change.source && (entry.attempt ?? 0) === (change.attempt ?? 0));
    if (index >= 0) changes[index] = change;
    else changes.push(change);
    const card = { id: key, changes };
    this.cards.set(key, card);
    await this.write(async () => {
      if (this.cards.size >= COLLECTION_LIMIT) {
        throw new Error("Run reached the platform collection retrieval limit; no card records were truncated");
      }
      const data = await manager();
      const etag = this.cardEtags.get(key);
      const doc = document(key, card, etag);
      const result = etag === undefined
        ? await data.createDocument(cardsCollection(this.run.id), doc)
        : await data.updateDocument(cardsCollection(this.run.id), doc);
      this.cardEtags.set(key, decode(result, isCard).etag);
    });
    await this.checkpoint();
  }

  async error(message: string): Promise<void> {
    this.run.errors.push(message);
    await this.checkpoint();
  }

  async finish(outcome: RunOutcome): Promise<void> {
    this.run.outcome = outcome;
    this.run.endedAt = new Date().toISOString();
    await this.checkpoint();
  }
}
