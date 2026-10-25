// live-test/errors.ts

/** A delete/read whose target does not exist. Raised by the raw-fetch client paths. */
export class NotFoundError extends Error {}

/**
 * True when an error means "the target does not exist".
 * Covers our own raw-fetch errors, the azure-devops-node-api library's errors
 * (which carry a numeric `statusCode`), and the in-memory fake.
 */
export function isNotFound(e: unknown): boolean {
  if (e instanceof NotFoundError) return true;
  return (e as { statusCode?: number } | null)?.statusCode === 404;
}
