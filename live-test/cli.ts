import { parseArgs } from "node:util";
import * as readline from "node:readline/promises";
import { AdoClient } from "./adoClient";
import { ALL_ABILITIES } from "./abilities";
import { ManifestStore, listManifestPaths, RUNS_DIR } from "./manifest";
import { newRunId } from "./naming";
import { allPassed, buildReport, formatSummary, writeReport } from "./report";
import { cleanupRun, runAbilities } from "./runner";
import { sanitizeError } from "../src/utils/sanitizeError";
import { CliOptions } from "./types";

export class CliError extends Error {}

export const USAGE = `Usage:
  pnpm live-test --org <url> --project <name> --pat <pat> [--yes] [--work-item-type Task]
  pnpm live-test --cleanup <manifest.json> --pat <pat>
  pnpm live-test --cleanup-all --pat <pat>

Flags:
  --org              Org URL, e.g. https://dev.azure.com/myorg
  --project          Project to create test data in
  --pat              Personal access token (Work Items read/write + Analytics read)
  --yes              Skip the typed project-name confirmation
  --work-item-type   Work item type to create (default: Task)
  --cleanup          Delete everything recorded in one manifest
  --cleanup-all      Delete everything in every manifest still marked in-progress`;

/**
 * `node:util` parseArgs embeds the offending argv token in its message, e.g.
 * `Unexpected argument 'MY-SECRET-PAT'`. That token is frequently the PAT
 * itself — a dropped `--pat` flag name or one stray token is enough — and the
 * message lands on stdout and in CI logs. `sanitizeError` cannot save it: a
 * bare token has no `token=` prefix and no URL to match on. So report the
 * problem *class* and never the value.
 */
function describeParseFailure(e: unknown): string {
  switch ((e as { code?: string } | null)?.code) {
    case "ERR_PARSE_ARGS_UNKNOWN_OPTION":
      return "Unrecognized option";
    case "ERR_PARSE_ARGS_UNEXPECTED_POSITIONAL":
      return "Unexpected positional argument — every value must follow its flag";
    case "ERR_PARSE_ARGS_INVALID_OPTION_VALUE":
      return "An option was given without its required value";
    default:
      return "Invalid arguments";
  }
}

export function parseCliArgs(argv: string[]): CliOptions {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      options: {
        org: { type: "string" },
        project: { type: "string" },
        pat: { type: "string" },
        yes: { type: "boolean", default: false },
        "work-item-type": { type: "string", default: "Task" },
        cleanup: { type: "string" },
        "cleanup-all": { type: "boolean", default: false },
      },
      strict: true,
      allowPositionals: false,
    });
  } catch (e) {
    throw new CliError(`${describeParseFailure(e)} — see usage below.\n\n${USAGE}`);
  }

  const v = parsed.values;
  if (!v.pat) throw new CliError(`--pat is required\n\n${USAGE}`);
  if (v.cleanup && v["cleanup-all"]) {
    throw new CliError(`--cleanup and --cleanup-all are mutually exclusive\n\n${USAGE}`);
  }

  const base = {
    pat: v.pat,
    yes: v.yes ?? false,
    workItemType: v["work-item-type"] ?? "Task",
  };

  if (v.cleanup) {
    return { mode: "cleanup", ...base, manifestPath: v.cleanup };
  }
  if (v["cleanup-all"]) {
    return { mode: "cleanup-all", ...base };
  }
  if (!v.org) throw new CliError(`--org is required\n\n${USAGE}`);
  if (!v.project) throw new CliError(`--project is required\n\n${USAGE}`);

  return { mode: "run", ...base, org: v.org, project: v.project };
}

/** The typed-confirmation guard: an exact, deliberate match of the project name. */
export function confirmationMatches(input: string, project: string): boolean {
  return input.trim() === project;
}

export interface MainIo {
  log: (message: string) => void;
  ask: (question: string) => Promise<string>;
  now: () => Date;
}

const defaultIo: MainIo = {
  log: (m) => console.log(m),
  ask: async (question) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    try {
      return await rl.question(question);
    } finally {
      rl.close();
    }
  },
  now: () => new Date(),
};

