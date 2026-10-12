import crypto from "node:crypto";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import type { Request, Response } from "express";
import express from "express";
import { parse } from "cookie";
import type { Server } from "socket.io";
import { z } from "zod";
import type { TtsSetupView } from "../shared/types";
import { getSessionFromCookieHeader, hashSessionToken, readSessionToken, requireAuth, type AuthenticatedRequest } from "./auth";
import { config, isProduction } from "./config";
import { prisma } from "./db";
import { getDefaultStreamer, writeAudit } from "./state";
import { moderatorTtsText, redemptionTtsText, type TwitchChatMessage } from "./ttsPolicy";
import { cleanupStaleTtsFiles } from "./ttsFiles";

type StoredTwitch = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  broadcasterId: string;
  broadcasterLogin: string;
  rewardId: string | null;
  rewardCost: number;
  enabled?: boolean;
  revoked?: boolean;
  error?: string | null;
};
type TtsJob = { text: string; userId: string; streamerId: string; redemptionId?: string };
type ActiveJob = { id: string; file: string; socketId: string; job: TtsJob; timer: NodeJS.Timeout };
type ChannelRuntime = {
  socket: WebSocket | null;
  pendingSocket: WebSocket | null;
  subscribed: boolean;
  reconnectTimer: NodeJS.Timeout | null;
  reconnectAttempts: number;
  seenEvents: Map<string, number>;
  lastUsed: Map<string, number>;
  queue: TtsJob[];
  active: ActiveJob | null;
  generation: number;
  refreshPromise: Promise<{ token: string; settings: StoredTwitch }> | null;
  tokenCheckTimer: NodeJS.Timeout | null;
};

const oauthStates = new Map<string, { sessionHash: string; expiresAt: number }>();
const channels = new Map<string, ChannelRuntime>();
let generating = false;
let lastGeneratedChannel: string | null = null;
let generatingChannel: string | null = null;
let cancelGeneration: (() => void) | null = null;
let io: Server | null = null;
let stopping = false;
let cleanupTimer: NodeJS.Timeout | null = null;
const ttsStateCookie = "mod_overlay_tts_state";
const requiredScopes = ["user:read:chat", "channel:manage:redemptions"];
const perChannelQueueLimit = 10;
const globalQueueLimit = 100;

function runtime(channelId: string): ChannelRuntime {
  let value = channels.get(channelId);
  if (!value) {
    value = { socket: null, pendingSocket: null, subscribed: false, reconnectTimer: null, reconnectAttempts: 0,
      seenEvents: new Map(), lastUsed: new Map(), queue: [], active: null, generation: 0,
      refreshPromise: null, tokenCheckTimer: null };
    channels.set(channelId, value);
  }
  return value;
}
const costSchema = z.object({ cost: z.number().int().min(1).max(1_000_000) });

function debugTts(message: string): void {
  if (process.env.TTS_DEBUG === "1") console.info(`[TTS] ${message}`);
}

function callbackUrl(): string {
  return `${(config.publicOrigin || config.domain).replace(/\/$/, "")}/api/tts/callback`;
}

function settingKey(streamerId: string): string {
  return `tts:twitch:${streamerId}`;
}

function encrypt(value: StoredTwitch, modern = false): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(
    "aes-256-gcm",
    modern ? Buffer.from(config.oauthTokenEncryptionKey, "hex") : crypto.createHash("sha256").update(config.sessionSecret).digest(),
    iv
  );
  const data = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  const ciphertext = [iv, cipher.getAuthTag(), data].map((part) => part.toString("base64url")).join(".");
  return modern ? `v2:${ciphertext}` : ciphertext;
}

function decrypt(value: string): StoredTwitch {
  const modern = value.startsWith("v2:");
  const [iv, tag, data] = (modern ? value.slice(3) : value).split(".").map((part) => Buffer.from(part, "base64url"));
  if (!iv || !tag || !data) throw new Error("Invalid Twitch settings");
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    modern ? Buffer.from(config.oauthTokenEncryptionKey, "hex") : crypto.createHash("sha256").update(config.sessionSecret).digest(),
    iv
  );
  decipher.setAuthTag(tag);
  return JSON.parse(
    Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8")
  ) as StoredTwitch;
}

async function loadTwitch(channelId?: string): Promise<StoredTwitch | null> {
  const id = channelId ?? (await getDefaultStreamer()).id;
  const row = await prisma.settings.findUnique({ where: { key: settingKey(id) } });
  return row ? decrypt(row.value) : null;
}

async function saveTwitch(value: StoredTwitch, channelId?: string): Promise<void> {
  const id = channelId ?? (await getDefaultStreamer()).id;
  const key = settingKey(id);
  const existing = await prisma.settings.findUnique({ where: { key }, select: { value: true } });
  const ciphertext = encrypt(value, existing ? existing.value.startsWith("v2:") : Boolean(channelId));
  await prisma.settings.upsert({
    where: { key },
    create: { key, value: ciphertext },
    update: { value: ciphertext }
  });
}

