import { planSeed } from "./seed";

describe("planSeed", () => {
  const seed = planSeed("r1");

  it("scopes every name to the run and the ui phase", () => {
    const all = [
      seed.rename.old,
      seed.rename.new,
      ...seed.merge.sources,
      seed.merge.target,
      seed.del,
      seed.search.alpha,
      seed.search.beta,
      ...seed.volume,
    ];
    for (const name of all) {
      expect(name.startsWith("livetest-r1-ui-")).toBe(true);
    }
  });

  it("generates 30 volume tags so pagination has two pages", () => {
    expect(seed.volume).toHaveLength(30);
  });

  it("zero-pads volume tags so they sort predictably", () => {
    expect(seed.volume[0]).toBe("livetest-r1-ui-vol-000");
    expect(seed.volume[29]).toBe("livetest-r1-ui-vol-029");
  });

  it("gives merge two distinct sources and a distinct target", () => {
    expect(new Set([...seed.merge.sources, seed.merge.target]).size).toBe(3);
  });

  it("gives search two distinguishable names", () => {
    expect(seed.search.alpha).not.toBe(seed.search.beta);
  });

  it("produces no duplicate names overall", () => {
    const all = [
      seed.rename.old,
      seed.rename.new,
      ...seed.merge.sources,
      seed.merge.target,
      seed.del,
      seed.search.alpha,
      seed.search.beta,
      ...seed.volume,
    ];
    expect(new Set(all).size).toBe(all.length);
  });
});
