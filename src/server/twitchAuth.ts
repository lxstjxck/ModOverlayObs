import crypto from "node:crypto";
import express from "express";
import { parse } from "cookie";
import { config, isProduction } from "./config";
import { prisma } from "./db";
import {
  createSession,
  destroySession,
  getCsrfTokenFromRequest,
  getSessionFromCookieHeader,
  requireTwitchAuth
} from "./auth";
import { clientIp, createRateLimitMiddleware } from "./security";

type TwitchMode = "streamer" | "moderator";
const stateCookie = "mod_overlay_twitch_state";
const stateTtlMs = 10 * 60_000;
const scopes: Record<TwitchMode, string> = {
  streamer: "moderation:read",
  moderator: "user:read:moderated_channels"
};
const target: Record<TwitchMode, string> = { streamer: "/streamer", moderator: "/channels" };
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

function encrypt(value: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(
    "aes-256-gcm",
    Buffer.from(config.oauthTokenEncryptionKey, "hex"),
    iv
  );
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), ciphertext].map((part) => part.toString("base64url")).join(".");
}

async function twitchJson<T>(url: string, init: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error("Twitch authorization failed");
  return (await response.json()) as T;
}

function fail(response: express.Response, reason: string): void {
  response.setHeader("Cache-Control", "no-store");
  response.redirect(303, `/login?oauth_error=${reason}`);
}

export function twitchAuthRouter(): express.Router {
  const router = express.Router();

  router.get("/start/:mode", startLimit, async (request, response) => {
    const mode = request.params.mode;
    if (mode !== "streamer" && mode !== "moderator") {
      response.status(404).json({ error: "Unknown login mode" });
      return;
    }
    if (!configured()) {
      response.status(503).json({ error: "Twitch login is not configured" });
      return;
    }
    const existing = await getSessionFromCookieHeader(request.headers.cookie);
    if (existing?.authMethod === "LEGACY") {
      response.status(409).json({ error: "Sign out of the legacy account before Twitch login" });
      return;
    }
    const state = crypto.randomBytes(32).toString("base64url");
    const binding = crypto.randomBytes(32).toString("base64url");
    await prisma.twitchOAuthState.deleteMany({ where: { expiresAt: { lt: new Date() } } });
    await prisma.twitchOAuthState.create({
      data: {
        stateHash: hash(state),
        bindingHash: hash(binding),
        mode,
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
    authorize.searchParams.set("scope", scopes[mode]);
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
      fail(response, "invalid_state");
      return;
    }
    const existing = await getSessionFromCookieHeader(request.headers.cookie);
    if (existing?.authMethod === "LEGACY") {
      fail(response, "legacy_session");
      return;
    }
    if (request.query.error) {
      fail(response, "denied");
      return;
    }
    if (
      typeof request.query.code !== "string" ||
      !request.query.code ||
      (grant.mode !== "streamer" && grant.mode !== "moderator")
    ) {
      fail(response, "invalid_response");
      return;
    }
    try {
      const mode = grant.mode as TwitchMode;
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
        tokens.expires_in <= 0
      )
        throw new Error("Invalid token response");
      const validated = await twitchJson<{ client_id: string; user_id: string; scopes: string[] }>(
        "https://id.twitch.tv/oauth2/validate",
        { headers: { Authorization: `OAuth ${tokens.access_token}` } }
      );
      if (
        validated.client_id !== config.twitchClientId ||
        !/^\d+$/.test(validated.user_id) ||
        !Array.isArray(validated.scopes) ||
        !validated.scopes.includes(scopes[mode])
      )
        throw new Error("Invalid token identity or scopes");
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
            encryptedAccess: encrypt(tokens.access_token),
            encryptedRefresh: encrypt(tokens.refresh_token),
            scopesJson: JSON.stringify(validated.scopes),
            expiresAt: new Date(Date.now() + tokens.expires_in * 1000),
            checkedAt: new Date()
          },
          update: {
            encryptedAccess: encrypt(tokens.access_token),
            encryptedRefresh: encrypt(tokens.refresh_token),
            scopesJson: JSON.stringify(validated.scopes),
            expiresAt: new Date(Date.now() + tokens.expires_in * 1000),
            checkedAt: new Date(),
            revokedAt: null
          }
        });
        return account;
      });
      if (existing) await destroySession(request, response);
      await createSession(user.id, response, mode);
      response.redirect(303, target[mode]);
    } catch {
      fail(response, "twitch_unavailable");
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
      mode: session!.twitchMode,
      csrfToken: getCsrfTokenFromRequest(request)
    });
  });

  return router;
}