async function accessToken(channelId: string, force = false): Promise<{ token: string; settings: StoredTwitch }> {
  const settings = await loadTwitch(channelId);
  if (!settings) throw new Error("Twitch is not connected");
  if (settings.revoked) throw new Error("Twitch authorization revoked");
  if (!force && settings.expiresAt > Date.now() + 60_000) return { token: settings.accessToken, settings };
  const state = runtime(channelId);
  if (state.refreshPromise) return state.refreshPromise;
  state.refreshPromise = refreshTwitchToken(channelId, settings).finally(() => {
    state.refreshPromise = null;
  });
  return state.refreshPromise;
}

async function refreshTwitchToken(
  channelId: string,
  settings: StoredTwitch
): Promise<{ token: string; settings: StoredTwitch }> {
  const response = await fetch("https://id.twitch.tv/oauth2/token", {
    method: "POST",
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: settings.refreshToken,
      client_id: config.twitchClientId,
      client_secret: config.twitchClientSecret
    }),
    signal: AbortSignal.timeout(10_000)
  });
  if (!response.ok) {
    if (response.status === 400 || response.status === 401) await revokeTwitch(channelId, "Twitch authorization expired or revoked", settings.refreshToken);
    throw new Error("Twitch token refresh failed");
  }
  const body = (await response.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
    scope?: string[];
  };
  if (!body.access_token || !body.refresh_token || !body.expires_in ||
      (body.scope && !requiredScopes.every((scope) => body.scope!.includes(scope)))) {
    await revokeTwitch(channelId, "Twitch TTS permissions were removed", settings.refreshToken);
    throw new Error("Twitch TTS scopes revoked");
  }
  const current = await prisma.settings.findUnique({ where: { key: settingKey(channelId) } });
  if (!current) throw new Error("Twitch TTS connection was removed");
  const latest = decrypt(current.value);
  if (latest.revoked) throw new Error("Twitch authorization revoked");
  if (latest.refreshToken !== settings.refreshToken) return { token: latest.accessToken, settings: latest };
  const updated = {
    ...latest,
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
    expiresAt: Date.now() + body.expires_in * 1000
  };
  const written = await prisma.settings.updateMany({ where: { key: settingKey(channelId), value: current.value },
    data: { value: encrypt(updated, current.value.startsWith("v2:")) } });
  if (written.count !== 1) {
    const newer = await loadTwitch(channelId);
    if (!newer || newer.revoked) throw new Error("Twitch TTS connection changed");
    return { token: newer.accessToken, settings: newer };
  }
  return { token: updated.accessToken, settings: updated };
}

async function twitchApi(channelId: string, url: string, method = "GET", body?: object): Promise<unknown> {
  let { token } = await accessToken(channelId);
  const call = (value: string) => fetch(`https://api.twitch.tv/helix/${url}`, {
    method,
    headers: {
      "Client-ID": config.twitchClientId,
      Authorization: `Bearer ${value}`,
      ...(body ? { "Content-Type": "application/json" } : {})
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(10_000)
  });
  let response = await call(token);
  if (response.status === 401) {
    token = (await accessToken(channelId, true)).token;
    response = await call(token);
  }
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) await revokeTwitch(channelId, "Twitch TTS authorization was revoked", token);
    throw new Error(`Twitch API failed (${response.status})`);
  }
  if (response.status === 204) return null;
  return response.json();
}

function ownerOnly(request: Request, response: Response, next: () => void): void {
  if ((request as AuthenticatedRequest).user.role !== "OWNER") {
    response.status(403).json({ error: "Owner access required" });
    return;
  }
  next();
}

async function twitchOwnerChannel(request: Request, response: Response) {
  const session = await getSessionFromCookieHeader(request.headers.cookie);
  if (session?.authMethod !== "TWITCH" || session.twitchMode !== "streamer" || !session.user.twitchUserId) {
    response.status(403).json({ error: "Streamer Twitch session required" });
    return null;
  }
  const channel = typeof request.params.channelId === "string"
    ? await prisma.streamer.findUnique({ where: { id: request.params.channelId } }) : null;
  if (!channel || channel.ownerUserId !== session.userId || channel.twitchBroadcasterId !== session.user.twitchUserId) {
    response.status(404).json({ error: "Channel not found" });
    return null;
  }
  return channel;
}

function ttsView(channelId: string, settings: StoredTwitch | null, modern = false): TtsSetupView {
  const state = channels.get(channelId);
  return {
    configured: Boolean(config.twitchClientId && config.twitchClientSecret && config.ttsPython &&
      (!modern || /^[0-9a-f]{64}$/i.test(config.oauthTokenEncryptionKey))),
    connected: Boolean(settings && !settings.revoked),
    broadcasterLogin: settings?.broadcasterLogin ?? null,
    rewardId: settings?.rewardId ?? null,
    rewardCost: settings?.rewardCost ?? 1000,
    enabled: settings?.enabled !== false,
    error: settings?.error ?? null,
    queueLength: state?.queue.length ?? 0,
    ready: Boolean(settings && settings.enabled !== false && !settings.revoked && state?.subscribed && state.socket?.readyState === WebSocket.OPEN)
  };
}

