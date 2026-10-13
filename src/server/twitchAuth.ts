import crypto from "node:crypto";
import express from "express";
import { parse } from "cookie";
import type { ChannelStatus, TwitchChannelView, TwitchModeratorView } from "../shared/types";
import { config, isProduction } from "./config";
import { prisma } from "./db";
import {
  createSession,
  destroySession,
  getCsrfTokenFromRequest,
  getSessionFromCookieHeader,
  hashSessionToken,
  readSessionToken,
  requireTwitchAuth
} from "./auth";
import { clientIp, createRateLimitMiddleware } from "./security";
import { canAccessChannel, channelRole, encryptOAuthToken, getModeratedChannels, getTwitchProfiles, setModeratorBan, syncModerators, verifyStreamerIdentity } from "./channelAccess";
import { getDefaultStreamer } from "./state";
import { overlayReload } from "./overlayReload";
import { requestOverlayReload } from "./socket";

const stateCookie = "mod_overlay_twitch_state";
const stateTtlMs = 10 * 60_000;
const scopes = ["moderation:read", "user:read:moderated_channels"];
const startLimit = createRateLimitMiddleware({
  max: 20,
  windowMs: 60_000,
  message: "Too many Twitch login attempts",
  key: (request) => `twitch:start:${clientIp(request)}`
});

