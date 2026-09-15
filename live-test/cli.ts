import { parseArgs } from "node:util";
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
    throw new CliError(`${(e as Error).message}\n\n${USAGE}`);
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