async function rewardChange(request: Request, response: Response, update: boolean): Promise<void> {
  const channel = await twitchOwnerChannel(request, response);
  if (!channel) return;
  const parsed = costSchema.safeParse(request.body);
  if (!parsed.success) { response.status(400).json({ error: "Invalid reward cost" }); return; }
  const settings = await loadTwitch(channel.id).catch(() => null);
  if (!settings || settings.revoked) { response.status(409).json({ error: "Connect Twitch TTS first" }); return; }
  if (update ? !settings.rewardId : Boolean(settings.rewardId)) {
    response.status(409).json({ error: update ? "Create reward first" : "Reward already exists" }); return;
  }
  try {
    const result = await twitchApi(channel.id,
      `channel_points/custom_rewards?broadcaster_id=${encodeURIComponent(settings.broadcasterId)}${update ? `&id=${encodeURIComponent(settings.rewardId!)}` : ""}`,
      update ? "PATCH" : "POST", update ? { cost: parsed.data.cost } : {
        title: "TTS на стриме", prompt: "Введите текст для озвучки (до 200 символов)",
        cost: parsed.data.cost, is_user_input_required: true,
        should_redemptions_skip_request_queue: false, is_enabled: true, is_paused: false
      }) as { data?: Array<{ id: string }> } | null;
    const rewardId = update ? settings.rewardId! : result?.data?.[0]?.id;
    if (!rewardId) throw new Error("Reward creation failed");
    await saveTwitch({ ...(await loadTwitch(channel.id))!, rewardId, rewardCost: parsed.data.cost }, channel.id);
    await writeAudit(channel.id, channel.ownerUserId, update ? "tts.reward_cost_changed" : "tts.reward_created", { cost: parsed.data.cost });
    response.json({ rewardId, rewardCost: parsed.data.cost });
  } catch {
    response.status(502).json({ error: "Could not update Twitch reward" });
  }
}

