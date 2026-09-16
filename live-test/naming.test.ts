import {
  isLiveTestWorkItemTitle,
  isLiveTestTagName,
  LIVE_TEST_PREFIX,
  liveTestTagPrefix,
  liveTestWorkItemMarker,
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
  it("formats a UTC timestamp with a unique suffix", () => {
    expect(newRunId(new Date(Date.UTC(2026, 8, 15, 14, 2, 11)), "1a2b3c4d")).toBe(
      "20260915140211-1a2b3c4d"
    );
  });

  it("zero-pads single-digit components", () => {
    expect(newRunId(new Date(Date.UTC(2026, 0, 2, 3, 4, 5)), "feedbeef")).toBe(
      "20260102030405-feedbeef"
    );
  });

  it("makes two runs in the same second distinct", () => {
    const now = new Date(Date.UTC(2026, 8, 15, 14, 2, 11));
    expect(newRunId(now, "aaaaaaaa")).not.toBe(newRunId(now, "bbbbbbbb"));
  });
});

describe("testWorkItemTitle", () => {
  it("stamps the live-test marker onto a title", () => {
    expect(testWorkItemTitle("r1", "merge a only")).toBe("[livetest-r1] merge a only");
  });

  it("produces a title the ownership check recognises", () => {
    expect(
      isLiveTestWorkItemTitle(testWorkItemTitle("20260915140211-1a2b3c4d", "x"), "20260915140211-1a2b3c4d")
    ).toBe(true);
  });
});

describe("isLiveTestWorkItemTitle", () => {
  it("rejects an ordinary work item title", () => {
    expect(isLiveTestWorkItemTitle("Customer cannot log in", "r1")).toBe(false);
  });

  it("rejects a title that merely mentions the prefix later on", () => {
    expect(isLiveTestWorkItemTitle("Investigate livetest- leftovers", "r1")).toBe(false);
  });

  it("rejects another run's title marker", () => {
    expect(isLiveTestWorkItemTitle(`${liveTestWorkItemMarker("r2")} x`, "r1")).toBe(false);
  });

  it("treats a missing title as no evidence of ownership", () => {
    expect(isLiveTestWorkItemTitle(undefined, "r1")).toBe(false);
    expect(isLiveTestWorkItemTitle("", "r1")).toBe(false);
  });
});

describe("isLiveTestTagName", () => {
  it("accepts only tags in the current run namespace", () => {
    expect(isLiveTestTagName(`${liveTestTagPrefix("r1")}merge-a`, "r1")).toBe(true);
    expect(isLiveTestTagName(`${liveTestTagPrefix("r2")}merge-a`, "r1")).toBe(false);
  });
});
