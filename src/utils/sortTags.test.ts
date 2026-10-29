import { sortTags } from "./sortTags";
import { TagItem } from "../types";

const tag = (name: string, count?: number): TagItem => ({ id: name, name, url: "u", count });
const names = (tags: TagItem[]) => tags.map((t) => t.name);

describe("sortTags", () => {
  it("sorts by name ascending", () => {
    const sorted = sortTags([tag("beta"), tag("alpha"), tag("gamma")], { key: "name", direction: "asc" });

    expect(names(sorted)).toEqual(["alpha", "beta", "gamma"]);
  });

  it("sorts by name descending", () => {
    const sorted = sortTags([tag("beta"), tag("alpha"), tag("gamma")], { key: "name", direction: "desc" });

    expect(names(sorted)).toEqual(["gamma", "beta", "alpha"]);
  });

  it("ignores case when sorting by name, as tag names are case-insensitive", () => {
    const sorted = sortTags([tag("beta"), tag("Alpha"), tag("gamma")], { key: "name", direction: "asc" });

    expect(names(sorted)).toEqual(["Alpha", "beta", "gamma"]);
  });

  it("puts the least-used tags first when sorting by count ascending", () => {
    const sorted = sortTags([tag("a", 5), tag("b", 0), tag("c", 12)], { key: "count", direction: "asc" });

    expect(names(sorted)).toEqual(["b", "a", "c"]);
  });

  it("puts the most-used tags first when sorting by count descending", () => {
    const sorted = sortTags([tag("a", 5), tag("b", 0), tag("c", 12)], { key: "count", direction: "desc" });

    expect(names(sorted)).toEqual(["c", "a", "b"]);
  });

  it("keeps tags with no count last in either direction, so unknown is never read as zero", () => {
    const tags = [tag("unknown"), tag("a", 5), tag("b", 0)];

    expect(names(sortTags(tags, { key: "count", direction: "asc" }))).toEqual(["b", "a", "unknown"]);
    expect(names(sortTags(tags, { key: "count", direction: "desc" }))).toEqual(["a", "b", "unknown"]);
  });

  it("breaks count ties by name ascending in either direction", () => {
    const tags = [tag("zeta", 3), tag("alpha", 3), tag("mid", 3)];

    expect(names(sortTags(tags, { key: "count", direction: "asc" }))).toEqual(["alpha", "mid", "zeta"]);
    expect(names(sortTags(tags, { key: "count", direction: "desc" }))).toEqual(["alpha", "mid", "zeta"]);
  });

  it("returns a new array and leaves the input untouched", () => {
    const input = [tag("beta"), tag("alpha")];

    const sorted = sortTags(input, { key: "name", direction: "asc" });

    expect(sorted).not.toBe(input);
    expect(names(input)).toEqual(["beta", "alpha"]);
  });
});