export function ttsRouter(): express.Router {
  const router = express.Router();
  router.get("/audio/:id", (request, response) => {
    const match = [...channels.values()].map((state) => state.active).find((job) => job?.id === request.params.id);
    sendTtsAudio(request, response, match ?? null);
  });
  router.get("/channels/:channelId", async (request, response) => {
    const channel = await twitchOwnerChannel(request, response);
    if (!channel) return;
    const settings = await loadTwitch(channel.id).catch(() => null);
    response.setHeader("Cache-Control", "no-store");
    response.json(ttsView(channel.id, settings, true));
  });
  router.get("/channels/:channelId/connect", async (request, response) => {
    const channel = await twitchOwnerChannel(request, response);
    if (!channel) return;
    if (!config.twitchClientId || !config.twitchClientSecret || !config.ttsPython ||
        !/^[0-9a-f]{64}$/i.test(config.oauthTokenEncryptionKey)) {
      response.status(503).json({ error: "Twitch and TTS settings are incomplete" });
      return;
    }
    const sessionToken = readSessionToken(request.headers.cookie)!;
    const state = crypto.randomBytes(32).toString("base64url");
    const binding = crypto.randomBytes(32).toString("base64url");
    const hash = (value: string) => crypto.createHash("sha256").update(value).digest("hex");
    await prisma.twitchOAuthState.deleteMany({ where: { expiresAt: { lt: new Date() } } });
    await prisma.twitchOAuthState.create({ data: {
      stateHash: hash(state), bindingHash: hash(binding), mode: `tts:${channel.id}`,
      legacySessionHash: hashSessionToken(sessionToken), redirectUri: callbackUrl(),
      expiresAt: new Date(Date.now() + 10 * 60_000)
    } });
    response.cookie(ttsStateCookie, binding, { httpOnly: true, secure: isProduction, sameSite: "lax", path: "/api/tts", maxAge: 10 * 60_000 });
    const url = new URL("https://id.twitch.tv/oauth2/authorize");
    url.search = new URLSearchParams({ response_type: "code", client_id: config.twitchClientId,
      redirect_uri: callbackUrl(), scope: requiredScopes.join(" "), state }).toString();
    response.setHeader("Cache-Control", "no-store");
    response.redirect(url.toString());
  });
  router.get("/callback", async (request, response, next) => {
    const state = typeof request.query.state === "string" ? request.query.state : "";
    if (!/^[A-Za-z0-9_-]{43}$/.test(state)) {
      if ((await getSessionFromCookieHeader(request.headers.cookie))?.authMethod === "TWITCH")
        response.status(400).send("Invalid Twitch TTS authorization state");
      else next();
      return;
    }
    const stateHash = crypto.createHash("sha256").update(state).digest("hex");
    const grant = await prisma.twitchOAuthState.findUnique({ where: { stateHash } });
    if (!grant?.mode.startsWith("tts:")) {
      if ((await getSessionFromCookieHeader(request.headers.cookie))?.authMethod === "TWITCH")
        response.status(400).send("Invalid Twitch TTS authorization state");
      else next();
      return;
    }
    response.clearCookie(ttsStateCookie, { path: "/api/tts" });
    response.setHeader("Cache-Control", "no-store");
    const binding = parse(request.headers.cookie ?? "")[ttsStateCookie];
    const token = readSessionToken(request.headers.cookie);
    const channelId = grant.mode.slice(4);
    const session = await getSessionFromCookieHeader(request.headers.cookie);
    const channel = await prisma.streamer.findUnique({ where: { id: channelId } });
    if (!binding || crypto.createHash("sha256").update(binding).digest("hex") !== grant.bindingHash ||
        grant.expiresAt <= new Date() || grant.redirectUri !== callbackUrl() || !token ||
        grant.legacySessionHash !== hashSessionToken(token) ||
        session?.authMethod !== "TWITCH" || session.twitchMode !== "streamer" ||
        !channel || channel.ownerUserId !== session.userId || channel.twitchBroadcasterId !== session.user.twitchUserId ||
        (await prisma.twitchOAuthState.deleteMany({ where: { stateHash, bindingHash: grant.bindingHash, expiresAt: { gt: new Date() } } })).count !== 1 ||
        typeof request.query.code !== "string") {
      response.status(400).send("Invalid Twitch TTS authorization state");
      return;
    }
    try {
      const tokenResponse = await fetch("https://id.twitch.tv/oauth2/token", { method: "POST",
        body: new URLSearchParams({ client_id: config.twitchClientId, client_secret: config.twitchClientSecret,
          code: request.query.code, grant_type: "authorization_code", redirect_uri: callbackUrl() }),
        signal: AbortSignal.timeout(10_000) });
      if (!tokenResponse.ok) throw new Error("Twitch token exchange failed");
      const tokens = await tokenResponse.json() as { access_token?: string; refresh_token?: string; expires_in?: number };
      if (!tokens.access_token || !tokens.refresh_token || !tokens.expires_in) throw new Error("Invalid Twitch token response");
      const validatedResponse = await fetch("https://id.twitch.tv/oauth2/validate", {
        headers: { Authorization: `OAuth ${tokens.access_token}` }, signal: AbortSignal.timeout(10_000) });
      if (!validatedResponse.ok) throw new Error("Twitch token validation failed");
      const validated = await validatedResponse.json() as { client_id?: string; user_id?: string; login?: string; scopes?: string[] };
      if (validated.client_id !== config.twitchClientId || validated.user_id !== channel.twitchBroadcasterId ||
          !requiredScopes.every((scope) => validated.scopes?.includes(scope))) {
        response.status(403).send("Twitch account or TTS permissions do not match this channel");
        return;
      }
      const previous = await loadTwitch(channel.id).catch(() => null);
      await saveTwitch({ accessToken: tokens.access_token, refreshToken: tokens.refresh_token,
        expiresAt: Date.now() + tokens.expires_in * 1000, broadcasterId: validated.user_id,
        broadcasterLogin: validated.login ?? channel.twitchLogin ?? "", enabled: true,
        revoked: false, error: null,
        rewardId: previous?.broadcasterId === validated.user_id ? previous.rewardId : null,
        rewardCost: previous?.broadcasterId === validated.user_id ? previous.rewardCost : 1000 }, channel.id);
      await writeAudit(channel.id, session.userId, "tts.twitch_connected");
      restartTwitch(channel.id);
      response.redirect(303, "/streamer?tts=connected");
    } catch {
      response.status(502).send("Twitch TTS connection failed. Return to streamer panel and try again.");
    }
  });
  router.put("/channels/:channelId/enabled", async (request, response) => {
    const channel = await twitchOwnerChannel(request, response);
    if (!channel) return;
    const parsed = z.object({ enabled: z.boolean() }).safeParse(request.body);
    if (!parsed.success) { response.status(400).json({ error: "Invalid TTS setting" }); return; }
    const settings = await loadTwitch(channel.id).catch(() => null);
    if (!settings || settings.revoked) { response.status(409).json({ error: "Reconnect Twitch TTS first" }); return; }
    await saveTwitch({ ...settings, enabled: parsed.data.enabled, error: null }, channel.id);
    if (parsed.data.enabled) restartTwitch(channel.id);
    else await stopChannel(channel.id);
    await writeAudit(channel.id, channel.ownerUserId, parsed.data.enabled ? "tts.enabled" : "tts.disabled");
    response.json(ttsView(channel.id, { ...settings, enabled: parsed.data.enabled, error: null }, true));
  });
  router.post("/channels/:channelId/reward", async (request, response) => rewardChange(request, response, false));
  router.patch("/channels/:channelId/reward", async (request, response) => rewardChange(request, response, true));
  router.use(async (request, response, next) => {
    const session = await getSessionFromCookieHeader(request.headers.cookie);
    if (session?.authMethod === "TWITCH") {
      response.status(503).json({ error: "TTS for new Twitch channels is not available yet. Existing legacy channel TTS is unchanged." });
      return;
    }
    next();
  });
  router.get("/", requireAuth, ownerOnly, async (_request, response) => {
    const settings = await loadTwitch().catch(() => null);
    const view = ttsView((await getDefaultStreamer()).id, settings);
    response.json(view);
  });
  router.get("/connect", requireAuth, ownerOnly, (request, response) => {
    if (!config.twitchClientId || !config.twitchClientSecret || !config.ttsPython) {
      response.status(503).json({ error: "Twitch and TTS settings are incomplete" });
      return;
    }
    const session = readSessionToken(request.headers.cookie);
    if (!session) {
      response.sendStatus(401);
      return;
    }
    for (const [state, grant] of oauthStates)
      if (grant.expiresAt < Date.now()) oauthStates.delete(state);
    const state = crypto.randomBytes(32).toString("base64url");
    oauthStates.set(state, {
      sessionHash: hashSessionToken(session),
      expiresAt: Date.now() + 10 * 60_000
    });
    const url = new URL("https://id.twitch.tv/oauth2/authorize");
    url.search = new URLSearchParams({
      response_type: "code",
      client_id: config.twitchClientId,
      redirect_uri: callbackUrl(),
      scope: "user:read:chat channel:manage:redemptions",
      state
    }).toString();
    response.redirect(url.toString());
  });
  router.get("/callback", requireAuth, ownerOnly, async (request, response) => {
    const state = typeof request.query.state === "string" ? request.query.state : "";
    const grant = oauthStates.get(state);
    oauthStates.delete(state);
    const session = readSessionToken(request.headers.cookie);
    if (
      !grant ||
      !session ||
      grant.sessionHash !== hashSessionToken(session) ||
      grant.expiresAt < Date.now() ||
      typeof request.query.code !== "string"
    ) {
      response.status(400).send("Invalid Twitch authorization state");
      return;
    }
    try {
      const tokenResponse = await fetch("https://id.twitch.tv/oauth2/token", {
        method: "POST",
        body: new URLSearchParams({
          client_id: config.twitchClientId,
          client_secret: config.twitchClientSecret,
          code: request.query.code,
          grant_type: "authorization_code",
          redirect_uri: callbackUrl()
        }),
        signal: AbortSignal.timeout(10_000)
      });
      if (!tokenResponse.ok) throw new Error("Twitch authorization failed");
      const tokens = (await tokenResponse.json()) as {
        access_token: string;
        refresh_token: string;
        expires_in: number;
      };
      const userResponse = await fetch("https://api.twitch.tv/helix/users", {
        headers: {
          "Client-ID": config.twitchClientId,
          Authorization: `Bearer ${tokens.access_token}`
        },
        signal: AbortSignal.timeout(10_000)
      });
      if (!userResponse.ok) throw new Error("Twitch account lookup failed");
      const users = (await userResponse.json()) as { data: Array<{ id: string; login: string }> };
      const user = users.data[0];
      if (!user) throw new Error("Twitch account not found");
      const streamer = await getDefaultStreamer();
      if (
        (streamer.twitchLogin && streamer.twitchLogin.toLowerCase() !== user.login.toLowerCase()) ||
        (streamer.twitchBroadcasterId && streamer.twitchBroadcasterId !== user.id)
      ) {
        response.status(400).send("This Twitch account does not match the configured streamer");
        return;
      }
      const previous = await loadTwitch().catch(() => null);
      await saveTwitch({
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresAt: Date.now() + tokens.expires_in * 1000,
        broadcasterId: user.id,
        broadcasterLogin: user.login,
        rewardId: previous?.broadcasterId === user.id ? previous.rewardId : null,
        rewardCost: previous?.broadcasterId === user.id ? previous.rewardCost : 1000
      });
      await prisma.streamer.update({
        where: { id: streamer.id },
        data: { twitchLogin: user.login, twitchBroadcasterId: user.id }
      });
      await writeAudit(
        streamer.id,
        (request as AuthenticatedRequest).user.id,
        "tts.twitch_connected"
      );
      restartTwitch(streamer.id);
      response.redirect("/obs-setup?tts=connected");
    } catch {
      response.status(502).send("Twitch connection failed. Return to OBS Setup and try again.");
    }
  });
  router.post("/reward", requireAuth, ownerOnly, async (request, response) => {
    const parsed = costSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: "Invalid reward cost" });
      return;
    }
    try {
      const settings = await loadTwitch();
      if (!settings) {
        response.status(409).json({ error: "Connect Twitch first" });
        return;
      }
      if (!config.ttsPython) {
        response.status(503).json({ error: "TTS is not configured" });
        return;
      }
      if (settings.rewardId) {
        response.status(409).json({ error: "Reward already exists" });
        return;
      }
      const result = (await twitchApi((await getDefaultStreamer()).id,
        `channel_points/custom_rewards?broadcaster_id=${encodeURIComponent(settings.broadcasterId)}`,
        "POST",
        {
          title: "TTS на стриме",
          prompt: "Введите текст для озвучки (до 200 символов)",
          cost: parsed.data.cost,
          is_user_input_required: true,
          should_redemptions_skip_request_queue: false,
          is_enabled: true,
          is_paused: false
        }
      )) as { data: Array<{ id: string }> };
      const rewardId = result.data[0]?.id;
      if (!rewardId) throw new Error("Twitch reward creation failed");
      await saveTwitch({ ...(await loadTwitch())!, rewardId, rewardCost: parsed.data.cost });
      await writeAudit(
        (await getDefaultStreamer()).id,
        (request as AuthenticatedRequest).user.id,
        "tts.reward_created",
        { cost: parsed.data.cost }
      );
      response.json({ rewardId, rewardCost: parsed.data.cost });
    } catch {
      response.status(502).json({ error: "Could not create Twitch reward" });
    }
  });
  router.patch("/reward", requireAuth, ownerOnly, async (request, response) => {
    const parsed = costSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: "Invalid reward cost" });
      return;
    }
    try {
      const settings = await loadTwitch();
      if (!settings?.rewardId) {
        response.status(409).json({ error: "Create reward first" });
        return;
      }
      await twitchApi((await getDefaultStreamer()).id,
        `channel_points/custom_rewards?broadcaster_id=${encodeURIComponent(settings.broadcasterId)}&id=${encodeURIComponent(settings.rewardId)}`,
        "PATCH",
        { cost: parsed.data.cost }
      );
      await saveTwitch({ ...(await loadTwitch())!, rewardCost: parsed.data.cost });
      await writeAudit(
        (await getDefaultStreamer()).id,
        (request as AuthenticatedRequest).user.id,
        "tts.reward_cost_changed",
        { cost: parsed.data.cost }
      );
      response.json({ rewardId: settings.rewardId, rewardCost: parsed.data.cost });
    } catch {
      response.status(502).json({ error: "Could not update Twitch reward" });
    }
  });
  return router;
}

