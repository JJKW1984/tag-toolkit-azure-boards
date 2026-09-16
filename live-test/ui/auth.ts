import * as path from "node:path";
import { BrowserContext, chromium, Page } from "@playwright/test";

/** Gitignored: lives under .live-test-runs/, which .gitignore already covers. */
export const PROFILE_DIR = path.resolve(
  process.cwd(),
  ".live-test-runs",
  "playwright-profile"
);

const SIGN_IN_HOSTS = ["login.microsoftonline.com", "login.live.com", "login.windows.net"];

export function isSignInUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (SIGN_IN_HOSTS.includes(parsed.hostname)) return true;
  return parsed.pathname.endsWith("/_signin");
}

/**
 * A real browser profile on disk, so the developer signs in once by hand and
 * later runs reuse the session. Headed by default — an expired session can only
 * be renewed by a human looking at the window.
 */
export async function launchProfileContext(): Promise<BrowserContext> {
  return chromium.launchPersistentContext(PROFILE_DIR, {
    headless: process.env.HEADLESS === "1",
    viewport: { width: 1440, height: 900 },
  });
}

/**
 * Fails fast and legibly when the stored session has expired, instead of
 * letting every selector time out against a login form.
 */
export async function assertSignedIn(page: Page): Promise<void> {
  if (isSignInUrl(page.url())) {
    throw new Error(
      "Azure DevOps session has expired. Re-authenticate by running " +
        "`pnpm live-test:ui` with a visible browser (HEADLESS unset) and signing in " +
        "when the window opens, then run the suite again."
    );
  }
}
