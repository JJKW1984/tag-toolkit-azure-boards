import { joinTags, parseTags } from "./tagString";

describe("parseTags", () => {
  it("splits ADO's semicolon-separated tag string", () => {
    expect(parseTags("bug; frontend; P1")).toEqual(["bug", "frontend", "P1"]);
  });

  it("trims surrounding whitespace on each tag", () => {
    expect(parseTags("bug ;  frontend")).toEqual(["bug", "frontend"]);
  });

  it("drops empty segments from trailing or doubled separators", () => {
    expect(parseTags("bug;;frontend;")).toEqual(["bug", "frontend"]);
  });

  it("returns an empty array for an empty field", () => {
    expect(parseTags("")).toEqual([]);
  });
});

describe("joinTags", () => {
  it("joins with the separator ADO writes back", () => {
    expect(joinTags(["bug", "frontend"])).toBe("bug; frontend");
  });

  it("round-trips through parseTags", () => {
    expect(parseTags(joinTags(["a", "b", "c"]))).toEqual(["a", "b", "c"]);
  });
});