export function sendTtsAudio(
  request: Request,
  response: Response,
  audio: { id: string; file: string } | null
): void {
  if (!audio || request.params.id !== audio.id) {
    response.sendStatus(404);
    return;
  }
  response.setHeader("Cache-Control", "private, no-store");
  // The active WAV lives under uploads/.tmp, which sendFile otherwise rejects.
  response.type("audio/wav").sendFile(audio.file, { dotfiles: "allow" });
}

export function startTts(server: Server): void {
  io = server;
  stopping = false;
  debugTts("diagnostics enabled");
  cleanupTimer = setInterval(() => {
    void cleanupStaleTtsFiles().catch(() => console.warn("TTS temporary cleanup failed"));
  }, 5 * 60_000);
  cleanupTimer.unref();
  void restoreTwitchConnections();
}

async function restoreTwitchConnections(): Promise<void> {
  const rows = await prisma.settings.findMany({ where: { key: { startsWith: "tts:twitch:" } } });
  for (const row of rows) {
    const channelId = row.key.slice("tts:twitch:".length);
    try {
      const settings = decrypt(row.value);
      const channel = await prisma.streamer.findUnique({ where: { id: channelId }, select: { twitchBroadcasterId: true } });
      if (channel?.twitchBroadcasterId === settings.broadcasterId && settings.enabled !== false && !settings.revoked) {
        restartTwitch(channelId);
      }
    } catch {
      // An invalid or obsolete setting cannot prevent other channels from starting.
    }
  }
}

