import { isSignInUrl } from "./auth";

describe("isSignInUrl", () => {
  it("detects the Microsoft account sign-in host", () => {
    expect(isSignInUrl("https://login.microsoftonline.com/common/oauth2/authorize?x=1")).toBe(
      true
    );
  });

  it("detects the consumer live.com sign-in host", () => {
    expect(isSignInUrl("https://login.live.com/oauth20_authorize.srf")).toBe(true);
  });

  it("detects the Azure DevOps signin route", () => {
    expect(isSignInUrl("https://dev.azure.com/myorg/_signin?realm=x")).toBe(true);
  });

  it("does not flag the hub URL itself", () => {
    expect(
      isSignInUrl("https://dev.azure.com/myorg/P/_apps/hub/pub.ext.hub")
    ).toBe(false);
  });

  it("does not flag a tag whose name happens to contain 'signin'", () => {
    expect(isSignInUrl("https://dev.azure.com/myorg/P/_workitems?tag=signin")).toBe(false);
  });
});
