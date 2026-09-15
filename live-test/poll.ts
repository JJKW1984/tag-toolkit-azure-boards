export interface PollOptions<T> {
  probe: () => Promise<T>;
  until: (value: T) => boolean;
  /** Total budget before giving up. Default 30s. */
  timeoutMs?: number;
  /** Delay between probes. Default 2s. */
  intervalMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export interface PollResult<T> {
  ok: boolean;
  last: T;
  elapsedMs: number;
  attempts: number;
}

const realSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export async function pollUntil<T>(opts: PollOptions<T>): Promise<PollResult<T>> {
  const timeoutMs = opts.timeoutMs ?? 30_000;
  const intervalMs = opts.intervalMs ?? 2_000;
  const now = opts.now ?? Date.now;
  const sleep = opts.sleep ?? realSleep;

  const start = now();
  let attempts = 0;
  let last = await opts.probe();
  attempts += 1;

  while (!opts.until(last)) {
    if (now() - start >= timeoutMs) {
      return { ok: false, last, elapsedMs: now() - start, attempts };
    }
    await sleep(intervalMs);
    last = await opts.probe();
    attempts += 1;
  }

  return { ok: true, last, elapsedMs: now() - start, attempts };
}