export function stopTts(): void {
  stopping = true;
  if (cleanupTimer) clearInterval(cleanupTimer);
  cleanupTimer = null;
  for (const channelId of channels.keys()) void stopChannel(channelId);
  io = null;
}

async function stopChannel(channelId: string): Promise<void> {
  const state = channels.get(channelId);
  if (!state) return;
  state.generation++;
  if (generatingChannel === channelId) cancelGeneration?.();
  state.subscribed = false;
  state.queue.length = 0;
  state.seenEvents.clear();
  state.lastUsed.clear();
  if (state.reconnectTimer) clearTimeout(state.reconnectTimer);
  state.reconnectTimer = null;
  state.reconnectAttempts = 0;
  if (state.tokenCheckTimer) clearInterval(state.tokenCheckTimer);
  state.tokenCheckTimer = null;
  const pending = state.pendingSocket;
  const current = state.socket;
  state.pendingSocket = null;
  state.socket = null;
  pending?.close();
  current?.close();
  if (state.active) await finishJob(channelId, false);
}

async function revokeTwitch(channelId: string, error: string, expectedToken?: string): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const row = await prisma.settings.findUnique({ where: { key: settingKey(channelId) } });
    if (!row) return;
    const settings = decrypt(row.value);
    if (expectedToken && settings.accessToken !== expectedToken && settings.refreshToken !== expectedToken) return;
    if (settings.revoked) return;
    const written = await prisma.settings.updateMany({ where: { key: row.key, value: row.value },
      data: { value: encrypt({ ...settings, revoked: true, error }, row.value.startsWith("v2:")) } });
    if (written.count === 1) { await stopChannel(channelId); return; }
  }
}

