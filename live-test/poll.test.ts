import { pollUntil } from "./poll";

/** Deterministic fake clock: sleeping advances time instantly. */
function fakeClock() {
  let current = 0;
  return {
    now: () => current,
    sleep: async (ms: number) => {
      current += ms;
    },
  };
}

describe("pollUntil", () => {
  it("returns immediately when the first probe already satisfies the predicate", async () => {
    const clock = fakeClock();
    const probe = jest.fn(async () => 3);

    const result = await pollUntil({
      probe,
      until: (v) => v === 3,
      ...clock,
    });

    expect(result).toMatchObject({ ok: true, last: 3, attempts: 1, elapsedMs: 0 });
    expect(probe).toHaveBeenCalledTimes(1);
  });

  it("keeps probing until the value settles", async () => {
    const clock = fakeClock();
    const values = [0, 0, 3];
    const probe = jest.fn(async () => values.shift() ?? 3);

    const result = await pollUntil({
      probe,
      until: (v) => v === 3,
      intervalMs: 2000,
      ...clock,
    });

    expect(result.ok).toBe(true);
    expect(result.attempts).toBe(3);
    expect(result.elapsedMs).toBe(4000);
  });

  it("gives up at the timeout and reports the last value seen", async () => {
    const clock = fakeClock();
    const probe = jest.fn(async () => 1);

    const result = await pollUntil({
      probe,
      until: (v) => v === 3,
      intervalMs: 2000,
      timeoutMs: 6000,
      ...clock,
    });

    expect(result.ok).toBe(false);
    expect(result.last).toBe(1);
    expect(result.elapsedMs).toBeGreaterThanOrEqual(6000);
  });

  it("propagates a probe error instead of swallowing it", async () => {
    const clock = fakeClock();
    const probe = jest.fn(async () => {
      throw new Error("analytics exploded");
    });

    await expect(
      pollUntil({ probe, until: () => true, ...clock })
    ).rejects.toThrow("analytics exploded");
  });
});
