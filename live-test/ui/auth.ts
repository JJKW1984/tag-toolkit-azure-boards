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
 *
 * When not headless, a human may be looking at the window and can sign in
 * interactively — so this waits (generously) for the page to leave the
 * sign-in host before giving up, rather than failing before they get a
 * chance to type credentials. Under HEADLESS=1 there is no one to sign in,
 * so it fails immediately instead of waiting out a timeout no one can act on.
 */
export async function assertSignedIn(page: Page): Promise<void> {
  if (!isSignInUrl(page.url())) return;

  if (process.env.HEADLESS !== "1") {
    try {
      await page.waitForURL((url) => !isSignInUrl(url.toString()), {
        timeout: 5 * 60_000,
      });
      return;
    } catch {
      // fall through to the error below — still on a sign-in host after waiting
    }
  }

  throw new Error(
    "Azure DevOps session has expired. Re-authenticate by running " +
      "`pnpm live-test:ui` with a visible browser (HEADLESS unset) and signing in " +
      "when the window opens, then run the suite again."
  );
}
