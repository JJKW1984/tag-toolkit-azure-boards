import { LIVE_TEST_PREFIX, newRunId, testTag } from "./naming";

describe("testTag", () => {
  it("builds a prefixed, ability-scoped tag name", () => {
    expect(testTag("20260915140211", "merge", "a")).toBe(
      "livetest-20260915140211-merge-a"
    );
  });

  it("always starts with the shared live-test prefix so cleanup can find it", () => {
    expect(testTag("r1", "delete", "x").startsWith(LIVE_TEST_PREFIX)).toBe(true);
  });

  it("keeps different abilities in separate namespaces", () => {
    expect(testTag("r1", "rename", "old")).not.toBe(testTag("r1", "delete", "old"));
  });
});

describe("newRunId", () => {
  it("formats a UTC timestamp with no separators", () => {
    expect(newRunId(new Date(Date.UTC(2026, 8, 15, 14, 2, 11)))).toBe("20260915140211");
  });

  it("zero-pads single-digit components", () => {
    expect(newRunId(new Date(Date.UTC(2026, 0, 2, 3, 4, 5)))).toBe("20260102030405");
  });
});
