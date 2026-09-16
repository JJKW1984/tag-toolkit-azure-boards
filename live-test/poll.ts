export interface PollOptions<T> {
  probe: () => Promise<T>;
  until: (value: T) => boolean;
  /** Total budget before giving up. Default 30s. */
  timeoutMs?: number;
  /** Delay between probes. Default 2s. */
  intervalMs?: number;
  /** Upper bound for one probe; defaults to the remaining total budget. */
  probeTimeoutMs?: number;
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

function timeoutError(ms: number): Error {
  return new Error(`poll probe timed out after ${ms}ms`);
}

export async function pollUntil<T>(opts: PollOptions<T>): Promise<PollResult<T>> {
  const timeoutMs = opts.timeoutMs ?? 30_000;
  const intervalMs = opts.intervalMs ?? 2_000;
  const probeTimeoutMs = opts.probeTimeoutMs;
  const now = opts.now ?? Date.now;
  const sleep = opts.sleep ?? realSleep;

  const start = now();
  let attempts = 0;

  const probeWithinBudget = async (): Promise<T> => {
    const remainingMs = timeoutMs - (now() - start);
    if (remainingMs <= 0) throw timeoutError(0);
    const limitMs = Math.min(probeTimeoutMs ?? remainingMs, remainingMs);
    let timer: NodeJS.Timeout | undefined;
    const timedOut = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(timeoutError(limitMs)), limitMs);
    });
    try {
      return await Promise.race([opts.probe(), timedOut]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  };

  let last = await probeWithinBudget();
  attempts += 1;

  while (!opts.until(last)) {
    if (now() - start >= timeoutMs) {
      return { ok: false, last, elapsedMs: now() - start, attempts };
    }
    await sleep(intervalMs);
    if (now() - start >= timeoutMs) {
      return { ok: false, last, elapsedMs: now() - start, attempts };
    }
    last = await probeWithinBudget();
    attempts += 1;
  }

  return { ok: true, last, elapsedMs: now() - start, attempts };
}
