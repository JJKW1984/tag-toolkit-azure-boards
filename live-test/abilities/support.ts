import { sanitizeError } from "../../src/utils/sanitizeError";
import { AbilityResult } from "../types";

export interface AbilityOutcome {
  ok: boolean;
  detail?: string;
}

/**
 * Times one ability, converts a thrown error into a sanitized failure, and
 * guarantees every ability returns a result rather than rejecting — the runner
 * must always be able to continue to the next ability.
 */
export async function timed(
  name: string,
  fn: () => Promise<AbilityOutcome>
): Promise<AbilityResult> {
  const start = Date.now();
  try {
    const outcome = await fn();
    return {
      name,
      status: outcome.ok ? "pass" : "fail",
      durationMs: Date.now() - start,
      detail: outcome.detail,
    };
  } catch (e) {
    return {
      name,
      status: "fail",
      durationMs: Date.now() - start,
      detail: sanitizeError(e),
    };
  }
}

/** Poll settings an ability uses; overridable so unit tests run instantly. */
export interface PollSettings {
  timeoutMs?: number;
  intervalMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

export const FAST_POLL_FOR_TESTS: PollSettings = {
  timeoutMs: 10,
  intervalMs: 1,
  sleep: async () => undefined,
};