function restartTwitch(channelId?: string): void {
  if (stopping || !io) return;
  if (!channelId) {
    void getDefaultStreamer().then((channel) => restartTwitch(channel.id));
    return;
  }
  const stopped = stopChannel(channelId);
  const generation = runtime(channelId).generation;
  void stopped.then(async () => {
    const settings = await loadTwitch(channelId).catch(() => null);
    if (settings && settings.enabled !== false && !settings.revoked && !stopping &&
        runtime(channelId).generation === generation) {
      const state = runtime(channelId);
      state.tokenCheckTimer = setInterval(() => {
        void accessToken(channelId).catch(() => {});
      }, 5 * 60_000);
      state.tokenCheckTimer.unref();
      connectSocket(channelId, "wss://eventsub.wss.twitch.tv/ws", false);
    }
  });
}

function connectSocket(channelId: string, url: string, transferred: boolean): void {
  const state = runtime(channelId);
  const ws = new WebSocket(url);
  if (transferred) state.pendingSocket = ws;
  else state.socket = ws;
  ws.addEventListener("message", (message) => {
    void handleTwitchMessage(channelId, ws, String(message.data), transferred);
  });
  ws.addEventListener("close", () => {
    if (state.pendingSocket === ws) {
      state.pendingSocket = null;
      if (!stopping) state.socket?.close();
      return;
    }
    if (state.socket !== ws || stopping) return;
    state.socket = null;
    state.subscribed = false;
    const delay = Math.min(60_000, 5000 * 2 ** Math.min(4, state.reconnectAttempts++)) + Math.floor(Math.random() * 1000);
    state.reconnectTimer = setTimeout(() => {
      void loadTwitch(channelId).then((settings) => {
        if (settings && settings.enabled !== false && !settings.revoked && !stopping)
          connectSocket(channelId, "wss://eventsub.wss.twitch.tv/ws", false);
      }).catch(() => {});
    }, delay);
    state.reconnectTimer.unref();
  });
  ws.addEventListener("error", () => { try { ws.close(); } catch { /* close follows error */ } });
}

async function handleTwitchMessage(channelId: string, ws: WebSocket, raw: string, transferred: boolean): Promise<void> {
  const state = runtime(channelId);
  if (state.socket !== ws && state.pendingSocket !== ws) return;
  try {
    const packet = JSON.parse(raw) as {
      metadata: { message_type: string; message_id: string; subscription_type?: string };
      payload: { session?: { id?: string; reconnect_url?: string }; event?: Record<string, unknown> };
    };
    if (packet.metadata.message_type === "session_welcome" && !transferred) {
      const settings = await loadTwitch(channelId);
      const sessionId = packet.payload.session?.id;
      const channel = await prisma.streamer.findUnique({ where: { id: channelId }, select: { twitchBroadcasterId: true } });
      if (!settings || settings.enabled === false || settings.revoked ||
          channel?.twitchBroadcasterId !== settings.broadcasterId || !sessionId) { ws.close(); return; }
      await Promise.all(["channel.chat.message", "channel.channel_points_custom_reward_redemption.add"].map((type) =>
        twitchApi(channelId, "eventsub/subscriptions", "POST", {
          type, version: "1", condition: type === "channel.chat.message"
            ? { broadcaster_user_id: settings.broadcasterId, user_id: settings.broadcasterId }
            : { broadcaster_user_id: settings.broadcasterId },
          transport: { method: "websocket", session_id: sessionId }
        })));
      if (state.socket === ws) { state.subscribed = true; state.reconnectAttempts = 0; }
      return;
    }
    if (packet.metadata.message_type === "session_welcome" && transferred) {
      const previous = state.socket;
      state.socket = ws;
      state.pendingSocket = null;
      state.subscribed = true;
      state.reconnectAttempts = 0;
      previous?.close();
      return;
    }
    if (packet.metadata.message_type === "session_reconnect" && packet.payload.session?.reconnect_url) {
      if (!state.pendingSocket) connectSocket(channelId, packet.payload.session.reconnect_url, true);
      return;
    }
    if (packet.metadata.message_type === "revocation") {
      const current = await loadTwitch(channelId);
      if (current) await revokeTwitch(channelId, "Twitch revoked a TTS subscription. Reconnect Twitch TTS.", current.accessToken);
      return;
    }
    if (packet.metadata.message_type !== "notification" || !packet.payload.event || !state.subscribed) return;
    const now = Date.now();
    for (const [id, time] of state.seenEvents) if (now - time > 10 * 60_000) state.seenEvents.delete(id);
    if (state.seenEvents.has(packet.metadata.message_id)) return;
    state.seenEvents.set(packet.metadata.message_id, now);
    const settings = await loadTwitch(channelId);
    if (!settings || settings.enabled === false || settings.revoked) return;
    const event = packet.payload.event;
    if (event.broadcaster_user_id !== settings.broadcasterId) return;
    if (packet.metadata.subscription_type === "channel.chat.message") {
      const text = moderatorTtsText(event as TwitchChatMessage, settings.broadcasterId);
      if (text && typeof event.chatter_user_id === "string")
        enqueue({ text, userId: event.chatter_user_id, streamerId: channelId });
    } else if (packet.metadata.subscription_type === "channel.channel_points_custom_reward_redemption.add") {
      if ((event.reward as { id?: unknown } | undefined)?.id !== settings.rewardId ||
          (event.status !== undefined && event.status !== "unfulfilled") ||
          typeof event.id !== "string" || typeof event.user_id !== "string") return;
      const text = redemptionTtsText(event, settings.broadcasterId, settings.rewardId);
      if (!text || !enqueue({ text, userId: event.user_id, streamerId: channelId, redemptionId: event.id }))
        void settleReward(channelId, event.id, "CANCELED");
    }
  } catch {
    debugTts("Twitch event handler failed");
    if (ws.readyState === WebSocket.OPEN) ws.close();
  }
}

