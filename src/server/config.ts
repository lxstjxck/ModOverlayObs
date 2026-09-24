import dotenv from "dotenv";
import path from "node:path";

dotenv.config();

const projectRoot = process.cwd();
const defaultSessionSecret = "development-only-change-this-secret";
const defaultInitialPassword = "change-me-now";

function numberEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function listEnv(name: string): string[] {
  return (process.env[name] ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function originFromUrl(value: string): string | null {
  if (!value) {
    return null;
  }
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function buildAllowedOrigins(domain: string, publicOrigin: string, port: number): string[] {
  const origins = new Set<string>();
  const domainOrigin = originFromUrl(domain);
  if (domainOrigin) {
    origins.add(domainOrigin);
  }
  const publicOriginValue = originFromUrl(publicOrigin);
  if (publicOriginValue) {
    origins.add(publicOriginValue);
  }
  for (const origin of listEnv("ORIGIN_ALLOWLIST")) {
    const parsed = originFromUrl(origin);
    origins.add(parsed ?? origin.replace(/\/$/, ""));
  }
  if ((process.env.NODE_ENV ?? "development") !== "production") {
    origins.add(`http://localhost:${port}`);
    origins.add(`http://127.0.0.1:${port}`);
    origins.add("http://localhost:5173");
    origins.add("http://127.0.0.1:5173");
  }
  return Array.from(origins);
}

const domain = process.env.DOMAIN ?? "";
const publicOrigin = process.env.PUBLIC_ORIGIN ?? "";
const port = numberEnv("PORT", 4000);

export const config = {
  projectRoot,
  nodeEnv: process.env.NODE_ENV ?? "development",
  port,
  domain,
  publicOrigin,
  databaseUrl: process.env.DATABASE_URL ?? "file:../database/modoverlay.db",
  sessionSecret: process.env.SESSION_SECRET ?? defaultSessionSecret,
  uploadDir: path.resolve(projectRoot, process.env.UPLOAD_DIR ?? "uploads"),
  maxImageSize: numberEnv("MAX_IMAGE_SIZE", 10 * 1024 * 1024),
  maxGifSize: numberEnv("MAX_GIF_SIZE", 20 * 1024 * 1024),
  maxVideoSize: numberEnv("MAX_VIDEO_SIZE", 100 * 1024 * 1024),
  maxAudioSize: numberEnv("MAX_AUDIO_SIZE", 50 * 1024 * 1024),
  maxTotalUploadSize: numberEnv("MAX_TOTAL_UPLOAD_SIZE", 5 * 1024 * 1024 * 1024),
  originAllowlist: buildAllowedOrigins(domain, publicOrigin, port),
  initialAdminUsername: process.env.INITIAL_ADMIN_USERNAME ?? "owner",
  initialAdminPassword: process.env.INITIAL_ADMIN_PASSWORD ?? defaultInitialPassword
};

export const isProduction = config.nodeEnv === "production";

export function validateProductionConfig(): void {
  if (!isProduction) {
    return;
  }

  const errors: string[] = [];
  const productionOrigin = config.publicOrigin || config.domain;
  if (!originFromUrl(productionOrigin)) {
    errors.push("PUBLIC_ORIGIN or DOMAIN must be an absolute https:// URL in production.");
  }
  if (!productionOrigin.startsWith("https://")) {
    errors.push("PUBLIC_ORIGIN or DOMAIN must use https:// in production.");
  }
  if (!process.env.SESSION_SECRET || config.sessionSecret === defaultSessionSecret) {
    errors.push("SESSION_SECRET must be set to a strong random value in production.");
  }
  if (config.sessionSecret.length < 32) {
    errors.push("SESSION_SECRET must be at least 32 characters.");
  }
  if (config.initialAdminPassword === defaultInitialPassword) {
    errors.push("INITIAL_ADMIN_PASSWORD must not use the development default in production.");
  }

  if (errors.length > 0) {
    throw new Error(`Unsafe production configuration:\n- ${errors.join("\n- ")}`);
  }
}
