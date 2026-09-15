import { sanitizeError } from "./sanitizeError";

describe("sanitizeError", () => {
  it("returns the message from an Error", () => {
    expect(sanitizeError(new Error("something went wrong"))).toBe(
      "something went wrong"
    );
  });

  it("stringifies non-Error values", () => {
    expect(sanitizeError("raw string")).toBe("raw string");
    expect(sanitizeError(42)).toBe("42");
  });

  it("truncates messages longer than 200 characters", () => {
    const result = sanitizeError(new Error("x".repeat(300)));
    expect(result.length).toBeLessThanOrEqual(200);
  });

  it("strips content after the first newline", () => {
    const result = sanitizeError(new Error("first line\nat: somewhere"));
    expect(result).toBe("first line");
  });

  it("redacts URLs", () => {
    const result = sanitizeError(new Error("request failed at https://contoso.example/api?token=abc123"));
    expect(result).toBe("request failed at [redacted-url]");
  });

  it("redacts credentialed URLs", () => {
    const result = sanitizeError(new Error("failed: https://user:password@contoso.example/path"));
    expect(result).toBe("failed: [redacted-url]");
  });

  it("redacts URLs wrapped with angle brackets or quotes", () => {
    const result = sanitizeError(new Error("failed at <\"https://contoso.example/path\">"));
    expect(result).toBe("failed at <\"[redacted-url]\">");
  });

  it("redacts URLs followed by closing brackets", () => {
    const result = sanitizeError(new Error("failed at [https://contoso.example/path]"));
    expect(result).toBe("failed at [[redacted-url]]");
  });

  it("redacts bearer tokens", () => {
    const result = sanitizeError(new Error("Unauthorized: Bearer abc123.xyz"));
    expect(result).toBe("Unauthorized: Bearer [redacted]");
  });

  it("redacts the credential in an Authorization: Basic header, not just the scheme", () => {
    // The key/value run used to stop at the first whitespace, so the scheme was
    // redacted and the base64 credential was left standing right next to it.
    const result = sanitizeError(
      new Error("request rejected: Authorization: Basic am9zZXBoOnNlY3JldA==")
    );

    expect(result).not.toContain("am9zZXBoOnNlY3JldA");
    expect(result).toBe("request rejected: Authorization=[redacted]");
  });

  it("redacts the credential in an Authorization: Bearer header", () => {
    const result = sanitizeError(new Error("rejected: Authorization: Bearer abc123.xyz"));

    expect(result).not.toContain("abc123");
    expect(result).toBe("rejected: Authorization=[redacted]");
  });

  it("redacts a bare Basic credential", () => {
    const result = sanitizeError(new Error("sent Basic am9zZXBoOnNlY3JldA== upstream"));
    expect(result).not.toContain("am9zZXBoOnNlY3JldA");
  });

  it("redacts a bare basic credential regardless of case", () => {
    const result = sanitizeError(new Error("sent basic am9zZXBoOnNlY3JldA== upstream"));
    expect(result).not.toContain("am9zZXBoOnNlY3JldA");
  });

  it.each([
    "Basic auth is required",
    "Basic authentication is required",
    "Basic settings were rejected",
    "Basic operations completed",
  ])("leaves the ordinary word Basic in prose alone: %s", (message) => {
    // The value run has to be base64-*shaped*, not merely long — "Basic
    // authentication is required" is a plausible real ADO/AAD message.
    expect(sanitizeError(new Error(message))).toBe(message);
  });

  it("redacts token-like key/value pairs", () => {
    const result = sanitizeError(new Error("permission denied token=abc123 authorization:secret"));
    expect(result).toBe("permission denied token=[redacted] authorization=[redacted]");
  });
});
