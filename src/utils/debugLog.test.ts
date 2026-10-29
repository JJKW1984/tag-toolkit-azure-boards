import { debug, error, info, isDebugEnabled, warn } from "./debugLog";

describe("debugLog", () => {
  // Created per test: setupTests runs jest.restoreAllMocks() before each one.
  let spies: Record<"info" | "warn" | "error" | "debug", jest.SpyInstance>;

  beforeEach(() => {
    spies = {
      info: jest.spyOn(console, "info").mockImplementation(() => undefined),
      warn: jest.spyOn(console, "warn").mockImplementation(() => undefined),
      error: jest.spyOn(console, "error").mockImplementation(() => undefined),
      debug: jest.spyOn(console, "debug").mockImplementation(() => undefined),
    };
    window.localStorage.clear();
  });

  it("info, warn and error always log with the [TagToolkit] prefix", () => {
    info("a", { n: 1 });
    warn("b");
    error("c");

    expect(spies.info).toHaveBeenCalledWith("[TagToolkit]", "a", { n: 1 });
    expect(spies.warn).toHaveBeenCalledWith("[TagToolkit]", "b");
    expect(spies.error).toHaveBeenCalledWith("[TagToolkit]", "c");
  });

  it("debug is silent unless tagToolkitDebug is '1'", () => {
    debug("hidden");
    expect(spies.debug).not.toHaveBeenCalled();

    window.localStorage.setItem("tagToolkitDebug", "1");
    debug("shown");
    expect(spies.debug).toHaveBeenCalledWith("[TagToolkit]", "shown");
  });

  it.each(["0", "true", ""])("does not treat %j as enabling debug", (value) => {
    window.localStorage.setItem("tagToolkitDebug", value);
    expect(isDebugEnabled()).toBe(false);
  });

  it("is disabled, not thrown, when storage access throws", () => {
    const getItem = jest.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    try {
      expect(isDebugEnabled()).toBe(false);
      expect(() => debug("x")).not.toThrow();
    } finally {
      getItem.mockRestore();
    }
  });
});
