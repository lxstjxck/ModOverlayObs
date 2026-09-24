import type { NextFunction, Request, Response } from "express";
import { parse } from "cookie";
import crypto from "node:crypto";
import type { PermissionFlag, UserView } from "../shared/types";
import { config, isProduction } from "./config";
import { prisma } from "./db";
import { accessRevocation } from "./accessRevocation";
import { hasPermission, parsePermissions } from "./permissions";

export const sessionCookieName = "mod_overlay_session";
const sessionDays = 7;

export interface AuthenticatedRequest extends Request {
  user: NonNullable<Awaited<ReturnType<typeof getUserFromRequest>>>;
}

export function hashSessionToken(token: string): string {
  return crypto.createHmac("sha256", config.sessionSecret).update(token).digest("hex");
}

export function createCsrfTokenFromSessionToken(token: string): string {
  return crypto
    .createHmac("sha256", config.sessionSecret)
    .update(`csrf:${hashSessionToken(token)}`)
    .digest("base64url");
}

export function toUserView(user: {
  id: string;
  username: string;
  displayName: string;
  role: "OWNER" | "ADMIN_MODERATOR" | "MODERATOR";
  permissionsJson: string;
}): UserView {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    role: user.role,
    permissions: parsePermissions(user.role, user.permissionsJson)
  };
}

export async function createSession(userId: string, response: Response): Promise<string> {
  const token = crypto.randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + sessionDays * 24 * 60 * 60 * 1000);
  await prisma.session.create({
    data: {
      tokenHash: hashSessionToken(token),
      userId,
      expiresAt
    }
  });
  response.cookie(sessionCookieName, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: isProduction,
    expires: expiresAt,
    path: "/"
  });
  return createCsrfTokenFromSessionToken(token);
}

export async function destroySession(request: Request, response: Response): Promise<void> {
  const token = readSessionToken(request.headers.cookie);
  if (token) {
    await prisma.session.deleteMany({ where: { tokenHash: hashSessionToken(token) } });
    accessRevocation.emit("session", hashSessionToken(token));
  }
  response.clearCookie(sessionCookieName, { path: "/" });
}

export function readSessionToken(cookieHeader?: string): string | null {
  if (!cookieHeader) {
    return null;
  }
  const cookies = parse(cookieHeader);
  return cookies[sessionCookieName] ?? null;
}

export async function getSessionFromCookieHeader(cookieHeader?: string) {
  const token = readSessionToken(cookieHeader);
  if (!token) {
    return null;
  }
  return prisma.session.findFirst({
    where: {
      tokenHash: hashSessionToken(token),
      expiresAt: { gt: new Date() }
    },
    include: { user: true }
  });
}

export async function getUserFromCookieHeader(cookieHeader?: string) {
  return (await getSessionFromCookieHeader(cookieHeader))?.user ?? null;
}

export async function getUserFromRequest(request: Request) {
  return getUserFromCookieHeader(request.headers.cookie);
}

export function getCsrfTokenFromRequest(request: Request): string | null {
  const token = readSessionToken(request.headers.cookie);
  return token ? createCsrfTokenFromSessionToken(token) : null;
}

export async function requireAuth(
  request: Request,
  response: Response,
  next: NextFunction
): Promise<void> {
  const user = await getUserFromRequest(request);
  if (!user) {
    response.status(401).json({ error: "Authentication required" });
    return;
  }
  (request as AuthenticatedRequest).user = user;
  next();
}

export function requirePermission(permission: PermissionFlag) {
  return (request: Request, response: Response, next: NextFunction): void => {
    const user = (request as AuthenticatedRequest).user;
    if (!user || !hasPermission(user.role, user.permissionsJson, permission)) {
      response.status(403).json({ error: "Permission denied" });
      return;
    }
    next();
  };
}
