import crypto from "node:crypto";
import type { Session } from "@prisma/client";
import { config } from "./config";
import { prisma } from "./db";
import { accessRevocation } from "./accessRevocation";

const freshMs = 10_000;
const requiredScopes = ["moderation:read", "user:read:moderated_channels"];
const refreshes = new Map<string, Promise<string>>();
const syncs = new Map<string, Promise<Set<string>>>();
const verified = new Map<string, { twitchId: string; at: number }>();
const identityChecks = new Map<string, Promise<boolean>>();
const revocationVersion = new Map<string, number>();

async function revokeConnection(userId: string, mode: "streamer" | "moderator" | "unified"): Promise<void> {
  verified.delete(userId);
  revocationVersion.set(userId, (revocationVersion.get(userId) ?? 0) + 1);
  await prisma.twitchOAuthConnection.updateMany({ where: { userId, mode }, data: { revokedAt: new Date() } });
  accessRevocation.emit("user", userId);
  if (mode === "streamer" || mode === "unified") {
    const channels = await prisma.streamer.findMany({ where: { ownerUserId: userId }, select: { id: true } });
    for (const channel of channels) accessRevocation.emit("channel", channel.id);
  }
}

export function encryptOAuthToken(value: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", Buffer.from(config.oauthTokenEncryptionKey, "hex"), iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), ciphertext].map((part) => part.toString("base64url")).join(".");
}

function decryptOAuthToken(value: string): string {
  const parts = value.split(".").map((part) => Buffer.from(part, "base64url"));
  if (parts.length !== 3 || parts[0].length !== 12 || parts[1].length !== 16) throw new Error("Invalid OAuth token");
  const decipher = crypto.createDecipheriv("aes-256-gcm", Buffer.from(config.oauthTokenEncryptionKey, "hex"), parts[0]);
  decipher.setAuthTag(parts[1]);
  return Buffer.concat([decipher.update(parts[2]), decipher.final()]).toString("utf8");
}

async function accessToken(userId: string, mode: "streamer" | "moderator" | "unified", force = false): Promise<string> {
  const connection = await prisma.twitchOAuthConnection.findUnique({ where: { userId_mode: { userId, mode } } });
  if (!connection || connection.revokedAt) throw new Error("Twitch connection unavailable");
  if (!force && connection.expiresAt.getTime() > Date.now() + 30_000) return decryptOAuthToken(connection.encryptedAccess);
  const key = `${userId}:${mode}`;
  const pending = refreshes.get(key);
  if (pending) return pending;
  const operation = (async () => {
    const response = await fetch("https://id.twitch.tv/oauth2/token", {
      method: "POST",
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: decryptOAuthToken(connection.encryptedRefresh),
        client_id: config.twitchClientId,
        client_secret: config.twitchClientSecret
      }),
      signal: AbortSignal.timeout(8000)
    });
    if (!response.ok) {
      if (response.status === 400 || response.status === 401) {
        await revokeConnection(userId, mode);
      }
      throw new Error("Twitch refresh failed");
    }
    const tokens = await response.json() as { access_token?: string; refresh_token?: string; expires_in?: number; scope?: string[] };
    if (!tokens.access_token || !tokens.refresh_token || !tokens.expires_in || !Array.isArray(tokens.scope)) throw new Error("Invalid Twitch refresh");
    const required = mode === "unified" ? requiredScopes : [mode === "streamer" ? "moderation:read" : "user:read:moderated_channels"];
    if (!required.every((scope) => tokens.scope!.includes(scope))) {
      await revokeConnection(userId, mode);
      throw new Error("Twitch scope revoked");
    }
    await prisma.twitchOAuthConnection.update({
      where: { id: connection.id },
      data: {
        encryptedAccess: encryptOAuthToken(tokens.access_token),
        encryptedRefresh: encryptOAuthToken(tokens.refresh_token),
        expiresAt: new Date(Date.now() + tokens.expires_in * 1000),
        scopesJson: JSON.stringify(tokens.scope),
        checkedAt: new Date()
      }
    });
    return tokens.access_token;
  })();
  refreshes.set(key, operation);
  try { return await operation; } finally { refreshes.delete(key); }
}

export async function verifyStreamerIdentity(userId: string, twitchUserId: string): Promise<boolean> {
  let token = await accessToken(userId, "unified");
  let response = await fetch("https://id.twitch.tv/oauth2/validate", {
    headers: { Authorization: `OAuth ${token}` }, signal: AbortSignal.timeout(8000)
  });
  if (response.status === 401) {
    token = await accessToken(userId, "unified", true);
    response = await fetch("https://id.twitch.tv/oauth2/validate", {
      headers: { Authorization: `OAuth ${token}` }, signal: AbortSignal.timeout(8000)
    });
  }
  if (response.status === 401 || response.status === 403) {
    await revokeConnection(userId, "unified");
    return false;
  }
  if (!response.ok) throw new Error("Twitch identity verification unavailable");
  const identity = await response.json() as { client_id?: string; user_id?: string; scopes?: string[] };
  if (identity.client_id !== config.twitchClientId || identity.user_id !== twitchUserId ||
      !requiredScopes.every((scope) => identity.scopes?.includes(scope))) {
    await revokeConnection(userId, "unified");
    return false;
  }
  return true;
}

