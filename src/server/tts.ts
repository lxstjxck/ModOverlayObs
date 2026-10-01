import crypto from "node:crypto";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import type { Request, Response } from "express";
import express from "express";
import type { Server } from "socket.io";
import { z } from "zod";
import type { TtsSetupView } from "../shared/types";
import { hashSessionToken, readSessionToken, requireAuth, type AuthenticatedRequest } from "./auth";
import { config } from "./config";
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
};
type TtsJob = { text: string; userId: string; redemptionId?: string };
type ActiveJob = { id: string; file: string; socketId: string; job: TtsJob; timer: NodeJS.Timeout };

const oauthStates = new Map<string, { sessionHash: string; expiresAt: number }>();
const seenEvents = new Map<string, number>();
const lastUsed = new Map<string, number>();
const queue: TtsJob[] = [];
let active: ActiveJob | null = null;
let generating = false;
let socket: WebSocket | null = null;
let pendingSocket: WebSocket | null = null;
let subscribed = false;
let reconnectTimer: NodeJS.Timeout | null = null;
let io: Server | null = null;
let stopping = false;
let refreshPromise: Promise<{ token: string; settings: StoredTwitch }> | null = null;
let cleanupTimer: NodeJS.Timeout | null = null;
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

function encrypt(value: StoredTwitch): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(
    "aes-256-gcm",
    crypto.createHash("sha256").update(config.sessionSecret).digest(),
    iv
  );
  const data = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map((part) => part.toString("base64url")).join(".");
}

function decrypt(value: string): StoredTwitch {
  const [iv, tag, data] = value.split(".").map((part) => Buffer.from(part, "base64url"));
  if (!iv || !tag || !data) throw new Error("Invalid Twitch settings");
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    crypto.createHash("sha256").update(config.sessionSecret).digest(),
    iv
  );
  decipher.setAuthTag(tag);
  return JSON.parse(
    Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8")
  ) as StoredTwitch;
}

async function loadTwitch(): Promise<StoredTwitch | null> {
  const streamer = await getDefaultStreamer();
  const row = await prisma.settings.findUnique({ where: { key: settingKey(streamer.id) } });
  return row ? decrypt(row.value) : null;
}

async function saveTwitch(value: StoredTwitch): Promise<void> {
  const streamer = await getDefaultStreamer();
  const key = settingKey(streamer.id);
  await prisma.settings.upsert({
    where: { key },
    create: { key, value: encrypt(value) },
    update: { value: encrypt(value) }
  });
}

async function accessToken(): Promise<{ token: string; settings: StoredTwitch }> {
  const settings = await loadTwitch();
  if (!settings) throw new Error("Twitch is not connected");
  if (settings.expiresAt > Date.now() + 60_000) return { token: settings.accessToken, settings };
  if (refreshPromise) return refreshPromise;
  refreshPromise = refreshTwitchToken(settings).finally(() => {
    refreshPromise = null;
  });
  return refreshPromise;
}

async function refreshTwitchToken(
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
  if (!response.ok) throw new Error("Twitch token refresh failed");
  const body = (await response.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
  };
  const updated = {
    ...settings,
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
    expiresAt: Date.now() + body.expires_in * 1000
  };
  await saveTwitch(updated);
  return { token: updated.accessToken, settings: updated };
}

