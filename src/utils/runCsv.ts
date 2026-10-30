import { HISTORY_NOTICE, RunReport, reportOutcome, summarizeCard } from "../types/runHistory";

const cell = (value: string): string => {
  const safe = /^[\s\u0000-\u001f]*[=+\-@]/.test(value) || /^[\t\r\n]/.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
};
const tagText = (tags: string[] | null) => tags === null ? "Unknown" : JSON.stringify(tags);

export function runCsv(report: RunReport): string {
  const { run } = report;
  const headers = [
    "Run ID", "Project", "Project ID", "User", "User ID", "Action", "Sources", "Target", "Started", "Ended",
    "Expires", "Run outcome", "Run errors", "Unsaved recovery", "Limitations",
    "Card ID", "Card URL", "Tags before", "Tags after", "Recorded tags added", "Recorded tags removed",
    "Card outcomes", "Verification", "Failure reason", "Change evidence",
  ];
  const context = [
    run.id, run.projectName, run.projectId, run.actor.name, run.actor.id, run.action,
    JSON.stringify(run.sources.map((source) => source.name)), run.target ?? "",
    run.startedAt, run.endedAt ?? "Unknown", run.expiresAt, reportOutcome(run), run.errors.join("; "),
    String(report.unsaved), HISTORY_NOTICE + (run.action === "delete" ? " Pull-request effects are not enumerated." : ""),
  ];
  const rows = report.cards.length ? report.cards.map((card) => {
    const summary = summarizeCard(card);
    return [...context, card.id, cardUrl(report, card.id), tagText(summary.before), tagText(summary.after),
      (summary.uncertain ? "Unknown attempts; known additions: " : "") + JSON.stringify(summary.added),
      (summary.uncertain ? "Unknown attempts; known removals: " : "") + JSON.stringify(summary.removed),
      summary.outcomes, summary.verification,
      summary.errors, JSON.stringify(card.changes)];
  }) : [[...context, "", "", "", "", "", "", "", "", "", "No card records captured. See run outcome and errors."]];
  return "\uFEFF" + [headers, ...rows].map((row) => row.map(cell).join(",")).join("\r\n");
}

export function cardUrl(report: RunReport, id: string): string {
  return `https://dev.azure.com/${encodeURIComponent(report.run.organization)}/${encodeURIComponent(report.run.projectId)}/_workitems/edit/${encodeURIComponent(id)}`;
}