async function verifyRecentIdentity(userId: string, twitchUserId: string, force = false): Promise<boolean> {
  const cached = verified.get(userId);
  if (!force && cached?.twitchId === twitchUserId && Date.now() - cached.at < freshMs) return true;
  const pending = identityChecks.get(userId);
  if (pending) return pending;
  const version = revocationVersion.get(userId) ?? 0;
  const operation = verifyStreamerIdentity(userId, twitchUserId).then((valid) => {
    if (valid && version === (revocationVersion.get(userId) ?? 0)) {
      verified.set(userId, { twitchId: twitchUserId, at: Date.now() });
      return true;
    }
    return false;
  });
  identityChecks.set(userId, operation);
  try { return await operation; } finally { identityChecks.delete(userId); }
}

async function twitchPages(userId: string, mode: "streamer" | "moderator", endpoint: string, idKey: string): Promise<Set<string>> {
  let token = await accessToken(userId, "unified");
  let cursor: string | undefined;
  const seen = new Set<string>();
  const ids = new Set<string>();
  for (let page = 0; page < 1000; page++) {
    const url = new URL(`https://api.twitch.tv/helix/${endpoint}`);
    url.searchParams.set(idKey, (await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { twitchUserId: true } })).twitchUserId!);
    url.searchParams.set("first", "100");
    if (cursor) url.searchParams.set("after", cursor);
    let response = await fetch(url, { headers: { Authorization: `Bearer ${token}`, "Client-Id": config.twitchClientId }, signal: AbortSignal.timeout(8000) });
    if (response.status === 401) {
      token = await accessToken(userId, "unified", true);
      response = await fetch(url, { headers: { Authorization: `Bearer ${token}`, "Client-Id": config.twitchClientId }, signal: AbortSignal.timeout(8000) });
    }
    if (response.status === 401 || response.status === 403) {
      await revokeConnection(userId, "unified");
      throw new Error("Twitch authorization revoked");
    }
    if (!response.ok) throw new Error("Twitch list unavailable");
    const body = await response.json() as { data?: Array<{ user_id?: string; broadcaster_id?: string }>; pagination?: { cursor?: string } };
    if (!Array.isArray(body.data)) throw new Error("Invalid Twitch list");
    for (const item of body.data) {
      const id = mode === "streamer" ? item.user_id : item.broadcaster_id;
      if (!id || !/^\d+$/.test(id)) throw new Error("Invalid Twitch list item");
      ids.add(id);
    }
    const next = body.pagination?.cursor;
    if (!next) return ids;
    if (seen.has(next)) throw new Error("Repeated Twitch cursor");
    seen.add(next);
    cursor = next;
  }
  throw new Error("Twitch list too long");
}

export async function getModeratedChannels(userId: string): Promise<Set<string>> {
  return twitchPages(userId, "moderator", "moderation/channels", "user_id");
}

export async function getTwitchProfiles(userId: string, ids: string[]): Promise<Array<{ id: string; login: string; displayName: string; avatarUrl: string }>> {
  const profiles: Array<{ id: string; login: string; displayName: string; avatarUrl: string }> = [];
  for (let index = 0; index < ids.length; index += 100) {
    const url = new URL("https://api.twitch.tv/helix/users");
    for (const id of ids.slice(index, index + 100)) url.searchParams.append("id", id);
    let token = await accessToken(userId, "unified");
    let response = await fetch(url, { headers: { Authorization: `Bearer ${token}`, "Client-Id": config.twitchClientId }, signal: AbortSignal.timeout(8000) });
    if (response.status === 401) {
      token = await accessToken(userId, "unified", true);
      response = await fetch(url, { headers: { Authorization: `Bearer ${token}`, "Client-Id": config.twitchClientId }, signal: AbortSignal.timeout(8000) });
    }
    if (response.status === 401 || response.status === 403) { await revokeConnection(userId, "unified"); throw new Error("Twitch authorization revoked"); }
    if (!response.ok) throw new Error("Twitch profiles unavailable");
    const body = await response.json() as { data?: Array<{ id?: string; login?: string; display_name?: string; profile_image_url?: string }> };
    if (!Array.isArray(body.data)) throw new Error("Invalid Twitch profiles");
    for (const row of body.data) if (row.id && ids.includes(row.id) && row.login && row.display_name) profiles.push({
      id: row.id, login: row.login, displayName: row.display_name, avatarUrl: row.profile_image_url ?? ""
    });
  }
  return profiles;
}

