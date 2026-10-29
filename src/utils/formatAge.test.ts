import { formatAge } from "./formatAge";

const NOW = new Date("2026-10-27T12:00:00.000Z").getTime();
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe("formatAge", () => {
  it("reports under a minute as just now", () => {
    expect(formatAge(ago(20_000), NOW)).toBe("less than a minute ago");
  });

  it("reports minutes, singular and plural", () => {
    expect(formatAge(ago(MINUTE), NOW)).toBe("1 minute ago");
    expect(formatAge(ago(42 * MINUTE), NOW)).toBe("42 minutes ago");
  });

  it("reports hours, singular and plural", () => {
    expect(formatAge(ago(HOUR), NOW)).toBe("1 hour ago");
    expect(formatAge(ago(5 * HOUR + 40 * MINUTE), NOW)).toBe("5 hours ago");
  });

  it("reports days, singular and plural", () => {
    expect(formatAge(ago(DAY), NOW)).toBe("1 day ago");
    expect(formatAge(ago(9 * DAY), NOW)).toBe("9 days ago");
  });

  it("treats a timestamp slightly in the future (clock skew) as just now", () => {
    expect(formatAge(new Date(NOW + 5_000).toISOString(), NOW)).toBe("less than a minute ago");
  });

  it("returns null for a timestamp it cannot read", () => {
    expect(formatAge("not a date", NOW)).toBeNull();
  });
});
