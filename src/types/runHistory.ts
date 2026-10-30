import { TagItem } from "./index";

export type EditAction = "rename" | "delete" | "merge";
export type RunOutcome = "running" | "completed" | "partial" | "failed" | "incomplete";
export type CardOutcome = "not attempted" | "unknown" | "changed" | "unchanged" | "failed";
export type Verification = "confirmed" | "observed" | "unverified";

export interface RunInfo {
  id: string;
  projectId: string;
  projectName: string;
  organization: string;
  actor: { id: string; name: string };
  action: EditAction;
  sources: TagItem[];
  target?: string;
  startedAt: string;
  updatedAt: string;
  endedAt?: string;
  expiresAt: string;
  outcome: RunOutcome;
  errors: string[];
  capturedCount: number;
}

export interface CardChange {
  source: string;
  attempt?: number;
  before: string[] | null;
  after: string[] | null;
  intendedAfter?: string[];
  outcome: CardOutcome;
  verification: Verification;
  error?: string;
}

export interface CardRecord {
  id: string;
  changes: CardChange[];
}

export interface RunReport {
  run: RunInfo;
  cards: CardRecord[];
  unsaved: boolean;
}

export type MergeEvidence =
  | { kind: "discovered"; ids: number[] }
  | { kind: "card"; id: number; change: Omit<CardChange, "source"> }
  | { kind: "source failed"; error: string };

export class HistoryWriteError extends Error {
  constructor(detail: string) {
    super(`Run recording failed: ${detail}. Further edits stopped. Shared history may be incomplete; download the recovery CSV.`);
    this.name = "HistoryWriteError";
  }
}

export const HISTORY_NOTICE =
  "History is grouped by project, but shared storage is accessible organization-wide to users of this extension, without per-card permission filtering. " +
  "Reports expire 90 days after the run starts; expired data is deleted when this project's history is next accessed. " +
  "Only toolkit work-item changes are reported. Cards acquiring tags after enumeration may be missing. " +
  "Observed differences are not proof of toolkit attribution. Edits and history writes are not atomic. No automatic resume or undo.";

export function reportOutcome(run: RunInfo): string {
  if (run.outcome === "running" && Date.now() - Date.parse(run.updatedAt) > 5 * 60 * 1000) {
    return "inactive / possibly interrupted (may still be running; unfinished outcomes unknown)";
  }
  return run.outcome;
}

export function summarizeCard(card: CardRecord) {
  const changes = card.changes;
  const first = changes.find((change) => change.verification === "confirmed" && change.outcome === "changed") ?? changes[0];
  const last = changes[changes.length - 1];
  const added = new Set<string>();
  const removed = new Set<string>();
  for (const change of changes) {
    if (change.before === null || change.after === null) continue;
    const { before, after } = change;
    after.filter((tag) => !before.includes(tag)).forEach((tag) => added.add(tag));
    before.filter((tag) => !after.includes(tag)).forEach((tag) => removed.add(tag));
  }
  return {
    before: first?.before ?? null,
    after: last?.after ?? null,
    added: [...added],
    removed: [...removed],
    outcomes: [...new Set(changes.map((change) => change.outcome))].join("; "),
    verification: [...new Set(changes.map((change) => change.verification))].join("; "),
    errors: changes.map((change) => change.error).filter(Boolean).join("; "),
    uncertain: changes.some((change) => change.outcome === "unknown"),
  };
}
