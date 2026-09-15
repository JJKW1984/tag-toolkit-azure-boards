import {
  isLiveTestWorkItemTitle,
  LIVE_TEST_PREFIX,
  newRunId,
  testTag,
  testWorkItemTitle,
} from "./naming";

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

describe("testWorkItemTitle", () => {
  it("stamps the live-test marker onto a title", () => {
    expect(testWorkItemTitle("r1", "merge a only")).toBe("[livetest-r1] merge a only");
  });

  it("produces a title the ownership check recognises", () => {
    expect(isLiveTestWorkItemTitle(testWorkItemTitle("20260915140211", "x"))).toBe(true);
  });
});

describe("isLiveTestWorkItemTitle", () => {
  it("rejects an ordinary work item title", () => {
    expect(isLiveTestWorkItemTitle("Customer cannot log in")).toBe(false);
  });

  it("rejects a title that merely mentions the prefix later on", () => {
    expect(isLiveTestWorkItemTitle("Investigate livetest- leftovers")).toBe(false);
  });

  it("treats a missing title as no evidence of ownership", () => {
    expect(isLiveTestWorkItemTitle(undefined)).toBe(false);
    expect(isLiveTestWorkItemTitle("")).toBe(false);
  });
});
