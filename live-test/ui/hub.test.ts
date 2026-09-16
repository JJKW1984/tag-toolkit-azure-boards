import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { hubUrl, readHubContribution, uiConfigFromEnv } from "./hub";

function writeManifest(contents: object): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "live-test-hub-"));
  const file = path.join(dir, "vss-extension-dev.json");
  fs.writeFileSync(file, JSON.stringify(contents), "utf8");
  return file;
}

describe("readHubContribution", () => {
  it("reads publisher, extension id and hub contribution id from the manifest", () => {
    const file = writeManifest({
      publisher: "josephjohnkarl",
      id: "tag-toolkit-azure-boards-develop",
      contributions: [
        { id: "tag-manager-hub-develop", type: "ms.vss-web.hub" },
      ],
    });

    expect(readHubContribution(file)).toEqual({
      publisher: "josephjohnkarl",
      extensionId: "tag-toolkit-azure-boards-develop",
      contributionId: "tag-manager-hub-develop",
    });
  });

  it("picks the hub contribution when the manifest has several", () => {
    const file = writeManifest({
      publisher: "p",
      id: "e",
      contributions: [
        { id: "some-menu", type: "ms.vss-web.action" },
        { id: "the-hub", type: "ms.vss-web.hub" },
      ],
    });

    expect(readHubContribution(file).contributionId).toBe("the-hub");
  });

  it("throws a clear error when no hub contribution exists", () => {
    const file = writeManifest({ publisher: "p", id: "e", contributions: [] });
    expect(() => readHubContribution(file)).toThrow(/no ms\.vss-web\.hub contribution/);
  });
});

describe("hubUrl", () => {
  it("builds the _apps/hub URL from the three ids", () => {
    expect(
      hubUrl("https://dev.azure.com/myorg", "My Project", {
        publisher: "pub",
        extensionId: "ext",
        contributionId: "hub",
      })
    ).toBe("https://dev.azure.com/myorg/My%20Project/_apps/hub/pub.ext.hub");
  });

  it("tolerates a trailing slash on the org URL", () => {
    expect(
      hubUrl("https://dev.azure.com/myorg/", "P", {
        publisher: "pub",
        extensionId: "ext",
        contributionId: "hub",
      })
    ).toBe("https://dev.azure.com/myorg/P/_apps/hub/pub.ext.hub");
  });
});

describe("uiConfigFromEnv", () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it("reads the three required variables", () => {
    process.env.LIVE_TEST_ORG = "https://dev.azure.com/o";
    process.env.LIVE_TEST_PROJECT = "P";
    process.env.LIVE_TEST_PAT = "x";

    expect(uiConfigFromEnv()).toEqual({
      orgUrl: "https://dev.azure.com/o",
      project: "P",
      pat: "x",
    });
  });

  it("names the missing variable instead of failing obscurely later", () => {
    delete process.env.LIVE_TEST_PAT;
    process.env.LIVE_TEST_ORG = "o";
    process.env.LIVE_TEST_PROJECT = "P";

    expect(() => uiConfigFromEnv()).toThrow(/LIVE_TEST_PAT/);
  });
});
