import type { NextFunction, Request, Response } from "express";
import { parse } from "cookie";
import crypto from "node:crypto";
import type { Streamer } from "@prisma/client";
import type { PermissionFlag, UserView } from "../shared/types";
import { config, isProduction } from "./config";
import { prisma } from "./db";
import { accessRevocation } from "./accessRevocation";
import { hasPermission, parsePermissions } from "./permissions";
import { canAccessChannel, channelRole } from "./channelAccess";
import { getDefaultStreamer } from "./state";

export const sessionCookieName = "mod_overlay_session";
const sessionDays = 7;

export interface AuthenticatedRequest extends Request {
  user: NonNullable<Awaited<ReturnType<typeof getUserFromRequest>>>;
  channel: Streamer;
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
  twitchLogin?: string | null;
  role: "OWNER" | "ADMIN_MODERATOR" | "MODERATOR";
  permissionsJson: string;
}): UserView {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    twitchLogin: user.twitchLogin ?? null,
    role: user.role,
    permissions: parsePermissions(user.role, user.permissionsJson)
  };
}

export async function createSession(
  userId: string,
  response: Response,
  twitchMode?: "unified"
): Promise<string> {
  const token = crypto.randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + sessionDays * 24 * 60 * 60 * 1000);
  await prisma.session.create({
    data: {
      tokenHash: hashSessionToken(token),
      userId,
      authMethod: twitchMode ? "TWITCH" : "LEGACY",
      twitchMode: twitchMode ?? null,
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
  const session = await getSessionFromCookieHeader(cookieHeader);
  return session?.authMethod === "LEGACY" ? session.user : null;
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
  const session = await getSessionFromCookieHeader(request.headers.cookie);
  if (!session || session.authMethod !== "LEGACY") {
    response.status(401).json({ error: "Authentication required" });
    return;
  }
  const channel = await getDefaultStreamer();
  if (!(await canAccessChannel(session, channel.id))) {
    response.status(403).json({ error: "Channel access denied" });
    return;
  }
  (request as AuthenticatedRequest).user = session.user;
  next();
}

export async function requireEditorAuth(request: Request, response: Response, next: NextFunction): Promise<void> {
  const session = await getSessionFromCookieHeader(request.headers.cookie);
  if (session?.authMethod !== "TWITCH" || session.twitchMode !== "unified") {
    response.status(401).json({ error: "Twitch authentication required" }); return;
  }
  const requested = request.get("x-channel-id") ?? request.query.channelId;
  const channel = typeof requested === "string"
    ? await prisma.streamer.findUnique({ where: { id: requested } })
    : await getDefaultStreamer();
  const role = channel ? await channelRole(session, channel.id) : null;
  if (!channel || requested !== channel.id || !role) {
    response.status(403).json({ error: "Channel access denied" }); return;
  }
  const authorized = request as AuthenticatedRequest;
  authorized.channel = channel;
  authorized.user = { ...session.user, role: role === "owner" ? "OWNER" : "MODERATOR", permissionsJson: "{}" };
  next();
}

export async function requireTwitchAuth(
  request: Request,
  response: Response,
  next: NextFunction
): Promise<void> {
  const session = await getSessionFromCookieHeader(request.headers.cookie);
  if (session?.authMethod !== "TWITCH" || session.twitchMode !== "unified" || !session.user.twitchUserId) {
    response.status(401).json({ error: "Twitch authentication required" });
    return;
  }
  const connection = await prisma.twitchOAuthConnection.findUnique({
    where: { userId_mode: { userId: session.user.id, mode: "unified" } },
    select: { revokedAt: true }
  });
  if (!connection || connection.revokedAt) {
    response.status(401).json({ error: "Twitch authorization expired. Sign in again." });
    return;
  }
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
