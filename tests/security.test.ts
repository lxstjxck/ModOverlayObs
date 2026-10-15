import { describe, expect, it } from "vitest";
import { createCsrfTokenFromSessionToken } from "../src/server/auth";
import { WindowRateLimiter, buildContentSecurityPolicy } from "../src/server/security";

describe("security primitives", () => {
  it("binds csrf tokens to the session token", () => {
    const first = createCsrfTokenFromSessionToken("session-a");
    const second = createCsrfTokenFromSessionToken("session-b");

    expect(first).toHaveLength(43);
    expect(first).not.toBe(second);
  });

  it("limits repeated actions inside a fixed window", () => {
    const limiter = new WindowRateLimiter(2, 60_000);

    expect(limiter.consume("user")).toEqual({ allowed: true });
    expect(limiter.consume("user")).toEqual({ allowed: true });
    expect(limiter.consume("user")).toMatchObject({ allowed: false });
    expect(limiter.consume("other")).toEqual({ allowed: true });
  });

  it("keeps external frames limited to YouTube and disallows HTTP media", () => {
    const directives = buildContentSecurityPolicy();
    expect(directives).toContain("frame-src 'self' https://www.youtube.com");
    expect(directives).toContain("media-src 'self' https: blob:");
    expect(directives).toContain("script-src 'self'");
    expect(directives).not.toContain("media-src 'self' https: http:");
  });
});