async function twitchApi(url: string, method = "GET", body?: object): Promise<unknown> {
  const { token } = await accessToken();
  const response = await fetch(`https://api.twitch.tv/helix/${url}`, {
    method,
    headers: {
      "Client-ID": config.twitchClientId,
      Authorization: `Bearer ${token}`,
      ...(body ? { "Content-Type": "application/json" } : {})
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(10_000)
  });
  if (!response.ok) throw new Error(`Twitch API failed (${response.status})`);
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

export function ttsRouter(): express.Router {
  const router = express.Router();
  router.get("/audio/:id", (request, response) => sendTtsAudio(request, response, active));
  router.get("/", requireAuth, ownerOnly, async (_request, response) => {
    const settings = await loadTwitch().catch(() => null);
    const view: TtsSetupView = {
      configured: Boolean(config.twitchClientId && config.twitchClientSecret && config.ttsPython),
      connected: Boolean(settings),
      broadcasterLogin: settings?.broadcasterLogin ?? null,
      rewardId: settings?.rewardId ?? null,
      rewardCost: settings?.rewardCost ?? 1000,
      ready: Boolean(settings && subscribed && socket?.readyState === WebSocket.OPEN)
    };
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
      restartTwitch();
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
      const result = (await twitchApi(
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
      await twitchApi(
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
  restartTwitch();
}

export function stopTts(): void {
  stopping = true;
  if (cleanupTimer) clearInterval(cleanupTimer);
  cleanupTimer = null;
  subscribed = false;
  pendingSocket?.close();
  pendingSocket = null;
  socket?.close();
  socket = null;
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = null;
}

function restartTwitch(): void {
  if (stopping || !io) return;
  subscribed = false;
  pendingSocket?.close();
  pendingSocket = null;
  const previous = socket;
  socket = null;
  previous?.close();
  if (reconnectTimer) clearTimeout(reconnectTimer);
  void loadTwitch()
    .then((settings) => {
      if (settings && !stopping) connectSocket("wss://eventsub.wss.twitch.tv/ws", false);
    })
    .catch(() => {
      subscribed = false;
    });
}

function connectSocket(url: string, transferred: boolean): void {
  const ws = new WebSocket(url);
  if (transferred) pendingSocket = ws;
  else socket = ws;
  ws.addEventListener("message", (message) => {
    void handleTwitchMessage(ws, String(message.data), transferred);
  });
  ws.addEventListener("close", () => {
    if (pendingSocket === ws) {
      pendingSocket = null;
      return;
    }
    if (socket !== ws || stopping) return;
    debugTts("Twitch socket closed; reconnecting");
    socket = null;
    subscribed = false;
    reconnectTimer = setTimeout(
      () => connectSocket("wss://eventsub.wss.twitch.tv/ws", false),
      5000
    );
    reconnectTimer.unref();
  });
  ws.addEventListener("error", () => {
    try {
      ws.close();
    } catch {
      /* close will follow the connection error */
    }
  });
}

async function handleTwitchMessage(
  ws: WebSocket,
  raw: string,
  transferred: boolean
): Promise<void> {
  if (socket !== ws && pendingSocket !== ws) return;
  try {
    const packet = JSON.parse(raw) as {
      metadata: { message_type: string; message_id: string; subscription_type?: string };
      payload: {
        session?: { id?: string; reconnect_url?: string };
        event?: Record<string, unknown>;
      };
    };
    if (packet.metadata.message_type === "session_welcome" && !transferred) {
      const settings = await loadTwitch();
      const sessionId = packet.payload.session?.id;
      if (!settings || !sessionId) {
        ws.close();
        return;
      }
      await Promise.all(
        ["channel.chat.message", "channel.channel_points_custom_reward_redemption.add"].map(
          (type) =>
            twitchApi("eventsub/subscriptions", "POST", {
              type,
              version: "1",
              condition:
                type === "channel.chat.message"
                  ? { broadcaster_user_id: settings.broadcasterId, user_id: settings.broadcasterId }
                  : { broadcaster_user_id: settings.broadcasterId },
              transport: { method: "websocket", session_id: sessionId }
            })
        )
      );
      subscribed = true;
      debugTts("Twitch chat and reward subscriptions active");
      return;
    }
    if (packet.metadata.message_type === "session_welcome" && transferred) {
      const previous = socket;
      socket = ws;
      pendingSocket = null;
      subscribed = true;
      previous?.close();
      return;
    }
    if (
      packet.metadata.message_type === "session_reconnect" &&
      packet.payload.session?.reconnect_url
    ) {
      if (!pendingSocket) connectSocket(packet.payload.session.reconnect_url, true);
      return;
    }
    if (packet.metadata.message_type === "revocation") {
      subscribed = false;
      ws.close();
      return;
    }
    if (packet.metadata.message_type !== "notification" || !packet.payload.event) return;
    const event = packet.payload.event;
    const chatCommand =
      packet.metadata.subscription_type === "channel.chat.message" &&
      typeof (event.message as { text?: unknown } | undefined)?.text === "string" &&
      /^!tts(?:\s|$)/i.test((event.message as { text: string }).text.trim());
    if (chatCommand) debugTts("chat command event received");
    const now = Date.now();
    for (const [id, time] of seenEvents) if (now - time > 10 * 60_000) seenEvents.delete(id);
    if (seenEvents.has(packet.metadata.message_id)) return;
    seenEvents.set(packet.metadata.message_id, now);
    const settings = await loadTwitch();
    if (!settings) {
      if (chatCommand) debugTts("chat command ignored: Twitch settings unavailable");
      return;
    }
    const streamer = await getDefaultStreamer();
    if (streamer.twitchBroadcasterId !== settings.broadcasterId) {
      if (chatCommand) debugTts("chat command ignored: broadcaster mismatch");
      return;
    }
    if (packet.metadata.subscription_type === "channel.chat.message") {
      const text = moderatorTtsText(event as TwitchChatMessage, settings.broadcasterId);
      if (text && typeof event.chatter_user_id === "string") {
        debugTts("chat command accepted");
        enqueue({ text, userId: event.chatter_user_id });
      } else if (chatCommand) {
        debugTts("chat command ignored: role or command format");
      }
    } else if (
      packet.metadata.subscription_type === "channel.channel_points_custom_reward_redemption.add"
    ) {
      if (
        event.broadcaster_user_id !== settings.broadcasterId ||
        (event.reward as { id?: unknown } | undefined)?.id !== settings.rewardId ||
          (event.status !== undefined && event.status !== "unfulfilled") ||
        typeof event.id !== "string" ||
        typeof event.user_id !== "string"
      )
        return;
      const text = redemptionTtsText(event, settings.broadcasterId, settings.rewardId);
      if (!text || !enqueue({ text, userId: event.user_id, redemptionId: event.id }))
        void settleReward(event.id, "CANCELED");
    }
  } catch {
    debugTts("Twitch event handler failed");
    if (ws.readyState === WebSocket.OPEN) ws.close();
    // No credentials or message text are logged.
  }
}

function enqueue(job: TtsJob): boolean {
  const now = Date.now();
  for (const [id, time] of lastUsed) if (now - time > 10 * 60_000) lastUsed.delete(id);
  const streamerId = io
    ? Array.from(io.sockets.adapter.rooms.keys()).find(
        (room) => room.startsWith("streamer:") && room.endsWith(":overlay")
      )
    : null;
  if (!streamerId || !io?.sockets.adapter.rooms.get(streamerId)?.size) {
    debugTts("job rejected: no connected overlay");
    return false;
  }
  if (queue.length >= 10) {
    debugTts("job rejected: queue full");
    return false;
  }
  if (now - (lastUsed.get(job.userId) ?? 0) < 30_000) {
    debugTts("job rejected: cooldown");
    return false;
  }
  lastUsed.set(job.userId, now);
  queue.push(job);
  debugTts("job queued");
  void processQueue();
  return true;
}

async function processQueue(): Promise<void> {
  if (active || generating || !io || queue.length === 0) return;
  generating = true;
  const job = queue.shift()!;
  const id = crypto.randomBytes(32).toString("base64url");
  const file = path.join(config.uploadDir, ".tmp", `tts-${id}.wav`);
  let phase = "preparing";
  try {
    const streamer = await getDefaultStreamer();
    const target = io.sockets.adapter.rooms.get(`streamer:${streamer.id}:overlay`)?.values().next()
      .value as string | undefined;
    if (!target) throw new Error("OBS disconnected");
    phase = "generating";
    debugTts("generating WAV");
    await synthesize(job.text, file);
    phase = "dispatching";
    if (!io.sockets.sockets.has(target)) throw new Error("OBS disconnected");
    const timer = setTimeout(() => {
      void finishJob(false);
    }, 90_000);
    active = { id, file, socketId: target, job, timer };
    debugTts("WAV sent to overlay");
    io.to(target).emit("tts:play", { id, url: `/api/tts/audio/${id}` });
  } catch {
    debugTts(`job failed during ${phase}`);
    await fs.rm(file, { force: true }).catch(() => {});
    if (job.redemptionId) void settleReward(job.redemptionId, "CANCELED");
  } finally {
    generating = false;
    if (!active) void processQueue();
  }
}

function synthesize(text: string, output: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      config.ttsPython,
      [path.join(config.projectRoot, "scripts", "tts_worker.py"), output],
      { stdio: ["pipe", "ignore", "ignore"], windowsHide: true }
    );
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
  if (active && active.id === id && active.socketId === socketId) {
    debugTts(success ? "overlay reported playback complete" : "overlay reported playback error");
    void finishJob(success);
  }
}

export function overlayTtsDisconnected(socketId: string): void {
  if (active?.socketId === socketId) void finishJob(false);
}

async function finishJob(success: boolean): Promise<void> {
  const current = active;
  if (!current) return;
  active = null;
  clearTimeout(current.timer);
  try {
    if (current.job.redemptionId)
      await settleReward(current.job.redemptionId, success ? "FULFILLED" : "CANCELED");
  } finally {
    await fs.rm(current.file, { force: true }).catch(() => {});
    void processQueue();
  }
}

async function settleReward(id: string, status: "FULFILLED" | "CANCELED"): Promise<void> {
  try {
    const settings = await loadTwitch();
    if (!settings?.rewardId) return;
    await twitchApi(
      `channel_points/custom_rewards/redemptions?broadcaster_id=${encodeURIComponent(settings.broadcasterId)}&reward_id=${encodeURIComponent(settings.rewardId)}&id=${encodeURIComponent(id)}`,
      "PATCH",
      { status }
    );
  } catch {
    // A Twitch outage leaves the redemption pending for manual handling.
  }
}
