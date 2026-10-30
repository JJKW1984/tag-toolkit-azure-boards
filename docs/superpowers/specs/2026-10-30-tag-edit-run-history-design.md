# Tag Edit Run History - Design Spec

**Date:** 2026-10-30
**Status:** Product scope approved; self-contained storage amendments approved during implementation

## Purpose

Provide a human-readable record of the tags the toolkit changed on each
work-item card during each run. Users can inspect the record in a UI table
and download the entire run as CSV.

This is a change-reporting feature, not a compliance-grade audit trail or
an automatic undo facility. The report must communicate the limits of its
evidence rather than imply that every observed difference was caused by
the toolkit.

The initial scope was confirmed during the design interview. The user
subsequently authorized implementation through issue #46 and explicitly
approved the self-contained storage amendments below.

### Approved storage amendments

Microsoft's extension-data service supports collection-wide or per-user
storage, not project-authorized shared collections or a documented TTL
facility. The user approved keeping the extension self-contained:

- Project grouping is a UI/data organization convention, not a storage
  authorization boundary. Shared data is accessible organization-wide to
  users of this extension.
- Runs expire 90 days after starting and are hidden at that boundary.
  Physical cleanup occurs when the project's history is next accessed,
  including before new edits. No unattended cleanup service is added.
- Inactivity does not prove abandonment. After five minutes without a
  saved checkpoint, show possibly interrupted/inactive with unknown
  unfinished outcomes; the writer may still be executing.

These amendments replace the earlier strict project-isolation and
unattended-deletion requirements; they do not weaken the evidence or
stop-on-recording-failure requirements.

## Current behavior

- Rename uses a tag-level Azure DevOps API without enumerating affected
  work items.
- Delete uses a tag-level API for each selected tag. Its effects can extend
  to pull requests as well as work items.
- Merge enumerates work items and updates their tags individually. It
  already uses revision checks and retries to handle concurrent edits.
- Merge reads before/after tag values internally but does not retain those
  values in its result. Its existing result exposes successful work-item
  IDs and source-level failures; a failed source may have partially
  changed cards.
- There is no existing run history, per-card change report, or CSV export.
- Existing extension-data persistence serves the organization-wide tag
  count cache. It does not establish a suitable project history store,
  retention mechanism, or concurrency guarantee.

Relevant integration surfaces are `src/services/TagService.ts`,
`src/app/TagManagerApp.tsx`, `src/types/index.ts`, and the existing
extension-data usage in `src/services/TagCountCacheService.ts`. These are
context references, not a prescribed implementation file structure.

## Approved scope

### Operations and run boundaries

Cover all toolkit-initiated rename, delete, and merge actions.

One confirmation creates one run:

| Action | Run boundary |
|--------|--------------|
| Rename | One confirmed rename |
| Delete | One confirmed batch of selected tags |
| Merge | One confirmed set of source tags into one target |

A run is not an entire page visit or a manually started session. Separate
confirmations produce separate run IDs, even when performed consecutively
by the same user.

Only work-item cards are enumerated in the report. Delete reports must
explicitly state that pull-request effects are not enumerated. The report
must not present itself as a complete inventory of those wider effects.

### Run information

Each run records:

- A unique run ID and the project to which its history belongs.
- The initiating user.
- Start time and, when available, end time.
- Action type and the selected source tags and applicable target tag.
- Overall outcome, including partial, failed, and incomplete execution.
- Run-level errors and evidence limitations.

A failure before any cards are captured still leaves a run-level record
when the initial run record was successfully saved. If that first save
fails, no edit starts and the UI explicitly reports that the run could
not be recorded.

### Per-card information

The run detail table contains one row per captured card per run. Multiple
tag changes to the same card within the run are combined into that row.

Each row contains:

| Field | Meaning |
|-------|---------|
| Card ID and link | Identify and open the affected work item |
| Tags before | The captured tag set before the relevant changes |
| Tags after | The supported resulting tag set, when known |
| Tags added | Tags added between the supported before/after states |
| Tags removed | Tags removed between the supported before/after states |
| Outcome | Changed, unchanged, failed, not attempted, or unknown as appropriate |
| Verification status | Whether evidence is a confirmed direct update, an observation, or unverified |
| Failure reason | A readable explanation when capture, editing, verification, or recording fails |

Unknown tag values are not empty tag sets. Missing evidence must not turn
into an apparent removal of all tags or a successful no-op.

Outcome and verification are separate: an observed difference is not a
confirmed toolkit update, and a failed operation may already have changed
some tags. Combining changes into one row must preserve partial success
and uncertainty rather than replacing them with a single misleading
success or failure label.

Include every captured card, not only successfully changed cards. In
particular, distinguish "not attempted" from "unchanged." A zero-row run
must still explain whether it matched no cards or failed before capture.

