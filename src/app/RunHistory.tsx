import React, { useEffect, useState } from "react";
import { Button } from "azure-devops-ui/Button";
import { RunHistoryService } from "../services/RunHistoryService";
import { HISTORY_NOTICE, RunInfo, RunReport, reportOutcome, summarizeCard } from "../types/runHistory";
import { cardUrl, runCsv } from "../utils/runCsv";
import { sanitizeError } from "../utils/sanitizeError";

const history = new RunHistoryService();
const PAGE_SIZE = 25;

function downloadRun(report: RunReport): void {
  const url = URL.createObjectURL(new Blob([runCsv(report)], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  try {
    link.href = url;
    link.download = `tag-edit-${report.run.id}${report.unsaved ? "-recovery" : ""}.csv`;
    document.body.appendChild(link);
    link.click();
  } finally {
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

export const RunHistory: React.FC<{ latest: RunReport | null }> = ({ latest }) => {
  const [open, setOpen] = useState(false);
  const [runs, setRuns] = useState<RunInfo[]>([]);
  const [report, setReport] = useState<RunReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(0);
  const [runPage, setRunPage] = useState(0);
  const [, tick] = useState(0);

  useEffect(() => {
    if (!open) return;
    const timer = setInterval(() => tick((value) => value + 1), 30000);
    return () => clearInterval(timer);
  }, [open]);
  useEffect(() => {
    if (latest && report?.run.id === latest.run.id) setReport(latest);
  }, [latest, report?.run.id]);

  const load = async () => {
    setOpen(true);
    setError(null);
    setLoading(true);
    try { setRuns(await history.list()); }
    catch (e) { setError(sanitizeError(e)); }
    finally { setLoading(false); }
  };
  const select = async (id: string) => {
    setError(null);
    setLoading(true);
    try { setReport(await history.read(id)); setPage(0); }
    catch (e) { setReport(null); setError(sanitizeError(e)); }
    finally { setLoading(false); }
  };
  const exportReport = () => {
    if (!report) return;
    try { downloadRun(report); }
    catch (e) { setError(`Couldn't export report: ${sanitizeError(e)}`); }
  };
  const visible = report && Date.parse(report.run.expiresAt) > Date.now() ? report : null;
  const safePage = Math.min(page, Math.max(0, Math.ceil((visible?.cards.length ?? 0) / PAGE_SIZE) - 1));
  const currentRuns = runs.filter((run) => Date.parse(run.expiresAt) > Date.now());
  const safeRunPage = Math.min(runPage, Math.max(0, Math.ceil(currentRuns.length / PAGE_SIZE) - 1));
  const text = (value: string[] | null) => value === null ? "Unknown" : value.length ? value.join("; ") : "(none)";

  return <section className="tm-history" aria-label="Run history">
    <Button text="Run history" onClick={() => void load()} disabled={loading} />
    {latest && Date.parse(latest.run.expiresAt) > Date.now() && <Button text="View latest run" onClick={() => {
      setOpen(true); setReport(latest); setPage(0);
    }} />}
    {latest?.unsaved && <p role="alert">Run recording failed. Further edits stopped; shared history may be incomplete. Open the latest run to download the recovery CSV before leaving this page.</p>}
    {open && <>
      <h2>Run history</h2>
      <p>{HISTORY_NOTICE}</p>
      {error && <p role="alert">{error}</p>}
      {loading && <p role="status">Loading history...</p>}
      {!loading && currentRuns.length === 0 && <p>No saved runs to list. Refresh history to check again.</p>}
      <ul>{currentRuns.slice(safeRunPage * PAGE_SIZE, (safeRunPage + 1) * PAGE_SIZE).map((run) =>
        <li key={run.id}><Button text={`Open ${run.action} run ${run.startedAt} (${run.id})`}
          onClick={() => void select(run.id)} /> {run.actor.name}: {reportOutcome(run)}</li>)}</ul>
      {currentRuns.length > PAGE_SIZE && <nav aria-label="Run list pages">
        <Button text="Previous runs" disabled={safeRunPage === 0} onClick={() => setRunPage(safeRunPage - 1)} />
        <span>Run page {safeRunPage + 1} of {Math.ceil(currentRuns.length / PAGE_SIZE)}</span>
        <Button text="Next runs" disabled={(safeRunPage + 1) * PAGE_SIZE >= currentRuns.length} onClick={() => setRunPage(safeRunPage + 1)} />
      </nav>}
      {visible && <section aria-label="Run report">
        <h3>{visible.run.action} run {visible.run.id}</h3>
        <p>{visible.run.projectName} | {visible.run.actor.name} | {visible.run.startedAt} | {reportOutcome(visible.run)}</p>
        <p>Sources: {visible.run.sources.map((tag) => tag.name).join("; ")}{visible.run.target && ` | Target: ${visible.run.target}`}</p>
        <p>Ended: {visible.run.endedAt ?? "Unknown"} | Expires: {visible.run.expiresAt}</p>
        {visible.run.action === "delete" && <p>Pull-request effects are not enumerated.</p>}
        <p>Before uses the first direct-update baseline when available, otherwise the first captured state. After is the last captured result. Recorded differences can include other users' edits when observed. Unknown attempts remain in the evidence even after a successful retry.</p>
        {visible.unsaved && <p role="alert">Recovery report: includes results not saved to shared history.</p>}
        {visible.run.errors.map((message, index) => <p key={index}>{message}</p>)}
        <Button text={visible.unsaved ? "Download recovery CSV" : "Export run to CSV"} onClick={exportReport} />
        {visible.cards.length === 0 ? <p>No card records captured. The run may have matched no cards or failed before capture; see its outcome and errors.</p> :
          <div className="tm-history-scroll"><table>
            <thead><tr>{["Card", "Tags before", "Tags after", "Recorded tags added", "Recorded tags removed", "Outcome", "Verification", "Failure reason", "Evidence"].map((heading) => <th key={heading} scope="col">{heading}</th>)}</tr></thead>
            <tbody>{visible.cards.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE).map((card) => {
              const summary = summarizeCard(card);
              return <tr key={card.id}><td><a href={cardUrl(visible, card.id)} target="_blank" rel="noopener noreferrer">{card.id}</a></td>
                <td>{text(summary.before)}</td><td>{text(summary.after)}</td>
                <td>{summary.uncertain ? `Unknown attempts; known additions: ${text(summary.added)}` : text(summary.added)}</td>
                <td>{summary.uncertain ? `Unknown attempts; known removals: ${text(summary.removed)}` : text(summary.removed)}</td>
                <td>{summary.outcomes}</td><td>{summary.verification}</td><td>{summary.errors}</td>
                <td><details><summary>Change evidence</summary>{card.changes.map((change, index) =>
                  <p key={index}>{change.source}{change.attempt !== undefined ? ` (attempt ${change.attempt + 1})` : ""}: {text(change.before)} → {text(change.after)} ({change.outcome}, {change.verification}) {change.error}
                    {change.intendedAfter && ` Intended tags (not verified): ${text(change.intendedAfter)}`}</p>)}</details></td></tr>;
            })}</tbody>
          </table></div>}
        {visible.cards.length > PAGE_SIZE && <nav aria-label="Report pages">
          <Button text="Previous cards" disabled={safePage === 0} onClick={() => setPage(safePage - 1)} />
          <span>Card page {safePage + 1} of {Math.ceil(visible.cards.length / PAGE_SIZE)}</span>
          <Button text="Next cards" disabled={(safePage + 1) * PAGE_SIZE >= visible.cards.length} onClick={() => setPage(safePage + 1)} />
        </nav>}
      </section>}
    </>}
  </section>;
};
