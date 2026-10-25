import * as fs from "node:fs";

export interface HubContribution {
  publisher: string;
  extensionId: string;
  contributionId: string;
}

export interface UiConfig {
  orgUrl: string;
  project: string;
  pat: string;
}

interface ManifestShape {
  publisher: string;
  id: string;
  contributions?: Array<{ id: string; type: string }>;
}

/**
 * Reads the ids that make up a hub URL from the dev manifest rather than
 * hardcoding them, so renaming the extension or its contribution cannot leave
 * the UI tests pointing at a dead URL.
 */
export function readHubContribution(manifestPath: string): HubContribution {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as ManifestShape;
  const hub = (manifest.contributions ?? []).find((c) => c.type === "ms.vss-web.hub");
  if (!hub) {
    throw new Error(`${manifestPath} has no ms.vss-web.hub contribution`);
  }
  return {
    publisher: manifest.publisher,
    extensionId: manifest.id,
    contributionId: hub.id,
  };
}

export function hubUrl(orgUrl: string, project: string, ids: HubContribution): string {
  const base = orgUrl.trim().replace(/\/$/, "");
  const slug = `${ids.publisher}.${ids.extensionId}.${ids.contributionId}`;
  return `${base}/${encodeURIComponent(project)}/_apps/hub/${slug}`;
}

export function uiConfigFromEnv(): UiConfig {
  const read = (name: string): string => {
    const value = process.env[name];
    if (!value) {
      throw new Error(
        `${name} is not set. Phase 2 needs LIVE_TEST_ORG, LIVE_TEST_PROJECT and LIVE_TEST_PAT.`
      );
    }
    return value;
  };
  return {
    orgUrl: read("LIVE_TEST_ORG"),
    project: read("LIVE_TEST_PROJECT"),
    pat: read("LIVE_TEST_PAT"),
  };
}