## Evidence and correctness

### Merge: direct updates

Record the updates the toolkit directly performs on work items, including
successful updates before a later source or card fails.

Use the before/after values associated with the successful update attempt.
When a revision conflict causes a retry, an obsolete pre-retry snapshot
must not be presented as the state that the toolkit changed.

Preserve ambiguous attempts separately when a PATCH response is lost.
A later revision containing the target does not prove whether the
toolkit or another user changed the card. Do not replace that uncertainty
with a confirmed no-op. Retain the intended tags as unverified intent,
not as a known after-state. If a later retry succeeds, show its direct
baseline while retaining earlier unknown attempts in the evidence and
marking additions/removals as only the known changes.

Cards appearing under multiple source tags are consolidated into one
run-level row. Consolidation must not attribute another user's intervening
edits to the toolkit. Observed differences and directly attributable
changes must remain distinguishable when they differ.

### Rename and delete: observations

Preserve the existing tag-level operations rather than silently replacing
them with per-card editing.

Before editing:

1. Capture the affected cards and their tag values.
2. Require the initial snapshot to finish successfully.
3. If capture fails, do not start the edit.

Persist each successfully captured batch before reading the next batch.
If a later batch fails or the tab closes during capture, earlier saved
cards remain in the report as not attempted.

After editing, check the captured cards and record the observed results.
Label them as observations rather than definitive attribution: another
user may edit a card between the before and after reads.

If a post-edit check fails, preserve the run and mark the affected result
unverified. Do not infer success from the tag-level API response alone.

Initial capture adds latency, especially for large operations. This is
an accepted tradeoff. Cards that acquire a relevant tag after enumeration
may be affected by the tag-level operation without appearing in the
snapshot. Reports must disclose this coverage limitation.

### General limits

- History covers toolkit runs, not every edit made elsewhere in Azure
  DevOps.
- Cached tag counts are informational, not evidence that a specific card
  changed or that enumeration was complete.
- Neither a missing saved result nor an interrupted run proves a card was
  unchanged.
- Recording and Azure DevOps edits cannot be committed together as a
  single transaction. The feature must not promise that unlogged changes
  are impossible.

## Shared history and UI

Provide a project-level **Run history** view:

- List runs newest first.
- Selecting a run opens its per-card detail table and run metadata.
- Paginate the run list and detail table.
- Provide an immediate link to the report after an edit.
- Allow whole-run CSV export from the run report.

History is shared rather than private to the initiating user. Runs from
separate projects must not be mixed in the UI. The storage itself is
organization-wide, as approved above.

### Visibility decision

Users who can access the project's toolkit history may see all recorded
card IDs and tag values for its runs. The table and CSV do not filter rows
by each viewer's current work-item permissions.

This is an explicitly accepted visibility tradeoff: saved history can
expose tag data for a card the viewer cannot otherwise open. A link to a
card does not grant access to that card. The UI and related documentation
must not describe history as permission-filtered.

Project partitioning is not access isolation. The approved storage model
does not enforce project-level authorization.

## CSV export

Export one entire selected run, including all its captured card rows,
regardless of the current table page. There is no combined multi-run
export in the first version.

The CSV includes run context so the file is understandable outside the
extension: run ID, project, initiating user, timestamps, action,
source/target tags, overall outcome, and relevant limitations, alongside
the per-card fields.

Partial, failed, and incomplete runs remain exportable. A run with no
card rows must still export its run context and error or outcome; an
empty file is not an adequate report.

Unknown values, observed results, and confirmed updates must remain
distinguishable in the export. CSV serialization must preserve tag text
and safely handle commas, quotes, line breaks, Unicode, and
spreadsheet-formula-like values.

Exact column ordering and the representation of run-only metadata are
implementation details; they must preserve these requirements.

## Persistence and failure behavior

### Before edits

Save a shared run record before making any changes. If this fails, block
the edit and display the failure. Rename and delete additionally require
their successful initial card snapshot before editing.

### During a run

Persist progress and captured results so a partial run can be inspected
after interruption. Storage cannot be only a final write after all edits.

If recording fails mid-run:

1. Do not initiate further edits once the failure is known.
2. Do not imply that already-issued edits were cancelled or rolled back.
3. Show an explicit warning that shared history may be incomplete.
4. Offer a recovery CSV containing the partial record captured by the
   current page, including any results not successfully persisted.

An in-flight edit may finish despite a recording failure. Surface its
known result without overstating what was saved.

Operation failures must preserve successful changes and their evidence.
Any continuation behavior must remain consistent with existing operation
semantics except for the required stop on a logging failure.

### Interruption