export async function main(argv: string[], io: MainIo = defaultIo): Promise<number> {
  let opts;
  try {
    opts = parseCliArgs(argv);
  } catch (e) {
    io.log(e instanceof CliError ? e.message : String(e));
    return 2;
  }

  if (opts.mode === "cleanup" || opts.mode === "cleanup-all") {
    const stores: ManifestStore[] = [];
    let failed = 0;

    if (opts.mode === "cleanup") {
      try {
        stores.push(ManifestStore.open(opts.manifestPath as string));
      } catch (e) {
        io.log(`Could not read ${opts.manifestPath}: ${sanitizeError(e)}`);
        return 1;
      }
    } else {
      // One unreadable file must not abort the sweep: the other in-progress
      // runs still have real resources waiting to be deleted.
      for (const p of listManifestPaths(RUNS_DIR)) {
        try {
          const store = ManifestStore.open(p);
          if (store.manifest.status === "in-progress") stores.push(store);
        } catch (e) {
          failed += 1;
          io.log(`Skipping unreadable manifest ${p}: ${sanitizeError(e)}`);
        }
      }
    }

    if (stores.length === 0 && failed === 0) {
      io.log("Nothing to clean up.");
      return 0;
    }

    for (const store of stores) {
      io.log(`Cleaning ${store.path} (${store.manifest.project})`);
      try {
        const client = new AdoClient({
          orgUrl: store.manifest.org,
          project: store.manifest.project,
          pat: opts.pat,
        });
        await cleanupRun(client, store, io.log);
      } catch (e) {
        failed += 1;
        io.log(`  cleanup failed for ${store.path}: ${sanitizeError(e)}`);
        continue;
      }
      // cleanupRun marks a manifest cleaned only when every delete resolved,
      // so this is the signal that resources may still be alive.
      if (store.manifest.status !== "cleaned") failed += 1;
    }

    // CI sweeps this; reporting success while resources survive would hide
    // exactly the failure the sweep exists to catch.
    return failed > 0 ? 1 : 0;
  }

  const org = opts.org as string;
  const project = opts.project as string;

  io.log(`Live Test Harness\nOrg:      ${org}\nProject:  ${project}\n`);
  io.log("This will create work items and tags in the above project, modify them, and delete them.\n");

  if (!opts.yes) {
    const answer = await io.ask(`Type the project name to continue: `);
    if (!confirmationMatches(answer, project)) {
      io.log("Aborted — the name entered did not match the target project.");
      return 1;
    }
  }

  const startedAt = io.now();
  const runId = newRunId(startedAt);
  const client = new AdoClient({ orgUrl: org, project, pat: opts.pat });
  const store = ManifestStore.create(RUNS_DIR, { runId, org, project });
  io.log(`Run ${runId} — manifest: ${store.path}\n`);

  const results = await runAbilities({
    client,
    store,
    runId,
    workItemType: opts.workItemType,
    abilities: ALL_ABILITIES,
    log: io.log,
  });

  const report = buildReport(
    {
      runId,
      org,
      project,
      startedAt: startedAt.toISOString(),
      finishedAt: io.now().toISOString(),
    },
    results
  );
  const written = writeReport(RUNS_DIR, report);
  io.log(`\n${formatSummary(results, written)}`);

  const shouldClean =
    opts.yes ||
    confirmYes(
      await io.ask(
        `\nDelete ${store.manifest.workItems.length} test work items and ${store.manifest.tags.length} test tags? [y/N] `
      )
    );

  if (shouldClean) {
    await cleanupRun(client, store, io.log);
    // cleanupRun marks the manifest cleaned only when every delete resolved.
    // Returning 0 here because the assertions passed would report a green run
    // while real test data is still alive in the project — and CI would never
    // learn about it.
    if (store.manifest.status !== "cleaned") {
      io.log(
        `\nTest data may still be live in ${project}: cleanup did not complete. ` +
          `Retry with:\n  pnpm live-test --cleanup ${store.path} --pat <pat>`
      );
      return 1;
    }
  } else {
    io.log(`\nLeft in place. Clean up later with:\n  pnpm live-test --cleanup ${store.path} --pat <pat>`);
  }

  return allPassed(results) ? 0 : 1;
}

function confirmYes(answer: string): boolean {
  return /^y(es)?$/i.test(answer.trim());
}

// Entry point when run via `tsx live-test/cli.ts`.
if (require.main === module) {
  void main(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((e) => {
      // A throw that escapes main() must still exit cleanly with a readable
      // message rather than an unhandled-rejection stack trace.
      console.error(sanitizeError(e));
      process.exitCode = 1;
    });
}
