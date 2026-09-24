import crypto from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { config, isProduction } from "./config";
import { readSessionToken, createCsrfTokenFromSessionToken } from "./auth";

const unsafeMethods = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export class WindowRateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly max: number,
    private readonly windowMs: number
  ) {}

  consume(key: string): { allowed: true } | { allowed: false; retryAfterSeconds: number } {
    const now = Date.now();
    const windowStart = now - this.windowMs;
    const recent = (this.hits.get(key) ?? []).filter((timestamp) => timestamp > windowStart);
    if (recent.length >= this.max) {
      const retryAfterSeconds = Math.max(1, Math.ceil((recent[0] + this.windowMs - now) / 1000));
      this.hits.set(key, recent);
      return { allowed: false, retryAfterSeconds };
    }
    recent.push(now);
    this.hits.set(key, recent);
    return { allowed: true };
  }

  prune(): void {
    const now = Date.now();
    for (const [key, timestamps] of this.hits) {
      const recent = timestamps.filter((timestamp) => timestamp + this.windowMs > now);
      if (recent.length === 0) {
        this.hits.delete(key);
      } else {
        this.hits.set(key, recent);
      }
    }
  }
}

export function createRateLimitMiddleware(options: {
  max: number;
  windowMs: number;
  message: string;
  key: (request: Request) => string;
}) {
  const limiter = new WindowRateLimiter(options.max, options.windowMs);
  setInterval(() => limiter.prune(), options.windowMs).unref();

  return (request: Request, response: Response, next: NextFunction): void => {
    const result = limiter.consume(options.key(request));
    if (!result.allowed) {
      response.setHeader("Retry-After", String(result.retryAfterSeconds));
      response.status(429).json({ error: options.message });
      return;
    }
    next();
  };
}

export function applySecurityHeaders(request: Request, response: Response, next: NextFunction): void {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "same-origin");
  response.setHeader("X-Frame-Options", "SAMEORIGIN");
  response.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  response.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  response.setHeader(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), clipboard-write=(self)"
  );
  response.setHeader("Content-Security-Policy", buildContentSecurityPolicy());
  if (isProduction) {
    response.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  next();
}

export function requireTrustedOrigin(request: Request, response: Response, next: NextFunction): void {
  if (!unsafeMethods.has(request.method)) {
    next();
    return;
  }

  const origin = request.get("origin");
  if (!isOriginAllowed(origin)) {
    response.status(403).json({ error: "Request origin is not allowed" });
    return;
  }
  next();
}

export function requireCsrf(request: Request, response: Response, next: NextFunction): void {
  if (!unsafeMethods.has(request.method) || request.path === "/auth/login") {
    next();
    return;
  }

  const sessionToken = readSessionToken(request.headers.cookie);
  const headerToken = request.get("x-csrf-token");
  if (!sessionToken || !headerToken) {
    response.status(403).json({ error: "CSRF token is required" });
    return;
  }

  const expected = createCsrfTokenFromSessionToken(sessionToken);
  if (!timingSafeEqual(expected, headerToken)) {
    response.status(403).json({ error: "CSRF token is invalid" });
    return;
  }
  next();
}

export function isOriginAllowed(origin?: string): boolean {
  if (!origin) {
    return true;
  }
  const normalized = normalizeOrigin(origin);
  if (!normalized) {
    return false;
  }
  return config.originAllowlist.includes(normalized);
}

export function clientIp(request: Request): string {
  const forwarded = request.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || request.ip || request.socket.remoteAddress || "unknown";
}

function buildContentSecurityPolicy(): string {
  const connectSources = new Set(["'self'", "ws:", "wss:"]);
  for (const origin of config.originAllowlist) {
    connectSources.add(origin);
    connectSources.add(origin.replace(/^http:/, "ws:").replace(/^https:/, "wss:"));
  }

  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'self'",
    "form-action 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "media-src 'self' https: http: blob:",
    `connect-src ${Array.from(connectSources).join(" ")}`,
    "font-src 'self' data:"
  ].join("; ");
}

function normalizeOrigin(origin: string): string | null {
  try {
    return new URL(origin).origin;
  } catch {
    return null;
  }
}

function timingSafeEqual(expected: string, actual: string): boolean {
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(actual);
  if (expectedBuffer.length !== actualBuffer.length) {
    return false;
  }
  return crypto.timingSafeEqual(expectedBuffer, actualBuffer);
}