function hash(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function configured(): boolean {
  try {
    const redirect = new URL(config.twitchOAuthRedirectUri);
    return Boolean(
      config.twitchClientId &&
      config.twitchClientSecret &&
      /^[0-9a-f]{64}$/i.test(config.oauthTokenEncryptionKey) &&
      redirect.pathname === "/api/auth/twitch/callback" &&
      !redirect.search &&
      !redirect.hash &&
      (redirect.protocol === "https:" ||
        (!isProduction &&
          redirect.protocol === "http:" &&
          ["localhost", "127.0.0.1"].includes(redirect.hostname)))
    );
  } catch {
    return false;
  }
}

async function twitchJson<T>(url: string, init: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error("Twitch authorization failed");
  return (await response.json()) as T;
}

function fail(response: express.Response, reason: string, popup = false): void {
  response.setHeader("Cache-Control", "no-store");
  response.redirect(303, popup ? `/oauth/popup?error=${reason}` : `/login?oauth_error=${reason}`);
}

export function twitchAuthRouter(): express.Router {
  const router = express.Router();

  router.get("/start/:mode", startLimit, async (request, response) => {
    const mode = request.params.mode;
    const popup = mode === "unified" && request.query.popup === "1";
    if (mode !== "unified" && mode !== "bind") {
      response.status(404).json({ error: "Unknown login mode" });
      return;
    }
    if (!configured()) {
      if (popup) fail(response, "twitch_unavailable", true);
      else response.status(503).json({ error: "Twitch login is not configured" });
      return;
    }
    const existing = await getSessionFromCookieHeader(request.headers.cookie);
    if (mode === "bind" && (existing?.authMethod !== "LEGACY" || existing.user.role !== "OWNER")) {
      response.status(403).json({ error: "Legacy owner session required" });
      return;
    }
    if (mode === "bind" && (await getDefaultStreamer()).ownerUserId) {
      response.status(409).json({ error: "Channel is already bound" });
      return;
    }
    if (mode !== "bind" && existing?.authMethod === "LEGACY") {
      if (popup) fail(response, "legacy_session", true);
      else response.status(409).json({ error: "Sign out of the legacy account before Twitch login" });
      return;
    }
    const state = crypto.randomBytes(32).toString("base64url");
    const binding = crypto.randomBytes(32).toString("base64url");
    await prisma.twitchOAuthState.deleteMany({ where: { expiresAt: { lt: new Date() } } });
    await prisma.twitchOAuthState.create({
      data: {
        stateHash: hash(state),
        bindingHash: hash(binding),
        mode: popup ? "unified_popup" : mode,
        legacySessionHash: mode === "bind" ? hashSessionToken(readSessionToken(request.headers.cookie)!) : null,
        redirectUri: config.twitchOAuthRedirectUri,
        expiresAt: new Date(Date.now() + stateTtlMs)
      }
    });
    response.cookie(stateCookie, binding, {
      httpOnly: true,
      secure: isProduction,
      sameSite: "lax",
      path: "/api/auth/twitch",
      maxAge: stateTtlMs
    });
    const authorize = new URL("https://id.twitch.tv/oauth2/authorize");
    authorize.searchParams.set("response_type", "code");
    authorize.searchParams.set("client_id", config.twitchClientId);
    authorize.searchParams.set("redirect_uri", config.twitchOAuthRedirectUri);
    authorize.searchParams.set("scope", scopes.join(" "));
    authorize.searchParams.set("state", state);
    response.setHeader("Cache-Control", "no-store");
    response.redirect(authorize.toString());
  });

  router.get("/callback", async (request, response) => {
    response.clearCookie(stateCookie, { path: "/api/auth/twitch" });
    response.setHeader("Cache-Control", "no-store");
    const state = request.query.state;
    const binding = request.headers.cookie ? parse(request.headers.cookie)[stateCookie] : undefined;
    if (typeof state !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(state) || !binding) {
      fail(response, "invalid_state");
      return;
    }
    const grant = await prisma.twitchOAuthState.findUnique({ where: { stateHash: hash(state) } });
    const popup = grant?.mode === "unified_popup";
    if (
      !grant ||
      grant.bindingHash !== hash(binding) ||
      grant.expiresAt <= new Date() ||
      grant.redirectUri !== config.twitchOAuthRedirectUri ||
      (
        await prisma.twitchOAuthState.deleteMany({
          where: {
            stateHash: grant.stateHash,
            bindingHash: grant.bindingHash,
            expiresAt: { gt: new Date() }
          }
        })
      ).count !== 1
    ) {
      fail(response, "invalid_state", popup);
      return;
    }
    const existing = await getSessionFromCookieHeader(request.headers.cookie);
    if (grant.mode === "bind" && (
      existing?.authMethod !== "LEGACY" ||
      existing.user.role !== "OWNER" ||
      grant.legacySessionHash !== hashSessionToken(readSessionToken(request.headers.cookie) ?? "")
    )) {
      fail(response, "legacy_owner_required", popup);
      return;
    }
    if (grant.mode !== "bind" && existing?.authMethod === "LEGACY") {
      fail(response, "legacy_session", popup);
      return;
    }
    if (request.query.error) {
      fail(response, "denied", popup);
      return;
    }
    if (
      typeof request.query.code !== "string" ||
      !request.query.code ||
      (grant.mode !== "unified" && grant.mode !== "unified_popup" && grant.mode !== "bind")
    ) {
      fail(response, "invalid_response", popup);
      return;
    }
    try {
      const mode = "unified";
      const body = new URLSearchParams({
        client_id: config.twitchClientId,
        client_secret: config.twitchClientSecret,
        code: request.query.code,
        grant_type: "authorization_code",
        redirect_uri: grant.redirectUri
      });
      const tokens = await twitchJson<{
        access_token: string;
        refresh_token: string;
        expires_in: number;
        scope: string[];
      }>("https://id.twitch.tv/oauth2/token", { method: "POST", body });
      if (
        !tokens.access_token ||
        !tokens.refresh_token ||
        !Number.isFinite(tokens.expires_in) ||
        tokens.expires_in <= 0 ||
        !Array.isArray(tokens.scope)
      )
        throw new Error("Invalid token response");
      if (!scopes.every((scope) => tokens.scope.includes(scope))) {
        fail(response, "insufficient_scope", popup);
        return;
      }
      const validated = await twitchJson<{ client_id: string; user_id: string; scopes: string[] }>(
        "https://id.twitch.tv/oauth2/validate",
        { headers: { Authorization: `OAuth ${tokens.access_token}` } }
      );
      if (validated.client_id !== config.twitchClientId || !/^\d+$/.test(validated.user_id) ||
          !Array.isArray(validated.scopes))
        throw new Error("Invalid token identity or scopes");
      if (!scopes.every((scope) => validated.scopes.includes(scope))) {
        fail(response, "insufficient_scope", popup);
        return;
      }
      const users = await twitchJson<{
        data: Array<{ id: string; login: string; display_name: string; profile_image_url: string }>;
      }>("https://api.twitch.tv/helix/users", {
        headers: {
          Authorization: `Bearer ${tokens.access_token}`,
          "Client-Id": config.twitchClientId
        }
      });
      const profile = users.data?.[0];
      if (!profile || profile.id !== validated.user_id || !profile.login)
        throw new Error("Invalid Twitch profile");
      const channel = grant.mode === "bind" ? await getDefaultStreamer() : null;
      if (channel && (channel.ownerUserId || (channel.twitchBroadcasterId && channel.twitchBroadcasterId !== profile.id))) {
        throw new Error("Channel already bound or broadcaster mismatch");
      }
      const user = await prisma.$transaction(async (tx) => {
        const existingUser = await tx.user.findUnique({ where: { twitchUserId: profile.id } });
        const account = existingUser
          ? await tx.user.update({
              where: { id: existingUser.id },
              data: {
                displayName: profile.display_name,
                twitchLogin: profile.login,
                twitchAvatarUrl: profile.profile_image_url
              }
            })
          : await tx.user.create({
              data: {
                username: `twitch:${profile.id}`,
                displayName: profile.display_name,
                passwordHash: "!twitch-oauth-only",
                role: "MODERATOR",
                permissionsJson: "{}",
                twitchUserId: profile.id,
                twitchLogin: profile.login,
                twitchAvatarUrl: profile.profile_image_url
              }
            });
        await tx.twitchOAuthConnection.upsert({
          where: { userId_mode: { userId: account.id, mode } },
          create: {
            userId: account.id,
            mode,
            encryptedAccess: encryptOAuthToken(tokens.access_token),
            encryptedRefresh: encryptOAuthToken(tokens.refresh_token),
            scopesJson: JSON.stringify(validated.scopes),
            expiresAt: new Date(Date.now() + tokens.expires_in * 1000),
            checkedAt: new Date()
          },
          update: {
            encryptedAccess: encryptOAuthToken(tokens.access_token),
            encryptedRefresh: encryptOAuthToken(tokens.refresh_token),
            scopesJson: JSON.stringify(validated.scopes),
            expiresAt: new Date(Date.now() + tokens.expires_in * 1000),
            checkedAt: new Date(),
            revokedAt: null
          }
        });
        if (channel) {
          const conflicting = await tx.streamer.findFirst({ where: { twitchBroadcasterId: profile.id, id: { not: channel.id } } });
          if (conflicting) throw new Error("Twitch owner already bound");
          const updated = await tx.streamer.updateMany({
            where: { id: channel.id, ownerUserId: null },
            data: { ownerUserId: account.id, twitchBroadcasterId: profile.id, twitchLogin: profile.login }
          });
          if (updated.count !== 1) throw new Error("Channel binding conflict");
        }
        return account;
      });
      if (channel) {
        await destroySession(request, response);
        await createSession(user.id, response, mode);
        response.redirect(303, "/channels?oauth_bound=1");
        return;
      }
      if (existing) await destroySession(request, response);
      await createSession(user.id, response, mode);
      response.redirect(303, popup ? "/oauth/popup?success=1" : "/channels");
    } catch {
      fail(response, "twitch_unavailable", popup);
    }
  });

  router.get("/me", requireTwitchAuth, async (request, response) => {
    const session = await getSessionFromCookieHeader(request.headers.cookie);
    response.setHeader("Cache-Control", "no-store");
    response.json({
      user: {
        id: session!.user.twitchUserId,
        login: session!.user.twitchLogin,
        displayName: session!.user.displayName,
        avatarUrl: session!.user.twitchAvatarUrl
      },
      csrfToken: getCsrfTokenFromRequest(request)
    });
  });

  router.post("/channels", requireTwitchAuth, async (request, response) => {
    const session = (await getSessionFromCookieHeader(request.headers.cookie))!;
    if (session.twitchMode !== "unified") {
      response.status(403).json({ error: "Unified Twitch session required" });
      return;
    }
    try {
      if (!(await verifyStreamerIdentity(session.user.id, session.user.twitchUserId!))) {
        response.status(403).json({ error: "Twitch identity could not be verified. Sign in again." });
        return;
      }
      const existing = await prisma.streamer.findUnique({ where: { ownerUserId: session.user.id } });
      if (existing) {
        response.setHeader("Cache-Control", "no-store");
        response.json({ channel: { id: existing.id } });
        return;
      }
      let created = true;
      const channel = await prisma.streamer.create({
        data: {
          displayName: session.user.displayName,
          twitchBroadcasterId: session.user.twitchUserId!,
          twitchLogin: session.user.twitchLogin,
          ownerUserId: session.user.id,
          overlayToken: crypto.randomBytes(32).toString("hex"),
          canvasWidth: 1920,
          canvasHeight: 1080,
          settingsJson: "{}"
        }
      }).catch(async (error: unknown) => {
        const owned = await prisma.streamer.findUnique({ where: { ownerUserId: session.user.id } });
        if (owned) { created = false; return owned; }
        throw error;
      });
      // Moderator synchronization is allowed to fail closed; channel creation remains durable.
      await syncModerators(channel.id).catch(() => undefined);
      response.setHeader("Cache-Control", "no-store");
      response.status(created ? 201 : 200).json({ channel: { id: channel.id } });
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "P2002") {
        response.status(409).json({ error: "This Twitch channel is already connected" });
      } else {
        response.status(503).json({ error: "Could not verify or connect the Twitch channel" });
      }
    }
  });

  router.get("/channels", requireTwitchAuth, async (request, response) => {
    const session = (await getSessionFromCookieHeader(request.headers.cookie))!;
    try {
      if (!(await verifyStreamerIdentity(session.user.id, session.user.twitchUserId!))) throw new Error("Twitch identity revoked");
      const channels = await getModeratedChannels(session.user.id);
      channels.add(session.user.twitchUserId!);
      const profiles = await getTwitchProfiles(session.user.id, [...channels]).catch(() => []);
      const linked = await prisma.streamer.findMany({
        where: { twitchBroadcasterId: { in: [...channels] }, ownerUserId: { not: null } },
        select: { id: true, displayName: true, twitchLogin: true, twitchBroadcasterId: true, ownerUserId: true }
      });
      const result: TwitchChannelView[] = [];
      for (const id of channels) {
        const channel = linked.find((item) => item.twitchBroadcasterId === id);
        const profile = profiles.find((item) => item.id === id);
        let status: ChannelStatus = "unconnected";
        if (channel) {
          if (channel.ownerUserId !== session.user.id && await prisma.channelModeratorBan.findUnique({ where: { channelId_userId: { channelId: channel.id, userId: session.user.id } } })) status = "denied";
          else {
            try { status = await canAccessChannel(session, channel.id) ? "connected" : "error"; }
            catch { status = "error"; }
          }
        }
        result.push({ id: channel?.id ?? null, twitchId: id, displayName: profile?.displayName ?? channel?.displayName ?? id, avatarUrl: profile?.avatarUrl ?? null, status,
          role: id === session.user.twitchUserId && (!channel || channel.ownerUserId === session.user.id) ? "owner" : "moderator" });
      }
      response.setHeader("Cache-Control", "no-store");
      response.json({ channels: result });
    } catch {
      response.status(503).json({ error: "Twitch access verification unavailable" });
    }
  });

  async function ownsChannel(request: express.Request): Promise<boolean> {
    const session = await getSessionFromCookieHeader(request.headers.cookie);
    if (!session || session.twitchMode !== "unified") return false;
    const channelId = String(request.params.channelId);
    const channel = await prisma.streamer.findUnique({ where: { id: channelId }, select: { ownerUserId: true } });
    return channel?.ownerUserId === session.user.id && await channelRole(session, channelId) === "owner";
  }

  router.post("/channels/:channelId/overlay-reload", requireTwitchAuth, async (request, response) => {
    if (!(await ownsChannel(request))) {
      response.status(403).json({ error: "Only this channel's owner can reload its OBS overlay" });
      return;
    }
    const result = requestOverlayReload(String(request.params.channelId));
    response.setHeader("Cache-Control", "no-store");
    if (result.code === 503) {
      response.status(503).json({ error: "OBS overlay is not connected" });
      return;
    }
    if (result.code === 409) {
      response.status(409).json({ error: "Reload is already running or was requested recently" });
      return;
    }
    response.json(result.status);
  });

  router.get("/channels/:channelId/overlay-reload/:operationId", requireTwitchAuth, async (request, response) => {
    if (!(await ownsChannel(request))) {
      response.status(403).json({ error: "Only this channel's owner can view reload status" });
      return;
    }
    const status = overlayReload.get(String(request.params.channelId), String(request.params.operationId));
    response.setHeader("Cache-Control", "no-store");
    if (!status) { response.status(404).json({ error: "Reload operation not found" }); return; }
    response.json(status);
  });

  router.get("/channels/:channelId/moderators", requireTwitchAuth, async (request, response) => {
    const session = (await getSessionFromCookieHeader(request.headers.cookie))!;
    const channelId = String(request.params.channelId);
    const channel = await prisma.streamer.findUnique({ where: { id: channelId } });
    if (!channel || channel.ownerUserId !== session.user.id || session.twitchMode !== "unified" || await channelRole(session, channelId) !== "owner") {
      response.status(403).json({ error: "Permission denied" });
      return;
    }
    try {
      const ids = await syncModerators(channelId);
      const profiles = await getTwitchProfiles(session.user.id, [...ids]);
      for (const profile of profiles) await prisma.user.upsert({
        where: { twitchUserId: profile.id },
        create: { username: `twitch:${profile.id}`, twitchUserId: profile.id, displayName: profile.displayName, twitchLogin: profile.login, twitchAvatarUrl: profile.avatarUrl, passwordHash: "!twitch-oauth-only" },
        update: { displayName: profile.displayName, twitchLogin: profile.login, twitchAvatarUrl: profile.avatarUrl }
      });
      const users = await prisma.user.findMany({ where: { twitchUserId: { in: [...ids] } }, select: { id: true, twitchUserId: true, displayName: true, twitchAvatarUrl: true } });
      const bans = await prisma.channelModeratorBan.findMany({ where: { channelId }, select: { userId: true } });
      response.setHeader("Cache-Control", "no-store");
      const moderators: TwitchModeratorView[] = users
        .filter((user): user is typeof user & { twitchUserId: string } => user.twitchUserId !== null)
        .map((user) => ({ ...user, banned: bans.some((ban) => ban.userId === user.id) }));
      response.json({ moderators });
    } catch {
      response.status(503).json({ error: "Twitch access verification unavailable" });
    }
  });

  for (const method of ["put", "delete"] as const) router[method]("/channels/:channelId/bans/:userId", requireTwitchAuth, async (request, response) => {
    const session = (await getSessionFromCookieHeader(request.headers.cookie))!;
    const channelId = String(request.params.channelId);
    if (session.twitchMode !== "unified" || await channelRole(session, channelId) !== "owner") { response.status(403).json({ error: "Permission denied" }); return; }
    try {
      await setModeratorBan(channelId, session.user.id, String(request.params.userId), method === "put");
      response.json({ ok: true });
    } catch { response.status(403).json({ error: "Permission denied" }); }
  });

  return router;
}
