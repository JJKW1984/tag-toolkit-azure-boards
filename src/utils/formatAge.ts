const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const unit = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"} ago`;

/** "5 minutes ago" for an ISO timestamp, or null when it cannot be read. */
export function formatAge(iso: string, now: number = Date.now()): string | null {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return null;
  // A timestamp slightly ahead of this machine's clock is clock skew, not the future.
  const age = Math.max(0, now - then);
  if (age < MINUTE) return "less than a minute ago";
  if (age < HOUR) return unit(Math.floor(age / MINUTE), "minute");
  if (age < DAY) return unit(Math.floor(age / HOUR), "hour");
  return unit(Math.floor(age / DAY), "day");
}