Closing the tab or losing connectivity may interrupt execution. Retain
saved results. Five minutes without a saved checkpoint triggers an
inactive/possibly interrupted label, explicitly noting that the writer
may still be running. Unfinished work has an unknown outcome unless there
is evidence for a more specific state.

Do not automatically resume, continue in the background after tab closure,
or undo an interrupted run. An old "running" record must not silently be
treated as successful. Inactivity alone must not be represented as
definitive proof of abandonment.

## Retention and management

Retain shared history for 90 days, with automatic expiry. Clearly state
the retention policy in the UI so users know to export reports they need
to keep longer.

History is read-only in the toolkit UI. The first version has no history
editing, manual deletion, or administrator history-management controls.
Read-only UI does not imply tamper-proof storage.

The cutoff is 90 days after the run's start timestamp. Hide expired runs
on reads, in already-open reports, and in the latest-run shortcut. Delete
their stored card records before their header when the project's history
is next accessed, including before starting a new edit. Stored data may
remain past expiry while no client accesses that project; this is an
explicitly accepted limitation, not unattended deletion.

## Technical feasibility gates

These are verification obligations, not guarantees established by the
current count-cache implementation. The user-approved amendments settle
the storage architecture; remaining live-platform checks must still be
reported as unverified until a dedicated environment is available.

| Gate | Required verification |
|------|-----------------------|
| Storage capacity | Authoritative document/total-size and request limits; a strategy for large snapshots and runs without silent truncation |
| Sharing and grouping | Collection-wide extension-data scope is accepted; verify project grouping and reader/writer behavior without claiming project authorization |
| Concurrent writers | Independent users can record runs without overwriting each other's history or results |
| Progress durability | How per-card evidence and run state are saved, including failure between an edit and its history write |
| Interrupted-run detection | Inactivity is only a possible interruption, never definitive abandonment |
| Retention | Start timestamp defines expiry; reads hide expired records and client-triggered cleanup physically removes them |
| Identity and context | Supported access to initiating-user identity and stable project identity without storing access tokens |

Use extension-data documents with unique run IDs, separate per-card
documents, and ETag-checked updates rather than a last-write-wins shared
history array. Run headers and card documents have a 32 KiB application
safety bound; refuse collections at the documented 100,000-document
retrieval ceiling rather than return a partial report. These application
bounds do not establish undocumented platform quotas.

Authoritative reference:
https://learn.microsoft.com/en-us/azure/devops/extend/develop/data-storage?view=azure-devops

Live storage/access verification requires a configured dedicated Azure
DevOps test environment and cannot be established by mocked tests. If verification shows
the approved behavior needs a new service, broader permissions, or a
material scope change, return that decision to the user rather than
silently introducing infrastructure or weakening the report.

## Acceptance criteria

1. Rename, batch delete, and merge each produce a distinct run for one
   confirmation, with the initiating user, timestamps, inputs, and outcome.
2. Project toolkit users can inspect shared runs newest first and open a
   paginated per-card table. Separate projects' histories remain grouped
   separately without implying storage authorization.
3. A card touched through multiple merge sources appears once, with its
   combined changes and any partial or uncertain results preserved.
4. Successful merge evidence uses the successful revision-checked attempt,
   including when concurrent edits caused retries.
5. Rename/delete do not start if their initial snapshot fails. Their
   post-edit results are labeled observed or unverified, not confirmed
   toolkit attribution.
6. Every captured card remains represented, including failed, unchanged,
   not-attempted, and unknown outcomes. Missing values are not represented
   as empty tag sets.
7. An initial history-write failure prevents editing. A mid-run recording
   failure stops further edits, warns explicitly, and provides a partial
   recovery CSV without claiming rollback.
8. A tab closure or connection loss does not erase saved progress or
   produce a falsely successful report. There is no automatic resume or
   undo.
9. CSV export includes the entire run rather than the visible page, retains
   evidence labels and run context, handles spreadsheet-sensitive text
   safely, and represents zero-card failures meaningfully.
10. History visibility is not filtered by current per-card access, matching
    the accepted sharing decision. Reports disclose coverage and
    attribution limits, including unenumerated pull-request effects.
11. History expires 90 days after starting, is hidden at expiry, and is
    physically cleaned up on subsequent project-history access. The UI
    explains the absence of unattended deletion and has no edit or manual
    deletion controls.

## Non-goals

- Compliance-grade, immutable, or tamper-proof auditing.
- Automatic undo, rollback, replay, or resumption.
- Tracking edits made outside this toolkit.
- Enumerating pull-request changes.
- Per-viewer work-item permission filtering of reports.
- Multi-run exports, advanced filtering, or additional download formats.
- Manual run start/finish controls or grouping a page visit into one run.
- A new backend, unattended cleanup service, or project-level storage
  authorization.