export async function syncModerators(channelId: string): Promise<Set<string>> {
  const pending = syncs.get(channelId);
  if (pending) return pending;
  const operation = (async () => {
    const channel = await prisma.streamer.findUniqueOrThrow({ where: { id: channelId } });
    if (!channel.ownerUserId || !channel.twitchBroadcasterId) throw new Error("Channel is not bound");
    const ids = await twitchPages(channel.ownerUserId, "streamer", "moderation/moderators", "broadcaster_id");
    const previous = await prisma.channelModeratorSnapshot.findUnique({ where: { channelId } });
    await prisma.channelModeratorSnapshot.upsert({
      where: { channelId },
      create: { channelId, userIdsJson: JSON.stringify([...ids]), checkedAt: new Date() },
      update: { userIdsJson: JSON.stringify([...ids]), checkedAt: new Date() }
    });
    if (previous) {
      for (const id of JSON.parse(previous.userIdsJson) as string[]) if (!ids.has(id)) accessRevocation.emit("channelTwitchUser", channelId, id);
    }
    return ids;
  })();
  syncs.set(channelId, operation);
  try { return await operation; } finally { syncs.delete(channelId); }
}

async function resolveChannelRole(session: Session & { user: { id: string; twitchUserId: string | null; role: string } }, channelId: string): Promise<"owner" | "moderator" | null> {
  const channel = await prisma.streamer.findUnique({ where: { id: channelId }, select: { ownerUserId: true, twitchBroadcasterId: true } });
  if (!channel) return null;
  if (session.authMethod === "LEGACY") {
    const first = await prisma.streamer.findFirst({ orderBy: { createdAt: "asc" }, select: { id: true } });
    return first?.id === channelId ? session.user.role === "OWNER" ? "owner" : "moderator" : null;
  }
  if (session.twitchMode !== "unified" || !session.user.twitchUserId) return null;
  const connection = await prisma.twitchOAuthConnection.findUnique({
    where: { userId_mode: { userId: session.user.id, mode: "unified" } },
    select: { revokedAt: true, expiresAt: true }
  });
  if (!connection || connection.revokedAt || !(await verifyRecentIdentity(session.user.id, session.user.twitchUserId, connection.expiresAt <= new Date()))) return null;
  if (channel.ownerUserId === session.user.id && channel.twitchBroadcasterId === session.user.twitchUserId) return "owner";
  if (!channel.twitchBroadcasterId || !channel.ownerUserId) return null;
  const ownerConnection = await prisma.twitchOAuthConnection.findUnique({ where: { userId_mode: { userId: channel.ownerUserId, mode: "unified" } }, select: { revokedAt: true, expiresAt: true } });
  if (!ownerConnection || ownerConnection.revokedAt) return null;
  const owner = await prisma.user.findUnique({ where: { id: channel.ownerUserId }, select: { twitchUserId: true } });
  if (!owner?.twitchUserId || owner.twitchUserId !== channel.twitchBroadcasterId ||
      !(await verifyRecentIdentity(channel.ownerUserId, owner.twitchUserId, ownerConnection.expiresAt <= new Date()))) return null;
  const ban = await prisma.channelModeratorBan.findUnique({ where: { channelId_userId: { channelId, userId: session.user.id } } });
  if (ban) return null;
  let snapshot = await prisma.channelModeratorSnapshot.findUnique({ where: { channelId } });
  if (!snapshot || Date.now() - snapshot.checkedAt.getTime() > freshMs) {
    await syncModerators(channelId);
    snapshot = await prisma.channelModeratorSnapshot.findUnique({ where: { channelId } });
  }
  if (!snapshot || Date.now() - snapshot.checkedAt.getTime() > freshMs) return null;
  return (JSON.parse(snapshot.userIdsJson) as string[]).includes(session.user.twitchUserId) ? "moderator" : null;
}

export async function channelRole(session: Session & { user: { id: string; twitchUserId: string | null; role: string } }, channelId: string): Promise<"owner" | "moderator" | null> {
  try { return await resolveChannelRole(session, channelId); }
  catch { return null; }
}

export async function canAccessChannel(session: Session & { user: { id: string; twitchUserId: string | null; role: string } }, channelId: string): Promise<boolean> {
  return (await channelRole(session, channelId)) !== null;
}

export async function setModeratorBan(channelId: string, ownerUserId: string, moderatorUserId: string, banned: boolean): Promise<void> {
  const channel = await prisma.streamer.findUnique({ where: { id: channelId }, select: { ownerUserId: true } });
  if (channel?.ownerUserId !== ownerUserId || moderatorUserId === ownerUserId) throw new Error("Permission denied");
  if (banned) await prisma.channelModeratorBan.upsert({ where: { channelId_userId: { channelId, userId: moderatorUserId } }, create: { channelId, userId: moderatorUserId }, update: {} });
  else await prisma.channelModeratorBan.deleteMany({ where: { channelId, userId: moderatorUserId } });
  accessRevocation.emit("channelUser", channelId, moderatorUserId);
}
