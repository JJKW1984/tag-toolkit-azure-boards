import { TagService } from "./TagService";
import { RunHistoryService, RunRecorder } from "./RunHistoryService";
import { TagItem } from "../types";
import { HistoryWriteError, RunReport } from "../types/runHistory";
import { sanitizeError } from "../utils/sanitizeError";

export class TagEditService {
  constructor(private readonly tags: TagService, private readonly history = new RunHistoryService()) {}

  private async start(
    action: "merge" | "rename" | "delete", sources: TagItem[], target: string | undefined,
    onReport: (report: RunReport) => void
  ): Promise<RunRecorder> {
    const recorder = await this.history.begin(action, sources, target);
    recorder.onChange = onReport;
    onReport(recorder.report());
    return recorder;
  }

  private async snapshot(run: RunRecorder, sources: TagItem[]): Promise<Map<number, string[]>> {
    const ids = new Set<number>();
    for (const source of sources) {
      for (const id of await this.tags.getWorkItemsWithTag(source.name)) ids.add(id);
    }
    return this.tags.readWorkItemTags([...ids], async (batch) => {
      for (const [id, before] of batch) {
        for (const source of sources) {
          if (!before.some((tag) => tag.toLowerCase() === source.name.toLowerCase())) continue;
          await run.card(id, { source: source.name, before, after: null, outcome: "not attempted", verification: "unverified" });
        }
      }
    });
  }

  private async observe(
    run: RunRecorder, source: TagItem, before: Map<number, string[]>, operationError?: string
  ): Promise<Map<number, string[]>> {
    const observedTags = new Map<number, string[]>();
    const ids = [...before.keys()];
    for (let offset = 0; offset < ids.length; offset += 200) {
      const batch = ids.slice(offset, offset + 200);
      let after: Map<number, string[]>;
      try {
        after = await this.tags.readWorkItemTags(batch);
      } catch (error) {
        await run.error(`Verification failed: ${sanitizeError(error)}`);
        for (const id of batch) {
          await run.card(id, { source: source.name, before: before.get(id)!, after: null,
            outcome: operationError ? "failed" : "unknown", verification: "unverified",
            error: [operationError, sanitizeError(error)].filter(Boolean).join("; ") });
        }
        continue;
      }
      for (const id of batch) {
        const original = before.get(id)!;
        const observed = after.get(id)!;
        observedTags.set(id, observed);
        const changed = JSON.stringify([...original].sort()) !== JSON.stringify([...observed].sort());
        await run.card(id, { source: source.name, before: original, after: observed,
          outcome: operationError ? "failed" : changed ? "changed" : "unchanged",
          verification: "observed", error: operationError });
      }
    }
    return observedTags;
  }

  async rename(source: TagItem, target: string, onReport: (report: RunReport) => void): Promise<TagItem> {
    const run = await this.start("rename", [source], target, onReport);
    try {
      const snapshot = await this.snapshot(run, [source]);
      for (const [id, before] of snapshot) {
        await run.card(id, { source: source.name, before, after: null, outcome: "unknown", verification: "unverified" });
      }

      let result: TagItem;
      try {
        result = await this.tags.renameTagById(source.id, target);
      } catch (error) {
        const message = sanitizeError(error);
        await run.error(message);
        await this.observe(run, source, snapshot, message);
        await run.finish("failed");
        throw error;
      }
      await this.observe(run, source, snapshot);
      await run.finish(run.run.errors.length ? "partial" : "completed");
      return result;
    } catch (error) {
      if (!(error instanceof HistoryWriteError) && run.run.outcome === "running") {
        await run.error(sanitizeError(error));
        await run.finish("failed");
      }
      throw error;
    }
  }

  async delete(
    sources: TagItem[], onReport: (report: RunReport) => void,
    onDeleted: (tag: TagItem) => void, onProgress: (done: number) => void
  ) {
    const run = await this.start("delete", sources, undefined, onReport);
    const deleted: TagItem[] = [];
    const failed: { tag: TagItem; error: string }[] = [];
    try {
      const snapshot = await this.snapshot(run, sources);
      const current = new Map(snapshot);
      for (const source of sources) {
        const affected = new Map([...snapshot].filter(([, tags]) =>
          tags.some((tag) => tag.toLowerCase() === source.name.toLowerCase()))
          .map(([id]) => [id, current.get(id)!]));
        for (const [id, before] of affected) {
          await run.card(id, { source: source.name, before, after: null, outcome: "unknown", verification: "unverified" });
        }
        let operationError: string | undefined;
        try {
          await this.tags.deleteTagById(source.id);
          deleted.push(source);
          onDeleted(source);
        } catch (error) {
          operationError = sanitizeError(error);
          failed.push({ tag: source, error: operationError });
          await run.error(`${source.name}: ${operationError}`);
        }
        for (const [id, observed] of await this.observe(run, source, affected, operationError)) {
          current.set(id, observed);
        }
        onProgress(deleted.length + failed.length);
      }
      await run.finish(failed.length ? deleted.length ? "partial" : "failed" : run.run.errors.length ? "partial" : "completed");
      return { deleted, failed };
    } catch (error) {
      if (!(error instanceof HistoryWriteError)) {
        await run.error(sanitizeError(error));
        await run.finish("incomplete");
      }
      throw error;
    }
  }

  async merge(sources: TagItem[], target: string, onReport: (report: RunReport) => void) {
    const run = await this.start("merge", sources, target, onReport);
    try {
      const result = await this.tags.mergeTags(sources, target, async (source, event) => {
        if (event.kind === "discovered") {
          for (const id of event.ids) {
            await run.card(id, { source, before: null, after: null, outcome: "not attempted", verification: "unverified" });
          }
        } else if (event.kind === "card") {
          await run.card(event.id, { source, ...event.change });
        } else {
          await run.error(`${source}: ${event.error}`);
        }
      });
      const changed = run.report().cards.some((card) => card.changes.some((change) => change.outcome === "changed"));
      const uncertain = run.report().cards.some((card) => card.changes.some((change) => change.outcome === "unknown"));
      await run.finish(result.failed.length === 0 ? uncertain ? "partial" : "completed" : changed || result.succeeded.length > 0 ? "partial" : "failed");
      return result;
    } catch (error) {
      if (!(error instanceof HistoryWriteError)) {
        await run.error(sanitizeError(error));
        await run.finish("incomplete");
      }
      throw error;
    }
  }
}