function enqueue(job: TtsJob): boolean {
  const state = runtime(job.streamerId);
  const now = Date.now();
  for (const [id, time] of state.lastUsed) if (now - time > 10 * 60_000) state.lastUsed.delete(id);
  if (!io?.sockets.adapter.rooms.get(`streamer:${job.streamerId}:overlay`)?.size ||
      state.queue.length >= perChannelQueueLimit ||
      [...channels.values()].reduce((sum, item) => sum + item.queue.length, 0) >= globalQueueLimit ||
      now - (state.lastUsed.get(job.userId) ?? 0) < 30_000) return false;
  state.lastUsed.set(job.userId, now);
  state.queue.push(job);
  void processQueue();
  return true;
}

async function processQueue(): Promise<void> {
  if (generating || !io || stopping) return;
  const ids = [...channels.keys()];
  const previous = ids.indexOf(lastGeneratedChannel ?? "");
  const ordered = [...ids.slice(previous + 1), ...ids.slice(0, previous + 1)];
  const channelId = ordered.find((id) => {
    const state = runtime(id);
    return state.queue.length > 0 && !state.active;
  });
  if (!channelId) return;
  const state = runtime(channelId);
  const job = state.queue.shift()!;
  const version = state.generation;
  lastGeneratedChannel = channelId;
  generating = true;
  generatingChannel = channelId;
  const id = crypto.randomBytes(32).toString("base64url");
  const file = path.join(config.uploadDir, ".tmp", `tts-${id}.wav`);
  try {
    const target = io.sockets.adapter.rooms.get(`streamer:${channelId}:overlay`)?.values().next().value as string | undefined;
    if (!target) throw new Error("OBS disconnected");
    await synthesize(job.text, file);
    if (state.generation !== version || !io?.sockets.sockets.has(target)) throw new Error("TTS channel stopped or OBS disconnected");
    const timer = setTimeout(() => { void finishJob(channelId, false); }, 90_000);
    state.active = { id, file, socketId: target, job, timer };
    io.to(target).emit("tts:play", { id, url: `/api/tts/audio/${id}` });
  } catch {
    await fs.rm(file, { force: true }).catch(() => {});
    if (job.redemptionId) void settleReward(channelId, job.redemptionId, "CANCELED");
  } finally {
    generating = false;
    generatingChannel = null;
    cancelGeneration = null;
    void processQueue();
  }
}

function synthesize(text: string, output: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(config.ttsPython,
      [path.join(config.projectRoot, "scripts", "tts_worker.py"), output],
      { stdio: ["pipe", "ignore", "ignore"], windowsHide: true });
    cancelGeneration = () => child.kill();
    const timeout = setTimeout(() => child.kill(), 60_000);
    child.on("error", reject);
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (code === 0) resolve();
      else reject(new Error("TTS generation failed"));
    });
    child.stdin.end(JSON.stringify({ text }) + "\n");
  });
}

export function completeTts(socketId: string, id: unknown, success: boolean): void {
  for (const [channelId, state] of channels) {
    const active = state.active;
    if (active && active.id === id && active.socketId === socketId) {
      void finishJob(channelId, success);
      return;
    }
  }
}

export function overlayTtsDisconnected(socketId: string): void {
  for (const [channelId, state] of channels)
    if (state.active?.socketId === socketId) void finishJob(channelId, false);
}

async function finishJob(channelId: string, success: boolean): Promise<void> {
  const state = runtime(channelId);
  const current = state.active;
  if (!current) return;
  state.active = null;
  clearTimeout(current.timer);
  try {
    if (current.job.redemptionId)
      await settleReward(channelId, current.job.redemptionId, success ? "FULFILLED" : "CANCELED");
  } finally {
    await fs.rm(current.file, { force: true }).catch(() => {});
    void processQueue();
  }
}

async function settleReward(channelId: string, id: string, status: "FULFILLED" | "CANCELED"): Promise<void> {
  try {
    const settings = await loadTwitch(channelId);
    if (!settings?.rewardId || settings.revoked) return;
    await twitchApi(channelId,
      `channel_points/custom_rewards/redemptions?broadcaster_id=${encodeURIComponent(settings.broadcasterId)}&reward_id=${encodeURIComponent(settings.rewardId)}&id=${encodeURIComponent(id)}`,
      "PATCH", { status });
  } catch {
    // A Twitch outage leaves the redemption pending for manual handling.
  }
}
