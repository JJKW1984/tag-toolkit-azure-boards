// Console logging for the extension. There is no server-side log to write to, so
// the browser console is the only place diagnostics can go. Callers must pass
// already-sanitized text: never tokens or headers.
const PREFIX = "[TagToolkit]";
const DEBUG_FLAG = "tagToolkitDebug";

// Structural type so this file compiles under tsconfigs that lack the DOM lib
// (tsconfig.live-test.json includes src/utils).
type StorageLike = { getItem(key: string): string | null };

/** Verbose per-request logging; opt in per browser with localStorage.tagToolkitDebug = "1". */
export function isDebugEnabled(): boolean {
  try {
    const storage = (globalThis as { localStorage?: StorageLike }).localStorage;
    return storage?.getItem(DEBUG_FLAG) === "1";
  } catch {
    // Storage can throw in private windows or with site data blocked.
    return false;
  }
}

export const info = (...args: unknown[]): void => console.info(PREFIX, ...args);
export const warn = (...args: unknown[]): void => console.warn(PREFIX, ...args);
export const error = (...args: unknown[]): void => console.error(PREFIX, ...args);
export const debug = (...args: unknown[]): void => {
  if (isDebugEnabled()) console.debug(PREFIX, ...args);
};
