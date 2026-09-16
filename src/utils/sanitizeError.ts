export function sanitizeError(raw: unknown): string {
  const msg = raw instanceof Error ? raw.message : String(raw);
  const firstLine = msg.split("\n")[0];
  const withoutUrls = firstLine.replace(/\bhttps?:\/\/[^\s,;)>"'\]]+/gi, "[redacted-url]");
  const withoutBearer = withoutUrls.replace(/\bBearer\s+[^\s,;]+/gi, "Bearer [redacted]");
  // `Basic <base64>` carries the credential in the value, not after a `token=`
  // marker. The run need only be long enough to look like a real credential:
  // Basic auth accepts all-letter base64 as well, so requiring a digit or a
  // +/=/ character would miss valid secrets such as "YWFhYWFhYWFhYWFhYWFh".
  const withoutBasic = withoutBearer.replace(
    /\bBasic\s+[A-Za-z0-9+/_-]{16,}={0,2}(?=$|[\s,;)>"'\]])/gi,
    "Basic [redacted]"
  );
  // The optional scheme word matters: without it the value run stops at the
  // first whitespace, so `Authorization: Basic am9zZXBoOnNlY3JldA==` redacted
  // the scheme and left the credential standing next to it.
  const withoutTokens = withoutBasic.replace(
    /\b(token|pat|api[_-]?key|authorization)\s*[:=]\s*(?:(?:Basic|Bearer|Digest|Negotiate|NTLM)\s+)?[^\s,;]+/gi,
    "$1=[redacted]"
  );
  return withoutTokens.slice(0, 200);
}
