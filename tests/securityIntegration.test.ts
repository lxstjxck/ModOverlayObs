import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { io as connect, type Socket } from "socket.io-client";
import type { Server } from "socket.io";
import bcrypt from "bcryptjs";

const fixture = await vi.hoisted(async () => {
  const fs = await import("node:fs/promises");
  const os = await import("node:os");
  const path = await import("node:path");
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "modoverlay-security-"));
  if (!path.isAbsolute(root) || !path.basename(root).startsWith("modoverlay-security-")) {
    throw new Error("Unsafe integration test directory");
  }
  return { root, databaseUrl: `file:${path.join(root, "test.db").replaceAll("\\", "/")}` };
});

vi.mock("../src/server/db", async () => {
  if (
    !fixture.databaseUrl ||
    !fixture.databaseUrl.startsWith(`file:${fixture.root.replaceAll("\\", "/")}/`)
  ) {
    throw new Error("Refusing to initialize tests without an isolated database");
  }
  const { PrismaClient } = await import("@prisma/client");
  return { prisma: new PrismaClient({ datasourceUrl: fixture.databaseUrl }) };
});
vi.mock("../src/server/config", () => ({
  isProduction: false,
  config: {
    projectRoot: fixture.root,
    nodeEnv: "test",
    port: 0,
    domain: "",
    publicOrigin: "",
    sessionSecret: "isolated-security-test-secret-at-least-32-characters",
    uploadDir: `${fixture.root}/uploads`,
    maxImageSize: 1024,
    maxGifSize: 1024,
    maxVideoSize: 1024,
    maxAudioSize: 1024,
    maxTotalUploadSize: 10240,
    originAllowlist: [],
    initialAdminUsername: "owner",
    initialAdminPassword: "",
    twitchClientId: "oauth-test-client",
    twitchClientSecret: "oauth-test-secret",
    twitchOAuthRedirectUri: "",
    oauthTokenEncryptionKey: "1".repeat(64),
    ttsEnabled: false
  }
}));

import { prisma } from "../src/server/db";
import { config } from "../src/server/config";
import {
  hashSessionToken,
  createCsrfTokenFromSessionToken,
  sessionCookieName
} from "../src/server/auth";
import { createAppRouter, configureUploads } from "../src/server/routes";
import { configureSocket } from "../src/server/socket";
import { requireCsrf, requireTrustedOrigin } from "../src/server/security";
import { accessRevocation } from "../src/server/accessRevocation";
import { getChannelEmotes } from "../src/server/emotes";
import { ensureRuntimeState } from "../src/server/bootstrap";
import { canAccessChannel, encryptOAuthToken, getModeratedChannels, setModeratorBan, syncModerators, verifyStreamerIdentity } from "../src/server/channelAccess";
import { startTts, stopTts } from "../src/server/tts";
import type { OverlayReloadStatus } from "../src/shared/types";

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aMZkAAAAASUVORK5CYII=",
  "base64"
);
let baseUrl: string;
let realtime: Server;
let streamerId: string;
let ownerId: string;
let moderatorId: string;
const clients: Socket[] = [];

function headers(token = "owner-session") {
  return {
    Cookie: `${sessionCookieName}=${token}`,
    "x-csrf-token": createCsrfTokenFromSessionToken(token)
  };
}

async function addSession(
  userId: string,
  token: string,
  expiresAt = new Date(Date.now() + 60_000)
) {
  await prisma.session.create({ data: { userId, tokenHash: hashSessionToken(token), expiresAt } });
}

function event<T = unknown>(socket: Socket, name: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(name, listener);
      reject(new Error(`Timeout waiting for ${name}`));
    }, 4000);
    const listener = (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    };
    socket.once(name, listener);
  });
}

async function socketClient(
  options: { session?: string; overlayToken?: string; channelId?: string },
  expected = "live:state"
) {
  const socket = connect(baseUrl, {
    transports: ["websocket"],
    reconnection: false,
    autoConnect: false,
    extraHeaders: options.session ? { Cookie: headers(options.session).Cookie } : undefined,
    query: options.overlayToken ? { overlayToken: options.overlayToken } : options.channelId ? { channelId: options.channelId } : undefined
  });
  clients.push(socket);
  const ready = event(socket, expected);
  socket.connect();
  await ready;
  return socket;
}

function upload(token = "owner-session", bytes = png, filename = "test.png") {
  const data = new FormData();
  data.append("file", new Blob([new Uint8Array(bytes)], { type: "image/png" }), filename);
  return fetch(`${baseUrl}/api/media`, { method: "POST", headers: headers(token), body: data });
}

it("uses validated intrinsic dimensions for a new preview without changing live state", async () => {
  const uploaded = await upload();
  expect(uploaded.status).toBe(201);
  const { media } = (await uploaded.json()) as { media: { id: string } };
  const socket = await socketClient({ session: "owner-session" });
  const state = event<Array<{ mediaId: string; width: number; height: number; x: number }>>(
    socket,
    "preview:state"
  );
  socket.emit("preview:add", { mediaId: media.id, width: 640, height: 480 });
  expect((await state)[0]).toMatchObject({
    mediaId: media.id,
    width: 640,
    height: 480,
    x: -696
  });
  expect(await prisma.liveInstance.count({ where: { streamerId } })).toBe(0);
});

it("adds a large video at the fitted preview size without changing its source metadata", async () => {
  const media = await prisma.media.create({
    data: {
      streamerId,
      filename: "clip.mp4",
      originalName: "clip.mp4",
      mimeType: "video/mp4",
      type: "VIDEO",
      size: 1024,
      url: "https://cdn.example.com/clip.mp4",
      width: 3840,
      height: 2160
    }
  });
  const socket = await socketClient({ session: "owner-session" });
  const state = event<Array<{ mediaId: string; type: string; x: number; width: number; height: number }>>(
    socket, "preview:state"
  );
  socket.emit("preview:add", { mediaId: media.id, width: 512, height: 288 });
  expect((await state)[0]).toMatchObject({ mediaId: media.id, type: "VIDEO", x: -568, width: 512, height: 288 });
  expect(await prisma.media.findUniqueOrThrow({ where: { id: media.id } })).toMatchObject({ width: 3840, height: 2160 });
  expect(await prisma.liveInstance.count({ where: { streamerId } })).toBe(0);
});

async function files() {
  const entries = await fs.readdir(config.uploadDir);
  const temporary = await fs.readdir(path.join(config.uploadDir, ".tmp"));
  return [...entries.filter((name) => name !== ".tmp"), ...temporary.map((name) => `.tmp/${name}`)];
}

beforeAll(async () => {
  if (!fixture.root || !fixture.databaseUrl) throw new Error("Missing isolated test fixture");
  await fs.writeFile(path.join(fixture.root, "test.db"), "", { flag: "wx" });
  // CLI is pointed exclusively at a new temporary database, never the user's .env DB.
  await promisify(execFile)(
    process.execPath,
    [
      path.resolve("node_modules/prisma/build/index.js"),
      "db",
      "push",
      "--skip-generate",
      "--schema",
      path.resolve("prisma/schema.prisma")
    ],
    { env: { ...process.env, DATABASE_URL: fixture.databaseUrl }, timeout: 25000 }
  );
  const databases = await prisma.$queryRawUnsafe<Array<{ file: string }>>("PRAGMA database_list");
  if (
    databases.length !== 1 ||
    path.resolve(databases[0].file) !== path.join(fixture.root, "test.db")
  ) {
    throw new Error("Refusing to run: Prisma is not connected to the isolated test database");
  }
  await fs.mkdir(path.join(config.uploadDir, ".tmp"), { recursive: true });
  const app = express();
  app.set("trust proxy", false);
  app.use(express.json());
  configureUploads(app);
  app.use("/api", requireTrustedOrigin, requireCsrf, createAppRouter());
  // Return deterministic responses for Multer limits/errors in these tests.
  app.use(
    (
      _error: unknown,
      _request: express.Request,
      response: express.Response,
      _next: express.NextFunction
    ) => {
      response.status(400).json({ error: "Request failed" });
    }
  );
  const server = http.createServer(app);
  realtime = configureSocket(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as import("node:net").AddressInfo).port}`;
}, 30000);

beforeEach(async () => {
  const databases = await prisma.$queryRawUnsafe<Array<{ file: string }>>("PRAGMA database_list");
  if (
    databases.length !== 1 ||
    path.resolve(databases[0].file) !== path.join(fixture.root, "test.db")
  ) {
    throw new Error("Refusing to reset a database outside the test fixture");
  }
  await prisma.streamer.deleteMany();
  await prisma.settings.deleteMany({ where: { key: { startsWith: "tts:" } } });
  await prisma.user.deleteMany();
  for (const name of await files()) await fs.unlink(path.join(config.uploadDir, name));
  config.maxTotalUploadSize = 10240;
  config.ttsEnabled = false;
  config.twitchOAuthRedirectUri = "";
  const streamer = await prisma.streamer.create({
    data: { displayName: "Test", overlayToken: "overlay-old" }
  });
  streamerId = streamer.id;
  const owner = await prisma.user.create({
    data: { username: "owner", displayName: "Owner", passwordHash: "unused", role: "OWNER" }
  });
  const moderator = await prisma.user.create({
    data: {
      username: "mod",
      displayName: "Mod",
      passwordHash: "unused",
      role: "MODERATOR",
      permissionsJson: JSON.stringify({ canEditPreview: true, canPushLive: false })
    }
  });
  ownerId = owner.id;
  moderatorId = moderator.id;
  await addSession(ownerId, "owner-session");
  await addSession(moderatorId, "mod-session");
});

afterEach(async () => {
  vi.restoreAllMocks();
  for (const socket of clients.splice(0)) socket.disconnect();
  realtime.disconnectSockets(true);
  await expect.poll(() => accessRevocation.listenerCount("session")).toBe(0);
});

afterAll(async () => {
  if (realtime) await new Promise<void>((resolve) => realtime.close(() => resolve()));
  await prisma.$disconnect();
  // root is the unique directory created by mkdtemp above.
  await fs.rm(fixture.root, { recursive: true, force: true });
});

it("reloads only the owner's channel and waits for each OBS reconnect and state sync", async () => {
  const realFetch = globalThis.fetch;
  vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
    if (String(input) === "https://id.twitch.tv/oauth2/validate") {
      const token = new Headers(init?.headers).get("Authorization")?.replace("OAuth ", "") ?? "";
      return Promise.resolve(new Response(JSON.stringify({ client_id: config.twitchClientId, user_id: token,
        scopes: ["moderation:read", "user:read:moderated_channels"] })));
    }
    return realFetch(input, init);
  });
  const owners = [];
  for (const [name, token] of [["alpha", "alpha-session"], ["beta", "beta-session"]] as const) {
    const user = await prisma.user.create({ data: {
      username: `twitch:${name}`, displayName: name, passwordHash: "!", twitchUserId: name
    } });
    await prisma.twitchOAuthConnection.create({ data: {
      userId: user.id, mode: "unified", encryptedAccess: encryptOAuthToken(name),
      encryptedRefresh: encryptOAuthToken("refresh"), scopesJson: "[]",
      expiresAt: new Date(Date.now() + 3600_000), checkedAt: new Date()
    } });
    await prisma.session.create({ data: {
      userId: user.id, tokenHash: hashSessionToken(token), authMethod: "TWITCH",
      twitchMode: "unified", expiresAt: new Date(Date.now() + 3600_000)
    } });
    const channel = await prisma.streamer.create({ data: {
      displayName: name, overlayToken: `${name}-overlay`, ownerUserId: user.id, twitchBroadcasterId: name
    } });
    owners.push({ channel, token });
  }
  const [alpha, beta] = owners;
  const route = (id: string) => `${baseUrl}/api/auth/twitch/channels/${id}/overlay-reload`;
  const post = (id: string, token: string) => fetch(route(id), { method: "POST", headers: headers(token) });
  expect((await post(alpha.channel.id, alpha.token)).status).toBe(503);
  expect((await post(alpha.channel.id, beta.token)).status).toBe(403);
  const mod = await prisma.user.create({ data: {
    username: "twitch:channel-mod", displayName: "Channel mod", passwordHash: "!", twitchUserId: "channel-mod"
  } });
  await prisma.session.create({ data: {
    userId: mod.id, tokenHash: hashSessionToken("channel-mod-session"),
    authMethod: "TWITCH", twitchMode: "unified", expiresAt: new Date(Date.now() + 3600_000)
  } });
  expect((await post(alpha.channel.id, "channel-mod-session")).status).toBe(401);

  const first = await socketClient({ overlayToken: alpha.channel.overlayToken }, "overlay:state");
  const second = await socketClient({ overlayToken: alpha.channel.overlayToken }, "overlay:state");
  const foreign = await socketClient({ overlayToken: beta.channel.overlayToken }, "overlay:state");
  const command = (socket: Socket) => new Promise<{ attemptId: string }>((resolve) => {
    socket.once("overlay:reload", (payload: { attemptId: string }, acknowledge: () => void) => {
      acknowledge();
      resolve(payload);
    });
  });
  const firstCommand = command(first);
  const secondCommand = command(second);
  const foreignCommand = vi.fn();
  foreign.on("overlay:reload", foreignCommand);
  const started = await post(alpha.channel.id, alpha.token);
  expect(started.status).toBe(200);
  const operation = await started.json() as OverlayReloadStatus;
  expect(operation).toMatchObject({ state: "waiting", total: 2, received: 0, reconnected: 0 });
  const [one, two] = await Promise.all([firstCommand, secondCommand]);
  expect(one.attemptId).not.toBe(two.attemptId);
  expect(foreignCommand).not.toHaveBeenCalled();
  expect((await post(alpha.channel.id, alpha.token)).status).toBe(409);
  const statusUrl = `${route(alpha.channel.id)}/${operation.id}`;
  await expect.poll(async () => (await (await fetch(statusUrl, { headers: headers(alpha.token) })).json() as OverlayReloadStatus).received).toBe(2);
  first.emit("overlay:reload:ready", { attemptId: one.attemptId });
  first.disconnect();
  second.disconnect();
  const replacementOne = await socketClient({ overlayToken: alpha.channel.overlayToken }, "overlay:state");
  replacementOne.emit("overlay:reload:ready", { attemptId: one.attemptId });
  const replacementTwo = await socketClient({ overlayToken: alpha.channel.overlayToken }, "overlay:state");
  replacementTwo.emit("overlay:reload:ready", { attemptId: two.attemptId });
  await expect.poll(async () => (await (await fetch(statusUrl, { headers: headers(alpha.token) })).json() as OverlayReloadStatus).reconnected).toBe(2);
  expect(await (await fetch(statusUrl, { headers: headers(alpha.token) })).json()).toMatchObject({ state: "completed", received: 2 });
  expect((await fetch(statusUrl, { headers: headers(beta.token) })).status).toBe(403);
  expect((await fetch(`${route(beta.channel.id)}/${operation.id}`, { headers: headers(beta.token) })).status).toBe(404);
});

it("requires a non-template password before creating the first owner", async () => {
  await prisma.user.deleteMany();
  for (const password of ["", "change-me-now", "change-me-now ", "too-short", "            "]) {
    config.initialAdminPassword = password;
    await expect(ensureRuntimeState()).rejects.toThrow("INITIAL_ADMIN_PASSWORD");
    expect(await prisma.user.count()).toBe(0);
  }

  config.initialAdminPassword = "unique-test-password-123";
  await ensureRuntimeState();
  const owner = await prisma.user.findUnique({ where: { username: "owner" } });
  expect(owner?.role).toBe("OWNER");
  expect(await bcrypt.compare(config.initialAdminPassword, owner?.passwordHash ?? "")).toBe(true);
  config.initialAdminPassword = "";
  await expect(ensureRuntimeState()).resolves.toBeUndefined();
  expect(await prisma.user.count()).toBe(1);
});

it("starts a Twitch-only installation without creating a legacy owner", async () => {
  await prisma.user.deleteMany();
  await prisma.streamer.deleteMany();
  config.initialAdminPassword = "";
  config.twitchOAuthRedirectUri = `${baseUrl}/api/auth/twitch/callback`;
  await ensureRuntimeState();
  expect(await prisma.user.count()).toBe(0);
  expect(await prisma.streamer.count()).toBe(0);
});

it("uses one Twitch session as owner and moderator on different channels", async () => {
  const owner = await prisma.user.create({ data: { username: "twitch:111", displayName: "Combined", passwordHash: "!", twitchUserId: "111" } });
  const other = await prisma.user.create({ data: { username: "twitch:222", displayName: "Other", passwordHash: "!", twitchUserId: "222" } });
  const own = await prisma.streamer.create({ data: { displayName: "Own", overlayToken: "combined-own", ownerUserId: owner.id, twitchBroadcasterId: "111" } });
  const moderated = await prisma.streamer.create({ data: { displayName: "Moderated", overlayToken: "combined-other", ownerUserId: other.id, twitchBroadcasterId: "222" } });
  for (const [userId, token] of [[owner.id, "combined-access"], [other.id, "other-access"]] as const) {
    await prisma.twitchOAuthConnection.create({ data: { userId, mode: "unified", encryptedAccess: encryptOAuthToken(token),
      encryptedRefresh: encryptOAuthToken(`refresh-${token}`), scopesJson: JSON.stringify(["moderation:read", "user:read:moderated_channels"]),
      expiresAt: new Date(Date.now() + 3600_000), checkedAt: new Date() } });
  }
  await prisma.session.create({ data: { userId: owner.id, tokenHash: hashSessionToken("combined-session"),
    authMethod: "TWITCH", twitchMode: "unified", expiresAt: new Date(Date.now() + 3600_000) } });
  const realFetch = globalThis.fetch;
  let refreshRevoked = false;
  let profilesUnavailable = true;
  const profileRequests: string[][] = [];
  const profileWarning = vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
    const url = String(input);
    if (!url.startsWith("https://")) return realFetch(input, init);
    if (url.endsWith("/token")) return Promise.resolve(refreshRevoked
      ? new Response("revoked", { status: 400 })
      : new Response(JSON.stringify({ access_token: "combined-refreshed", refresh_token: "combined-new-refresh",
        expires_in: 3600, scope: ["moderation:read", "user:read:moderated_channels"] })));
    const token = new Headers(init?.headers).get("Authorization") ?? "";
    if (url.endsWith("/validate")) return Promise.resolve(new Response(JSON.stringify({
      client_id: config.twitchClientId, user_id: token.includes("combined-") ? "111" : "222",
      scopes: ["moderation:read", "user:read:moderated_channels"]
    })));
    if (url.includes("moderation/channels")) return Promise.resolve(new Response(JSON.stringify({ data: [{ broadcaster_id: "222" }], pagination: {} })));
    if (url.includes("moderation/moderators")) return Promise.resolve(new Response(JSON.stringify({ data: [{ user_id: "111" }], pagination: {} })));
    if (url.includes("/users?")) {
      profileRequests.push(new URL(url).searchParams.getAll("id"));
      return Promise.resolve(profilesUnavailable
        ? new Response(null, { status: 503 })
        : new Response(JSON.stringify({ data: ["111", "222"].map((id) => ({ id, login: id,
          display_name: id, profile_image_url: id === "111" ? "https://cdn.example/111.png" : "" })) })));
    }
    throw new Error(`Unexpected Twitch request: ${url}`);
  });
  const cookie = headers("combined-session");
  const listed = await fetch(`${baseUrl}/api/auth/twitch/channels`, { headers: cookie });
  expect(listed.status).toBe(200);
  expect((await listed.json() as { channels: Array<{ id: string; role: string; avatarUrl: string | null }> }).channels).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: own.id, role: "owner", avatarUrl: null }),
    expect.objectContaining({ id: moderated.id, role: "moderator", avatarUrl: null })
  ]));
  expect(profileWarning).toHaveBeenCalledWith("Twitch profile lookup failed; channel names and avatars will use fallbacks", "Twitch profiles unavailable");
  expect(profileRequests).toEqual([expect.arrayContaining(["111", "222"])]);
  expect((await fetch(`${baseUrl}/api/auth/me`, { headers: { ...cookie, "X-Channel-Id": "foreign" } })).status).toBe(403);
  profilesUnavailable = false;
  const refreshed = await fetch(`${baseUrl}/api/auth/twitch/channels`, { headers: cookie });
  expect(refreshed.status).toBe(200);
  expect((await refreshed.json() as { channels: Array<{ id: string; avatarUrl: string | null }> }).channels).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: own.id, avatarUrl: "https://cdn.example/111.png" }),
    expect.objectContaining({ id: moderated.id, avatarUrl: null })
  ]));
  expect(profileRequests).toHaveLength(2);
  const ownEditor = await fetch(`${baseUrl}/api/auth/me`, { headers: { ...cookie, "X-Channel-Id": own.id } });
  const otherEditor = await fetch(`${baseUrl}/api/auth/me`, { headers: { ...cookie, "X-Channel-Id": moderated.id } });
  expect((await ownEditor.json() as { user: { role: string } }).user.role).toBe("OWNER");
  expect((await otherEditor.json() as { user: { role: string } }).user.role).toBe("MODERATOR");
  expect((await fetch(`${baseUrl}/api/obs`, { headers: { ...cookie, "X-Channel-Id": own.id } })).status).toBe(200);
  expect((await fetch(`${baseUrl}/api/obs`, { headers: { ...cookie, "X-Channel-Id": moderated.id } })).status).toBe(403);
  expect((await fetch(`${baseUrl}/api/auth/me`, { headers: { ...cookie, "X-Channel-Id": "foreign" } })).status).toBe(403);
  await prisma.twitchOAuthConnection.update({ where: { userId_mode: { userId: owner.id, mode: "unified" } }, data: { expiresAt: new Date(Date.now() - 1000) } });
  expect(await verifyStreamerIdentity(owner.id, "111")).toBe(true);
  expect((await prisma.twitchOAuthConnection.findUniqueOrThrow({ where: { userId_mode: { userId: owner.id, mode: "unified" } } })).expiresAt.getTime()).toBeGreaterThan(Date.now());
  refreshRevoked = true;
  await prisma.twitchOAuthConnection.update({ where: { userId_mode: { userId: owner.id, mode: "unified" } }, data: { expiresAt: new Date(Date.now() - 1000) } });
  await expect(verifyStreamerIdentity(owner.id, "111")).rejects.toThrow("Twitch refresh failed");
  expect((await fetch(`${baseUrl}/api/obs`, { headers: { ...cookie, "X-Channel-Id": own.id } })).status).toBe(403);
});

it(
  "completes unified Twitch login with one-use state and both scopes",
  async () => {
    const mode = "unified";
    config.twitchOAuthRedirectUri = `${baseUrl}/api/auth/twitch/callback`;
    const realFetch = globalThis.fetch;
    const twitchCalls: Array<{ url: string; init?: RequestInit }> = [];
    vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
      const url = String(input);
      if (!url.startsWith("https://id.twitch.tv/") && !url.startsWith("https://api.twitch.tv/"))
        return realFetch(input, init);
      twitchCalls.push({ url, init });
      const body = url.endsWith("/token")
        ? {
            access_token: "access-secret",
            refresh_token: "refresh-secret",
            expires_in: 3600,
            scope: ["moderation:read", "user:read:moderated_channels"]
          }
        : url.endsWith("/validate")
          ? {
              client_id: "oauth-test-client",
              user_id: "12345",
              scopes: ["moderation:read", "user:read:moderated_channels"]
            }
          : {
              data: [
                {
                  id: "12345",
                  login: "testperson",
                  display_name: "Test Person",
                  profile_image_url: "https://example.com/avatar.png"
                }
              ]
            };
      return Promise.resolve(
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        })
      );
    });
    const start = await fetch(`${baseUrl}/api/auth/twitch/start/${mode}`, { redirect: "manual" });
    expect(start.status).toBe(302);
    const authorize = new URL(start.headers.get("location")!);
    expect(authorize.origin).toBe("https://id.twitch.tv");
    expect(authorize.searchParams.get("redirect_uri")).toBe(config.twitchOAuthRedirectUri);
    expect(authorize.searchParams.get("scope")).toBe(
      "moderation:read user:read:moderated_channels"
    );
    const stateCookie = start.headers
      .getSetCookie()
      .find((cookie) => cookie.startsWith("mod_overlay_twitch_state="))!
      .split(";")[0];
    const callback = `${baseUrl}/api/auth/twitch/callback?state=${authorize.searchParams.get("state")}&code=sample-code`;
    const invalid = await fetch(callback, {
      headers: { Cookie: "mod_overlay_twitch_state=wrong" },
      redirect: "manual"
    });
    expect(invalid.headers.get("location")).toBe("/login?oauth_error=invalid_state");
    const result = await fetch(callback, { headers: { Cookie: stateCookie }, redirect: "manual" });
    expect(result.status).toBe(303);
    expect(result.headers.get("location")).toBe("/channels");
    expect(result.headers.get("location")).not.toContain("code");
    const sessionCookie = result.headers
      .getSetCookie()
      .find((cookie) => cookie.startsWith(`${sessionCookieName}=`))!
      .split(";")[0];
    const me = await fetch(`${baseUrl}/api/auth/twitch/me`, { headers: { Cookie: sessionCookie } });
    expect(me.status).toBe(200);
    const identity = (await me.json()) as { user: { id: string }; csrfToken: string };
    expect(identity.user.id).toBe("12345");
    expect(
      (await fetch(`${baseUrl}/api/auth/me`, { headers: { Cookie: sessionCookie } })).status
    ).toBe(403);
    expect(
      (await fetch(`${baseUrl}/api/media`, { headers: { Cookie: sessionCookie } })).status
    ).toBe(403);
    const deniedSocket = connect(baseUrl, {
      transports: ["websocket"],
      reconnection: false,
      autoConnect: false,
      extraHeaders: { Cookie: sessionCookie }
    });
    clients.push(deniedSocket);
    const socketError = event<Error>(deniedSocket, "connect_error");
    deniedSocket.connect();
    expect((await socketError).message).toBe("Channel access denied");
    expect(
      (await fetch(callback, { headers: { Cookie: stateCookie }, redirect: "manual" })).headers.get(
        "location"
      )
    ).toBe("/login?oauth_error=invalid_state");
    expect(twitchCalls.filter((call) => call.url.endsWith("/token"))).toHaveLength(1);
    expect(new URLSearchParams(String(twitchCalls[0].init?.body)).get("redirect_uri")).toBe(
      config.twitchOAuthRedirectUri
    );
    const account = await prisma.user.findUnique({
      where: { twitchUserId: "12345" },
      include: { twitchConnections: true }
    });
    expect(account?.role).toBe("MODERATOR");
    expect(account?.twitchConnections[0].encryptedAccess).not.toContain("access-secret");
    const logout = await fetch(`${baseUrl}/api/auth/logout`, {
      method: "POST",
      headers: { Cookie: sessionCookie, "x-csrf-token": identity.csrfToken }
    });
    expect(logout.status).toBe(200);
    expect(
      (await fetch(`${baseUrl}/api/auth/twitch/me`, { headers: { Cookie: sessionCookie } })).status
    ).toBe(401);
    const nextStart = await fetch(`${baseUrl}/api/auth/twitch/start/${mode}`, {
      redirect: "manual"
    });
    const nextState = new URL(nextStart.headers.get("location")!).searchParams.get("state");
    const nextBinding = nextStart.headers
      .getSetCookie()
      .find((cookie) => cookie.startsWith("mod_overlay_twitch_state="))!
      .split(";")[0];
    const secondLogin = await fetch(
      `${baseUrl}/api/auth/twitch/callback?state=${nextState}&code=second-code`,
      { headers: { Cookie: nextBinding }, redirect: "manual" }
    );
    expect(secondLogin.status).toBe(303);
    expect(await prisma.user.count({ where: { twitchUserId: "12345" } })).toBe(1);
    expect((await prisma.user.findUnique({ where: { twitchUserId: "12345" } }))?.id).toBe(
      account?.id
    );
    const popupStart = await fetch(`${baseUrl}/api/auth/twitch/start/unified?popup=1`, { redirect: "manual" });
    const popupState = new URL(popupStart.headers.get("location")!).searchParams.get("state");
    const popupBinding = popupStart.headers.getSetCookie().find((value) => value.startsWith("mod_overlay_twitch_state="))!.split(";")[0];
    const popupResult = await fetch(`${baseUrl}/api/auth/twitch/callback?state=${popupState}&code=popup-code`, {
      headers: { Cookie: popupBinding }, redirect: "manual"
    });
    expect(popupResult.status).toBe(303);
    expect(popupResult.headers.get("location")).toBe("/oauth/popup?success=1");
    expect(popupResult.headers.get("location")).not.toMatch(/secret|token|code|state|csrf/i);
    const popupSession = popupResult.headers.getSetCookie().find((value) => value.startsWith(`${sessionCookieName}=`))!.split(";")[0];
    expect((await fetch(`${baseUrl}/api/auth/twitch/me`, { headers: { Cookie: popupSession } })).status).toBe(200);
    expect((await fetch(`${baseUrl}/api/auth/twitch/me`, { headers: { Cookie: popupSession } })).status).toBe(200);
    expect(await prisma.user.count({ where: { twitchUserId: "12345" } })).toBe(1);
    await prisma.session.update({ where: { tokenHash: hashSessionToken(popupSession.split("=")[1]) }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await fetch(`${baseUrl}/api/auth/twitch/me`, { headers: { Cookie: popupSession } })).status).toBe(401);
  }
);

it("creates two independent Twitch channels and isolates moderators, OBS, media and TTS", async () => {
  await prisma.settings.create({ data: { key: `tts:twitch:${streamerId}`, value: "legacy-tts-preserved" } });
  const twitchUsers = [
    { id: "101", login: "streama", mode: "streamer", token: "stream-a" },
    { id: "202", login: "streamb", mode: "streamer", token: "stream-b" },
    { id: "301", login: "moda", mode: "moderator", token: "mod-a" },
    { id: "302", login: "modb", mode: "moderator", token: "mod-b" }
  ] as const;
  const accountIds: string[] = [];
  for (const item of twitchUsers) {
    const user = await prisma.user.create({ data: {
      username: `twitch:${item.id}`, displayName: item.login, passwordHash: "!twitch-oauth-only",
      twitchUserId: item.id, twitchLogin: item.login
    } });
    accountIds.push(user.id);
    await prisma.twitchOAuthConnection.create({ data: {
      userId: user.id, mode: "unified", encryptedAccess: encryptOAuthToken(item.token),
      encryptedRefresh: encryptOAuthToken(`refresh-${item.token}`), scopesJson: JSON.stringify(["moderation:read", "user:read:moderated_channels"]),
      expiresAt: new Date(Date.now() + 3600_000), checkedAt: new Date()
    } });
    await prisma.session.create({ data: {
      userId: user.id, tokenHash: hashSessionToken(item.token), authMethod: "TWITCH",
      twitchMode: "unified", expiresAt: new Date(Date.now() + 3600_000)
    } });
  }
  const realFetch = globalThis.fetch;
  let twitchDown = false;
  let mismatchedIdentity = false;
  vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
    const url = String(input);
    if (!url.startsWith("https://")) return realFetch(input, init);
    if (twitchDown) return Promise.resolve(new Response("unavailable", { status: 503 }));
    const bearer = String(new Headers(init?.headers).get("Authorization"));
    if (url.endsWith("/validate")) {
      const match = twitchUsers.find((user) => bearer === `OAuth ${user.token}`);
      return Promise.resolve(new Response(JSON.stringify({ client_id: config.twitchClientId, user_id: mismatchedIdentity && match?.id === "101" ? "202" : match?.id, scopes: ["moderation:read", "user:read:moderated_channels"] }), { status: match ? 200 : 401 }));
    }
    if (url.includes("moderation/moderators")) {
      const channel = new URL(url).searchParams.get("broadcaster_id");
      return Promise.resolve(new Response(JSON.stringify({ data: (channel === "101" ? ["301", "302"] : ["301", "302"]).map((user_id) => ({ user_id })), pagination: {} }), { status: 200 }));
    }
    if (url.includes("moderation/channels")) {
      return Promise.resolve(new Response(JSON.stringify({ data: ["101", "202"].map((broadcaster_id) => ({ broadcaster_id })), pagination: {} }), { status: 200 }));
    }
    if (url.includes("/users")) {
      return Promise.resolve(new Response(JSON.stringify({ data: twitchUsers.map((user) => ({ id: user.id, login: user.login, display_name: user.login, profile_image_url: "" })) }), { status: 200 }));
    }
    throw new Error(`Unexpected Twitch request: ${url}`);
  });
  const connectChannel = (token: string) => fetch(`${baseUrl}/api/auth/twitch/channels`, { method: "POST", headers: headers(token) });
  mismatchedIdentity = true;
  expect((await connectChannel("stream-a")).status).toBe(403);
  expect(await prisma.streamer.count()).toBe(1);
  mismatchedIdentity = false;
  await prisma.twitchOAuthConnection.updateMany({ where: { userId: accountIds[0] }, data: { revokedAt: null } });
  const first = await connectChannel("stream-a");
  const second = await connectChannel("stream-b");
  expect(first.status).toBe(201);
  expect(second.status).toBe(201);
  const firstId = ((await first.json()) as { channel: { id: string } }).channel.id;
  const secondId = ((await second.json()) as { channel: { id: string } }).channel.id;
  expect(firstId).not.toBe(secondId);
  expect((await connectChannel("stream-a")).status).toBe(200);
  expect(await prisma.streamer.count()).toBe(3);
  const old = await prisma.streamer.findUniqueOrThrow({ where: { id: streamerId } });
  expect(old.overlayToken).toBe("overlay-old");
  const a = await prisma.streamer.findUniqueOrThrow({ where: { id: firstId } });
  const b = await prisma.streamer.findUniqueOrThrow({ where: { id: secondId } });
  expect([a.canvasWidth, a.canvasHeight, b.canvasWidth, b.canvasHeight]).toEqual([1920, 1080, 1920, 1080]);
  expect(a.overlayToken).not.toBe(b.overlayToken);
  expect(a.overlayToken).not.toBe(old.overlayToken);
  expect(await prisma.media.count({ where: { streamerId: firstId } })).toBe(0);
  expect(await prisma.settings.count({ where: { key: { startsWith: `tts:twitch:${firstId}` } } })).toBe(0);
  expect((await prisma.settings.findUnique({ where: { key: `tts:twitch:${streamerId}` } }))?.value).toBe("legacy-tts-preserved");
  const listed = await fetch(`${baseUrl}/api/auth/twitch/channels`, { headers: headers("mod-a") });
  expect(listed.status).toBe(200);
  const listedBody = JSON.stringify(await listed.json());
  expect(listedBody).toContain(firstId);
  expect(listedBody).toContain(secondId);
  expect(listedBody).not.toContain(a.overlayToken);
  expect(listedBody).not.toContain(b.overlayToken);
  twitchDown = true;
  const cachedList = await fetch(`${baseUrl}/api/auth/twitch/channels`, { headers: headers("mod-a") });
  expect(cachedList.status).toBe(503);
  await prisma.channelModeratorSnapshot.updateMany({ data: { checkedAt: new Date(Date.now() - 16 * 60_000) } });
  expect((await fetch(`${baseUrl}/api/auth/twitch/channels`, { headers: headers("mod-a") })).status).toBe(503);
  await prisma.channelModeratorSnapshot.updateMany({ data: { checkedAt: new Date() } });
  twitchDown = false;
  expect((await fetch(`${baseUrl}/api/auth/me`, { headers: { ...headers("stream-a"), "X-Channel-Id": secondId } })).status).toBe(403);
  const editorMe = await fetch(`${baseUrl}/api/auth/me`, { headers: { ...headers("mod-a"), "X-Channel-Id": firstId } });
  expect(editorMe.status).toBe(200);
  const editorMeBody = await editorMe.json() as { user: { twitchLogin: string | null }; streamer: { twitchLogin: string | null } };
  expect(editorMeBody.user.twitchLogin).toBe("moda");
  expect(editorMeBody.streamer.twitchLogin).toBe("streama");
  expect(JSON.stringify(editorMeBody)).not.toContain(a.overlayToken);
  expect((await fetch(`${baseUrl}/api/obs`, { headers: { ...headers("stream-a"), "X-Channel-Id": secondId } })).status).toBe(403);
  const obs = await fetch(`${baseUrl}/api/obs`, { headers: { ...headers("stream-a"), "X-Channel-Id": firstId } });
  expect(obs.status).toBe(200);
  expect(JSON.stringify(await obs.json())).toContain(a.overlayToken);
  expect((await fetch(`${baseUrl}/api/obs`, { headers: { ...headers("mod-a"), "X-Channel-Id": firstId } })).status).toBe(403);
  expect((await fetch(`${baseUrl}/api/auth/twitch/channels/${firstId}/moderators`, { headers: headers("mod-a") })).status).toBe(403);
  expect((await fetch(`${baseUrl}/api/auth/twitch/channels/${firstId}/overlay-reload`, { method: "POST", headers: headers("mod-a") })).status).toBe(403);
  expect((await fetch(`${baseUrl}/api/tts/channels/${firstId}`, { headers: headers("mod-a") })).status).toBe(404);
  expect((await fetch(`${baseUrl}/api/obs`, { headers: headers("mod-session") })).status).toBe(403);
  expect((await fetch(`${baseUrl}/api/streamer`, { headers: headers("mod-session") })).status).toBe(403);
  expect((await fetch(`${baseUrl}/api/tts`, { headers: headers("stream-a") })).status).toBe(503);
  const ownCanvas = (await (await fetch(`${baseUrl}/api/auth/me`, { headers: { ...headers("stream-a"), "X-Channel-Id": firstId } })).json()) as { streamer: { canvasRevision: string } };
  expect((await fetch(`${baseUrl}/api/channels/${firstId}/canvas`, { method: "PUT", headers: { ...headers("mod-a"), "X-Channel-Id": firstId, "Content-Type": "application/json" }, body: JSON.stringify({ width: 1280, height: 720, mode: "keep", expectedRevision: ownCanvas.streamer.canvasRevision }) })).status).toBe(403);
  const resized = await fetch(`${baseUrl}/api/channels/${firstId}/canvas`, { method: "PUT", headers: { ...headers("stream-a"), "X-Channel-Id": firstId, "Content-Type": "application/json" }, body: JSON.stringify({ width: 1280, height: 720, mode: "keep", expectedRevision: ownCanvas.streamer.canvasRevision }) });
  expect(resized.status).toBe(200);
  expect((await prisma.streamer.findUniqueOrThrow({ where: { id: secondId } })).canvasWidth).toBe(1920);
  const uploaded = await upload("stream-a");
  expect(uploaded.status).toBe(403); // Uploads require an explicit channel in the Twitch editor.
  const data = new FormData();
  data.append("file", new Blob([new Uint8Array(png)], { type: "image/png" }), "a.png");
  const saved = await fetch(`${baseUrl}/api/media`, { method: "POST", headers: { ...headers("stream-a"), "X-Channel-Id": firstId }, body: data });
  expect(saved.status).toBe(201);
  const media = ((await saved.json()) as { media: { id: string; url: string } }).media;
  const secondData = new FormData();
  secondData.append("file", new Blob([new Uint8Array(png)], { type: "image/png" }), "b.png");
  const secondSaved = await fetch(`${baseUrl}/api/media`, { method: "POST", headers: { ...headers("stream-b"), "X-Channel-Id": secondId }, body: secondData });
  expect(secondSaved.status).toBe(201);
  const secondMedia = ((await secondSaved.json()) as { media: { url: string } }).media;
  expect(secondMedia.url).not.toBe(media.url);
  for (const method of ["GET", "HEAD"] as const) {
    expect((await fetch(`${baseUrl}${media.url}`, { method, headers: headers("stream-b") })).status).toBe(404);
    expect((await fetch(`${baseUrl}${secondMedia.url}`, { method, headers: headers("stream-a") })).status).toBe(404);
    expect((await fetch(`${baseUrl}${media.url}?overlayToken=${b.overlayToken}`, { method, headers: { Range: "bytes=0-1" } })).status).toBe(404);
    expect((await fetch(`${baseUrl}${media.url}?overlayToken=${a.overlayToken}`, { method, headers: { Range: "bytes=0-1" } })).status).toBe(206);
  }
  expect((await fetch(`${baseUrl}/api/media/${media.id}`, { method: "DELETE", headers: { ...headers("stream-b"), "X-Channel-Id": secondId } })).ok).toBe(false);
  expect((await fetch(`${baseUrl}/api/media/${media.id}`, { method: "DELETE", headers: { ...headers("mod-a"), "X-Channel-Id": firstId } })).status).toBe(403);
  expect(await prisma.media.findUnique({ where: { id: media.id } })).not.toBeNull();
  const overlayA = await socketClient({ overlayToken: a.overlayToken }, "overlay:state");
  const overlayB = await socketClient({ overlayToken: b.overlayToken }, "overlay:state");
  const deniedSocket = await socketClient({ session: "stream-a", channelId: secondId }, "connect_error");
  expect(deniedSocket.connected).toBe(false);
  const editorA = await socketClient({ session: "stream-a", channelId: firstId });
  const editorB = await socketClient({ session: "stream-b", channelId: secondId });
  const otherEvents: unknown[] = [];
  overlayB.on("overlay:state", (value) => otherEvents.push(value));
  const changed = event(overlayA, "overlay:state");
  editorA.emit("preview:add", { type: "TEXT", text: "only A" });
  await changed;
  expect(otherEvents).toHaveLength(0);
  const firstEvents: unknown[] = [];
  overlayA.on("overlay:state", (value) => firstEvents.push(value));
  const changedB = event(overlayB, "overlay:state");
  editorB.emit("preview:add", { type: "TEXT", text: "only B" });
  await changedB;
  expect(firstEvents).toHaveLength(0);
  expect((await prisma.previewElement.findMany({ where: { streamerId: secondId } }))).toMatchObject([{ text: "only B" }]);
  const modA = await socketClient({ session: "mod-a", channelId: firstId });
  const modB = await socketClient({ session: "mod-a", channelId: secondId });
  const independent = await socketClient({ session: "mod-b", channelId: secondId });
  const revoked = event(modA, "disconnect");
  const ban = await fetch(`${baseUrl}/api/auth/twitch/channels/${firstId}/bans/${accountIds[2]}`, { method: "PUT", headers: headers("stream-a") });
  expect(ban.status).toBe(200);
  await revoked;
  expect(modB.connected).toBe(true);
  expect(independent.connected).toBe(true);
  expect((await fetch(`${baseUrl}/api/media`, { headers: { ...headers("mod-a"), "X-Channel-Id": firstId } })).status).toBe(403);
  expect((await fetch(`${baseUrl}/api/media`, { headers: { ...headers("mod-a"), "X-Channel-Id": secondId } })).status).toBe(200);
  expect(editorB.connected).toBe(true);
});

it("binds the existing channel only with the same legacy owner session and Twitch identity", async () => {
  config.twitchOAuthRedirectUri = `${baseUrl}/api/auth/twitch/callback`;
  await prisma.media.create({ data: { streamerId, filename: "keep.png", originalName: "keep.png", mimeType: "image/png", type: "IMAGE", size: png.length, url: "/uploads/keep.png" } });
  await prisma.settings.create({ data: { key: `tts:twitch:${streamerId}`, value: "existing-tts-setting" } });
  const denied = await fetch(`${baseUrl}/api/auth/twitch/start/bind`, { headers: headers("mod-session"), redirect: "manual" });
  expect(denied.status).toBe(403);
  const start = await fetch(`${baseUrl}/api/auth/twitch/start/bind`, { headers: headers(), redirect: "manual" });
  expect(start.status).toBe(302);
  const authorize = new URL(start.headers.get("location")!);
  expect(authorize.searchParams.get("scope")).toBe("moderation:read user:read:moderated_channels");
  const stateCookie = start.headers.getSetCookie().find((value) => value.startsWith("mod_overlay_twitch_state="))!.split(";")[0];
  const callback = `${baseUrl}/api/auth/twitch/callback?state=${authorize.searchParams.get("state")}&code=code`;
  const wrongSession = await fetch(callback, { headers: { Cookie: `${stateCookie}; ${headers("mod-session").Cookie}` }, redirect: "manual" });
  expect(wrongSession.headers.get("location")).toBe("/login?oauth_error=legacy_owner_required");
  expect((await prisma.streamer.findUnique({ where: { id: streamerId } }))?.ownerUserId).toBeNull();
  const retry = await fetch(`${baseUrl}/api/auth/twitch/start/bind`, { headers: headers(), redirect: "manual" });
  const retryState = new URL(retry.headers.get("location")!).searchParams.get("state");
  const retryCookie = retry.headers.getSetCookie().find((value) => value.startsWith("mod_overlay_twitch_state="))!.split(";")[0];
  const realFetch = globalThis.fetch;
  vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
    const url = String(input);
    if (!url.startsWith("https://")) return realFetch(input, init);
    const body = url.endsWith("/token")
      ? { access_token: "owner-access", refresh_token: "owner-refresh", expires_in: 3600, scope: ["moderation:read", "user:read:moderated_channels"] }
      : url.endsWith("/validate")
        ? { client_id: "oauth-test-client", user_id: "12345", scopes: ["moderation:read", "user:read:moderated_channels"] }
        : { data: [{ id: "12345", login: "ownername", display_name: "Owner Name", profile_image_url: "" }] };
    return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
  });
  const result = await fetch(`${baseUrl}/api/auth/twitch/callback?state=${retryState}&code=code`, { headers: { Cookie: `${retryCookie}; ${headers().Cookie}` }, redirect: "manual" });
  expect(result.status).toBe(303);
  expect(result.headers.get("location")).toBe("/channels?oauth_bound=1");
  const newSession = result.headers.getSetCookie().filter((value) => value.startsWith(`${sessionCookieName}=`)).at(-1)!.split(";")[0];
  expect((await fetch(`${baseUrl}/api/auth/twitch/me`, { headers: { Cookie: newSession } })).status).toBe(200);
  expect((await fetch(`${baseUrl}/api/auth/me`, { headers: headers() })).status).toBe(401);
  const channel = await prisma.streamer.findUnique({ where: { id: streamerId } });
  expect(channel).toMatchObject({ twitchBroadcasterId: "12345", twitchLogin: "ownername", overlayToken: "overlay-old" });
  expect(channel?.ownerUserId).toBeTruthy();
  const legacyOwner = await prisma.user.findFirstOrThrow({ where: { role: "OWNER" } });
  await addSession(legacyOwner.id, "legacy-again");
  const relabel = await fetch(`${baseUrl}/api/streamer/twitch`, {
    method: "PATCH",
    headers: { ...headers("legacy-again"), "Content-Type": "application/json" },
    body: JSON.stringify({ login: "imposter", broadcasterId: "99999" })
  });
  expect(relabel.status).toBe(409);
  expect((await prisma.streamer.findUnique({ where: { id: streamerId } }))?.twitchBroadcasterId).toBe("12345");
  expect((await fetch(`${baseUrl}/api/auth/twitch/start/bind`, { headers: headers("legacy-again"), redirect: "manual" })).status).toBe(409);
  expect((await prisma.media.count({ where: { streamerId } }))).toBe(1);
  expect((await prisma.settings.findUnique({ where: { key: `tts:twitch:${streamerId}` } }))?.value).toBe("existing-tts-setting");
});

it("paginates Twitch lists, applies bans, expires stale snapshots, and isolates foreign media", async () => {
  const owner = await prisma.user.create({ data: { username: "twitch:12345", displayName: "Twitch owner", passwordHash: "!", twitchUserId: "12345" } });
  const mod = await prisma.user.create({ data: { username: "twitch:67890", displayName: "Twitch mod", passwordHash: "!", twitchUserId: "67890" } });
  await prisma.streamer.update({ where: { id: streamerId }, data: { ownerUserId: owner.id, twitchBroadcasterId: "12345" } });
  const second = await prisma.streamer.create({ data: { displayName: "Foreign", overlayToken: "foreign-token" } });
  const { encryptOAuthToken } = await import("../src/server/channelAccess");
  for (const [userId, token] of [[owner.id, "owner-access"], [mod.id, "mod-access"]] as const) {
    await prisma.twitchOAuthConnection.create({ data: { userId, mode: "unified", encryptedAccess: encryptOAuthToken(token), encryptedRefresh: encryptOAuthToken("refresh"), scopesJson: "[]", expiresAt: new Date(Date.now() + 3600_000), checkedAt: new Date() } });
  }
  await prisma.session.create({ data: { userId: mod.id, tokenHash: hashSessionToken("twitch-mod"), authMethod: "TWITCH", twitchMode: "unified", expiresAt: new Date(Date.now() + 3600_000) } });
  await prisma.session.create({ data: { userId: owner.id, tokenHash: hashSessionToken("twitch-owner"), authMethod: "TWITCH", twitchMode: "unified", expiresAt: new Date(Date.now() + 3600_000) } });
  const session = await prisma.session.findFirstOrThrow({ where: { tokenHash: hashSessionToken("twitch-mod") }, include: { user: true } });
  const realFetch = globalThis.fetch;
  let moderatorRemoved = false;
  vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
    const url = String(input);
    if (url === "https://id.twitch.tv/oauth2/validate") {
      const token = new Headers(init?.headers).get("Authorization");
      const userId = token === "OAuth owner-access" ? "12345" : token === "OAuth mod-access" ? "67890" : "99999";
      return Promise.resolve(new Response(JSON.stringify({ client_id: config.twitchClientId, user_id: userId,
        scopes: ["moderation:read", "user:read:moderated_channels"] })));
    }
    if (!url.startsWith("https://api.twitch.tv/")) return realFetch(input, init);
    if (url.includes("/users?")) {
      const ids = new URL(url).searchParams.getAll("id");
      return Promise.resolve(new Response(JSON.stringify({ data: ids.map((id) => ({ id, login: `user${id}`, display_name: `User ${id}`, profile_image_url: `https://static-cdn.jtvnw.net/user-${id}.png` })) }), { status: 200 }));
    }
    const first = !url.includes("after=next");
    const moderators = url.includes("/moderators");
    const data = moderators
      ? first ? [{ user_id: "99999" }] : moderatorRemoved ? [] : [{ user_id: "67890" }]
      : first ? [{ broadcaster_id: "99999" }] : [{ broadcaster_id: "12345" }];
    expect((init?.headers as Record<string, string>)["Client-Id"]).toBe("oauth-test-client");
    return Promise.resolve(new Response(JSON.stringify({ data, pagination: first ? { cursor: "next" } : {} }), { status: 200 }));
  });
  expect(await getModeratedChannels(mod.id)).toContain("12345");
  expect(await syncModerators(streamerId)).toContain("67890");
  expect(await canAccessChannel(session, streamerId)).toBe(true);
  expect(await canAccessChannel(session, second.id)).toBe(false);
  expect((await fetch(`${baseUrl}/api/auth/me`, { headers: headers("twitch-mod") })).status).toBe(403);
  const editorHeaders = { ...headers("twitch-mod"), "x-channel-id": streamerId };
  expect((await fetch(`${baseUrl}/api/auth/me`, { headers: editorHeaders })).status).toBe(200);
  expect((await fetch(`${baseUrl}/api/media`, { headers: editorHeaders })).status).toBe(200);
  expect((await fetch(`${baseUrl}/api/obs`, { headers: editorHeaders })).status).toBe(403);
  expect((await fetch(`${baseUrl}/api/obs`, { headers: { ...headers("twitch-owner"), "x-channel-id": streamerId } })).status).toBe(200);
  await prisma.media.create({ data: { streamerId, filename: "mod-access.png", originalName: "mod-access.png", mimeType: "image/png", type: "IMAGE", size: png.length, url: "/uploads/mod-access.png" } });
  await fs.writeFile(path.join(config.uploadDir, "mod-access.png"), png);
  expect((await fetch(`${baseUrl}/uploads/mod-access.png`, { headers: headers("twitch-mod") })).status).toBe(200);
  expect((await fetch(`${baseUrl}/uploads/mod-access.png`, { method: "HEAD", headers: headers("twitch-mod") })).status).toBe(200);
  expect((await fetch(`${baseUrl}/uploads/mod-access.png`, { headers: { ...headers("twitch-mod"), Range: "bytes=0-3" } })).status).toBe(206);
  expect((await fetch(`${baseUrl}/api/media`, { headers: { ...editorHeaders, "x-channel-id": second.id } })).status).toBe(403);
  const picker = await fetch(`${baseUrl}/api/auth/twitch/channels`, { headers: headers("twitch-mod") });
  expect(picker.status).toBe(200);
  expect((await picker.json() as { channels: Array<{ id: string | null; status: string }> }).channels).toEqual(expect.arrayContaining([expect.objectContaining({ id: streamerId, status: "connected" })]));
  const moderatorList = await fetch(`${baseUrl}/api/auth/twitch/channels/${streamerId}/moderators`, { headers: headers("twitch-owner") });
  expect(moderatorList.status).toBe(200);
  expect(await moderatorList.json()).toEqual(expect.objectContaining({ moderators: expect.arrayContaining([expect.objectContaining({ twitchUserId: "67890", banned: false })]) }));
  const otherOwner = await prisma.user.findUniqueOrThrow({ where: { twitchUserId: "99999" } });
  const otherChannel = await prisma.streamer.create({ data: { displayName: "Other channel", overlayToken: "other-overlay-token", ownerUserId: otherOwner.id, twitchBroadcasterId: "99999" } });
  await prisma.twitchOAuthConnection.create({ data: { userId: otherOwner.id, mode: "unified", encryptedAccess: encryptOAuthToken("other-access"), encryptedRefresh: encryptOAuthToken("refresh"), scopesJson: "[]", expiresAt: new Date(Date.now() + 3600_000), checkedAt: new Date() } });
  await syncModerators(otherChannel.id);
  const liveSocket = await socketClient({ session: "twitch-mod", channelId: streamerId });
  const otherSocket = await socketClient({ session: "twitch-mod", channelId: otherChannel.id });
  expect((await fetch(`${baseUrl}/api/auth/twitch/channels/${streamerId}/bans/${mod.id}`, { method: "PUT", headers: headers("twitch-mod") })).status).toBe(403);
  expect((await fetch(`${baseUrl}/api/auth/twitch/channels/${second.id}/bans/${mod.id}`, { method: "PUT", headers: headers("twitch-owner") })).status).toBe(403);
  const revoked = event(liveSocket, "access:revoked");
  expect((await fetch(`${baseUrl}/api/auth/twitch/channels/${streamerId}/bans/${mod.id}`, { method: "PUT", headers: headers("twitch-owner") })).status).toBe(200);
  await revoked;
  expect(otherSocket.connected).toBe(true);
  expect((await fetch(`${baseUrl}/api/media`, { headers: { ...headers("twitch-mod"), "x-channel-id": otherChannel.id } })).status).toBe(200);
  expect((await fetch(`${baseUrl}/uploads/mod-access.png`, { headers: headers("twitch-mod") })).status).toBe(404);
  expect((await fetch(`${baseUrl}/uploads/mod-access.png`, { method: "HEAD", headers: headers("twitch-mod") })).status).toBe(404);
  expect((await fetch(`${baseUrl}/uploads/mod-access.png`, { headers: { ...headers("twitch-mod"), Range: "bytes=0-3" } })).status).toBe(404);
  expect((await fetch(`${baseUrl}/api/media`, { headers: editorHeaders })).status).toBe(403);
  const deniedPicker = await fetch(`${baseUrl}/api/auth/twitch/channels`, { headers: headers("twitch-mod") });
  expect((await deniedPicker.json() as { channels: Array<{ id: string | null; status: string }> }).channels).toEqual(expect.arrayContaining([expect.objectContaining({ id: otherChannel.id, status: "connected" }), expect.objectContaining({ id: streamerId, status: "denied" })]));
  expect(await canAccessChannel(session, streamerId)).toBe(false);
  expect((await fetch(`${baseUrl}/api/auth/twitch/channels/${streamerId}/bans/${mod.id}`, { method: "DELETE", headers: headers("twitch-owner") })).status).toBe(200);
  await setModeratorBan(streamerId, owner.id, mod.id, true);
  expect(await canAccessChannel(session, streamerId)).toBe(false);
  await setModeratorBan(streamerId, owner.id, mod.id, false);
  expect(await canAccessChannel(session, streamerId)).toBe(true);
  moderatorRemoved = true;
  await prisma.channelModeratorSnapshot.update({ where: { channelId: streamerId }, data: { checkedAt: new Date(Date.now() - 11_000) } });
  expect(await canAccessChannel(session, streamerId)).toBe(false);
  moderatorRemoved = false;
  await prisma.channelModeratorSnapshot.update({ where: { channelId: streamerId }, data: { checkedAt: new Date(Date.now() - 20 * 60_000) } });
  vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => String(input).startsWith("https://api.twitch.tv/") ? Promise.reject(new Error("Twitch unavailable")) : realFetch(input, init));
  expect(await canAccessChannel(session, streamerId)).toBe(false);
  await prisma.channelModeratorSnapshot.update({ where: { channelId: streamerId }, data: { checkedAt: new Date(Date.now() - 6 * 60_000) } });
  vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
    const url = String(input);
    if (url === "https://id.twitch.tv/oauth2/validate") {
      const userId = new Headers(init?.headers).get("Authorization") === "OAuth mod-access" ? "67890" : "12345";
      return Promise.resolve(new Response(JSON.stringify({ client_id: config.twitchClientId, user_id: userId,
        scopes: ["moderation:read", "user:read:moderated_channels"] })));
    }
    if (url.startsWith("https://api.twitch.tv/")) return Promise.resolve(new Response(null, { status: 401 }));
    if (url === "https://id.twitch.tv/oauth2/token") return Promise.resolve(new Response(null, { status: 400 }));
    return realFetch(input, init);
  });
  expect(await canAccessChannel(session, streamerId)).toBe(false);
  expect((await prisma.twitchOAuthConnection.findUnique({ where: { userId_mode: { userId: owner.id, mode: "unified" } } }))?.revokedAt).toBeTruthy();
  expect((await fetch(`${baseUrl}/api/auth/twitch/channels/${streamerId}/bans/${mod.id}`, { method: "PUT", headers: headers("twitch-owner") })).status).toBe(401);
  await prisma.media.create({ data: { streamerId: second.id, filename: "foreign.png", originalName: "foreign.png", mimeType: "image/png", type: "IMAGE", size: png.length, url: "/uploads/foreign.png" } });
  await fs.writeFile(path.join(config.uploadDir, "foreign.png"), png);
  expect((await fetch(`${baseUrl}/uploads/foreign.png`, { headers: headers() })).status).toBe(404);
  expect((await fetch(`${baseUrl}/uploads/foreign.png`, { method: "HEAD", headers: headers() })).status).toBe(404);
  expect((await fetch(`${baseUrl}/uploads/foreign.png`, { headers: { ...headers(), Range: "bytes=0-3" } })).status).toBe(404);
  expect((await fetch(`${baseUrl}/uploads/foreign.png?overlayToken=overlay-old`)).status).toBe(404);
  expect((await fetch(`${baseUrl}/uploads/foreign.png?overlayToken=foreign-token`)).status).toBe(200);
  expect((await fetch(`${baseUrl}/uploads/foreign.png?overlayToken=foreign-token`, { headers: headers("twitch-mod") })).status).toBe(200);
  expect((await fetch(`${baseUrl}/api/media`, { headers: { ...headers(), "x-channel-id": second.id } })).status).toBe(403);
});

it("rejects denied, expired and underscoped Twitch callbacks without creating a session", async () => {
  config.twitchOAuthRedirectUri = `${baseUrl}/api/auth/twitch/callback`;
  const realFetch = globalThis.fetch;
  const tokenRequests: string[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
    const url = String(input);
    if (!url.startsWith("https://id.twitch.tv/")) return realFetch(input, init);
    tokenRequests.push(url);
    const body = url.endsWith("/token")
      ? {
          access_token: "access-secret",
          refresh_token: "refresh-secret",
          expires_in: 3600,
          scope: []
        }
      : { client_id: "oauth-test-client", user_id: "12345", scopes: [] };
    return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
  });
  async function start() {
    const response = await fetch(`${baseUrl}/api/auth/twitch/start/unified`, {
      redirect: "manual"
    });
    return {
      state: new URL(response.headers.get("location")!).searchParams.get("state")!,
      cookie: response.headers
        .getSetCookie()
        .find((value) => value.startsWith("mod_overlay_twitch_state="))!
        .split(";")[0]
    };
  }
  const denied = await start();
  const deniedResponse = await fetch(
    `${baseUrl}/api/auth/twitch/callback?state=${denied.state}&error=access_denied`,
    { headers: { Cookie: denied.cookie }, redirect: "manual" }
  );
  expect(deniedResponse.headers.get("location")).toBe("/login?oauth_error=denied");
  expect(tokenRequests).toHaveLength(0);
  const popupStart = await fetch(`${baseUrl}/api/auth/twitch/start/unified?popup=1`, { redirect: "manual" });
  const popupState = new URL(popupStart.headers.get("location")!).searchParams.get("state");
  const popupCookie = popupStart.headers.getSetCookie().find((value) => value.startsWith("mod_overlay_twitch_state="))!.split(";")[0];
  const popupDenied = await fetch(`${baseUrl}/api/auth/twitch/callback?state=${popupState}&error=access_denied`, {
    headers: { Cookie: popupCookie }, redirect: "manual"
  });
  expect(popupDenied.headers.get("location")).toBe("/oauth/popup?error=denied");
  expect(popupDenied.headers.getSetCookie().some((value) => value.startsWith(`${sessionCookieName}=`))).toBe(false);
  const expired = await start();
  await prisma.twitchOAuthState.update({
    where: {
      stateHash: (await prisma.twitchOAuthState.findFirst({ orderBy: { createdAt: "desc" } }))!
        .stateHash
    },
    data: { expiresAt: new Date(Date.now() - 1000) }
  });
  const expiredResponse = await fetch(
    `${baseUrl}/api/auth/twitch/callback?state=${expired.state}&code=code`,
    { headers: { Cookie: expired.cookie }, redirect: "manual" }
  );
  expect(expiredResponse.headers.get("location")).toBe("/login?oauth_error=invalid_state");
  const underscoped = await start();
  const response = await fetch(
    `${baseUrl}/api/auth/twitch/callback?state=${underscoped.state}&code=code`,
    { headers: { Cookie: underscoped.cookie }, redirect: "manual" }
  );
  expect(response.headers.get("location")).toBe("/login?oauth_error=insufficient_scope");
  expect(await prisma.user.count({ where: { twitchUserId: { not: null } } })).toBe(0);
});

it("disables TTS connections, speech and reward mutations while preserving settings and OBS", async () => {
  const legacyKey = `tts:twitch:${streamerId}`;
  await prisma.settings.create({ data: { key: legacyKey, value: "existing-encrypted-tts-settings" } });
  const twitchOwner = await prisma.user.create({ data: {
    username: "twitch:disabled", displayName: "Disabled TTS owner", passwordHash: "!twitch-oauth-only",
    twitchUserId: "tts-disabled", twitchLogin: "tts-disabled"
  } });
  const channel = await prisma.streamer.create({ data: {
    displayName: "Disabled TTS channel", overlayToken: "overlay-disabled-tts",
    ownerUserId: twitchOwner.id, twitchBroadcasterId: "tts-disabled", twitchLogin: "tts-disabled"
  } });
  await addSession(twitchOwner.id, "tts-disabled-session");
  await prisma.session.update({ where: { tokenHash: hashSessionToken("tts-disabled-session") },
    data: { authMethod: "TWITCH", twitchMode: "unified" } });
  await prisma.twitchOAuthConnection.create({ data: { userId: twitchOwner.id, mode: "unified",
    encryptedAccess: encryptOAuthToken("disabled-access"), encryptedRefresh: encryptOAuthToken("disabled-refresh"),
    scopesJson: JSON.stringify(["moderation:read", "user:read:moderated_channels"]),
    expiresAt: new Date(Date.now() + 3600_000), checkedAt: new Date() } });
  const modernKey = `tts:twitch:${channel.id}`;
  await prisma.settings.create({ data: { key: modernKey, value: "existing-modern-tts-settings" } });
  const overlay = await socketClient({ overlayToken: "overlay-old" }, "overlay:state");
  const played = vi.fn();
  overlay.on("tts:play", played);
  const webSocket = vi.fn();
  vi.stubGlobal("WebSocket", webSocket);
  const settingsScan = vi.spyOn(prisma.settings, "findMany");
  const originalFetch = globalThis.fetch;
  const twitchRequests: string[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
    if (String(input) === "https://id.twitch.tv/oauth2/validate") return Promise.resolve(new Response(JSON.stringify({
      client_id: config.twitchClientId, user_id: "tts-disabled",
      scopes: ["moderation:read", "user:read:moderated_channels"]
    })));
    if (String(input).includes("twitch.tv")) twitchRequests.push(String(input));
    return originalFetch(input, init);
  });
  try {
    startTts(realtime);
    expect(webSocket).not.toHaveBeenCalled();
    expect(settingsScan).not.toHaveBeenCalled();
    expect(await (await fetch(`${baseUrl}/api/tts`, { headers: headers() })).json()).toMatchObject({
      available: false, configured: false, connected: false, enabled: false, ready: false
    });
    expect(await (await fetch(`${baseUrl}/api/tts/channels/${channel.id}`, { headers: headers("tts-disabled-session") })).json()).toMatchObject({
      available: false, configured: false, connected: false, enabled: false, ready: false
    });
    const blocked = [
      [`/api/tts/connect`, "GET", headers()],
      [`/api/tts/callback?state=invalid`, "GET", headers()],
      [`/api/tts/reward`, "POST", headers()],
      [`/api/tts/reward`, "PATCH", headers()],
      [`/api/tts/channels/${channel.id}/connect`, "GET", headers("tts-disabled-session")],
      [`/api/tts/channels/${channel.id}/enabled`, "PUT", headers("tts-disabled-session")],
      [`/api/tts/channels/${channel.id}/reward`, "POST", headers("tts-disabled-session")],
      [`/api/tts/channels/${channel.id}/reward`, "PATCH", headers("tts-disabled-session")]
    ] as const;
    for (const [route, method, auth] of blocked) {
      const response = await fetch(`${baseUrl}${route}`, { method, headers: auth, redirect: "manual" });
      expect(response.status, `${method} ${route}`).toBe(503);
      expect((await response.json() as { error: string }).error).toContain("временно недоступен");
    }
    expect((await fetch(`${baseUrl}/api/tts/audio/unknown`)).status).toBe(503);
    overlay.emit("tts:done", { id: "unused" });
    expect(played).not.toHaveBeenCalled();
    expect(await files()).toEqual([]);
    expect(twitchRequests).toEqual([]);
    expect((await prisma.settings.findUniqueOrThrow({ where: { key: legacyKey } })).value).toBe("existing-encrypted-tts-settings");
    expect((await prisma.settings.findUniqueOrThrow({ where: { key: modernKey } })).value).toBe("existing-modern-tts-settings");
    expect((await fetch(`${baseUrl}/api/obs`, { headers: headers() })).status).toBe(200);
    expect((await fetch(`${baseUrl}/api/auth/twitch/me`, { headers: headers("tts-disabled-session") })).status).toBe(200);
  } finally {
    stopTts();
    vi.unstubAllGlobals();
  }
});

it("keeps TTS setup owner-only and rejects unknown audio URLs", async () => {
  config.ttsEnabled = true;
  const session = await fetch(`${baseUrl}/api/auth/me`, { headers: headers() });
  expect(session.status).toBe(200);
  const { csrfToken } = (await session.json()) as { csrfToken: string };
  const initializedMutation = await fetch(`${baseUrl}/api/tts/reward`, {
    method: "POST",
    headers: {
      Cookie: headers().Cookie,
      "x-csrf-token": csrfToken,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ cost: 0 })
  });
  expect(initializedMutation.status).toBe(400);
  const owner = await fetch(`${baseUrl}/api/tts`, { headers: headers() });
  expect(owner.status).toBe(200);
  expect(await owner.json()).toMatchObject({ connected: false, rewardCost: 1000 });
  const moderator = await fetch(`${baseUrl}/api/tts`, { headers: headers("mod-session") });
  expect(moderator.status).toBe(403);
  const mutateAsModerator = await fetch(`${baseUrl}/api/tts/reward`, {
    method: "POST",
    headers: { ...headers("mod-session"), "Content-Type": "application/json" },
    body: JSON.stringify({ cost: 1000 })
  });
  expect(mutateAsModerator.status).toBe(403);
  const noCsrf = await fetch(`${baseUrl}/api/tts/reward`, {
    method: "POST",
    headers: { Cookie: headers().Cookie, "Content-Type": "application/json" },
    body: JSON.stringify({ cost: 1000 })
  });
  expect(noCsrf.status).toBe(403);
  const invalidCost = await fetch(`${baseUrl}/api/tts/reward`, {
    method: "POST",
    headers: { ...headers(), "Content-Type": "application/json" },
    body: JSON.stringify({ cost: 0 })
  });
  expect(invalidCost.status).toBe(400);
  expect((await fetch(`${baseUrl}/api/tts/audio/unknown`)).status).toBe(404);
});

it("binds Twitch OAuth to the owner session and stores tokens encrypted", async () => {
  config.ttsEnabled = true;
  config.twitchClientId = "test-client";
  config.twitchClientSecret = "test-secret";
  config.ttsPython = "/test/python";
  config.publicOrigin = baseUrl;
  const originalFetch = globalThis.fetch;
  const external = vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
    const url = String(input);
    if (url === "https://id.twitch.tv/oauth2/token") {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            access_token: "private-access-token",
            refresh_token: "private-refresh-token",
            expires_in: 3600
          }),
          { headers: { "Content-Type": "application/json" } }
        )
      );
    }
    if (url === "https://api.twitch.tv/helix/users") {
      return Promise.resolve(
        new Response(JSON.stringify({ data: [{ id: "broadcaster-1", login: "streamer" }] }), {
          headers: { "Content-Type": "application/json" }
        })
      );
    }
    if (url.startsWith("https://api.twitch.tv/helix/channel_points/custom_rewards")) {
      if (init?.method === "POST")
        return Promise.resolve(
          new Response(JSON.stringify({ data: [{ id: "reward-1" }] }), {
            headers: { "Content-Type": "application/json" }
          })
        );
      return Promise.resolve(
        new Response(JSON.stringify({ data: [{ id: "reward-1" }] }), {
          headers: { "Content-Type": "application/json" }
        })
      );
    }
    return originalFetch(input, init);
  });
  try {
    const connect = await fetch(`${baseUrl}/api/tts/connect`, {
      headers: headers(),
      redirect: "manual"
    });
    expect(connect.status).toBe(302);
    const location = new URL(connect.headers.get("location")!);
    expect(location.hostname).toBe("id.twitch.tv");
    expect(location.searchParams.get("redirect_uri")).toBe(`${baseUrl}/api/tts/callback`);
    const state = location.searchParams.get("state")!;
    await addSession(ownerId, "other-owner-session");
    const wrongSession = await fetch(`${baseUrl}/api/tts/callback?state=${state}&code=auth-code`, {
      headers: headers("other-owner-session")
    });
    expect(wrongSession.status).toBe(400);
    const retryConnect = await fetch(`${baseUrl}/api/tts/connect`, {
      headers: headers(),
      redirect: "manual"
    });
    const retryState = new URL(retryConnect.headers.get("location")!).searchParams.get("state")!;
    const callback = await fetch(`${baseUrl}/api/tts/callback?state=${retryState}&code=auth-code`, {
      headers: headers(),
      redirect: "manual"
    });
    expect(callback.status).toBe(302);
    const stored = await prisma.settings.findUniqueOrThrow({
      where: { key: `tts:twitch:${streamerId}` }
    });
    expect(stored.value).not.toContain("private-access-token");
    expect(stored.value).not.toContain("private-refresh-token");
    const create = await fetch(`${baseUrl}/api/tts/reward`, {
      method: "POST",
      headers: { ...headers(), "Content-Type": "application/json" },
      body: JSON.stringify({ cost: 1000 })
    });
    expect(create.status).toBe(200);
    const update = await fetch(`${baseUrl}/api/tts/reward`, {
      method: "PATCH",
      headers: { ...headers(), "Content-Type": "application/json" },
      body: JSON.stringify({ cost: 2000 })
    });
    expect(update.status).toBe(200);
    expect(await (await fetch(`${baseUrl}/api/tts`, { headers: headers() })).json()).toMatchObject({
      connected: true,
      rewardId: "reward-1",
      rewardCost: 2000
    });
    expect(external).toHaveBeenCalled();
  } finally {
    config.twitchClientId = "";
    config.twitchClientSecret = "";
    config.ttsPython = "";
    config.publicOrigin = "";
  }
});

it("runs two Twitch TTS channels independently across OAuth, queues, revocation and restart", async () => {
  config.ttsEnabled = true;
  config.twitchClientId = "tts-test-client";
  config.twitchClientSecret = "tts-test-secret";
  config.ttsPython = process.execPath;
  config.publicOrigin = baseUrl;
  await fs.mkdir(path.join(fixture.root, "scripts"), { recursive: true });
  await fs.writeFile(path.join(fixture.root, "scripts", "tts_worker.py"),
    "const fs=require('fs');let data='';process.stdin.on('data',x=>data+=x);process.stdin.on('end',()=>fs.writeFileSync(process.argv[2],JSON.parse(data).text));");
  const owners = [];
  for (const [twitchId, token] of [["101", "tts-a"], ["202", "tts-b"]] as const) {
    const owner = await prisma.user.create({ data: { username: `twitch:${twitchId}`, displayName: token,
      passwordHash: "!twitch-oauth-only", twitchUserId: twitchId, twitchLogin: token } });
    const channel = await prisma.streamer.create({ data: { displayName: token, overlayToken: `overlay-${token}`,
      ownerUserId: owner.id, twitchBroadcasterId: twitchId, twitchLogin: token } });
    await prisma.session.create({ data: { userId: owner.id, tokenHash: hashSessionToken(token), authMethod: "TWITCH",
      twitchMode: "unified", expiresAt: new Date(Date.now() + 3600_000) } });
    await prisma.twitchOAuthConnection.create({ data: { userId: owner.id, mode: "unified",
      encryptedAccess: encryptOAuthToken(`oauth-${twitchId}`), encryptedRefresh: encryptOAuthToken(`oauth-refresh-${twitchId}`),
      scopesJson: JSON.stringify(["moderation:read", "user:read:moderated_channels"]),
      expiresAt: new Date(Date.now() + 3600_000), checkedAt: new Date() } });
    owners.push({ channel, token, twitchId });
  }
  const moderator = await prisma.user.create({ data: { username: "twitch:303", displayName: "Twitch mod",
    passwordHash: "!twitch-oauth-only", twitchUserId: "303" } });
  await prisma.session.create({ data: { userId: moderator.id, tokenHash: hashSessionToken("tts-mod"),
    authMethod: "TWITCH", twitchMode: "moderator", expiresAt: new Date(Date.now() + 3600_000) } });
  const overlayA = await socketClient({ overlayToken: owners[0].channel.overlayToken }, "overlay:state");
  const overlayB = await socketClient({ overlayToken: owners[1].channel.overlayToken }, "overlay:state");
  class FakeWebSocket {
    static OPEN = 1;
    readyState = 1;
    handlers = new Map<string, Array<(event: { data: string }) => void>>();
    constructor(_url: string) { instances.push(this); }
    addEventListener(name: string, handler: (event: { data: string }) => void) {
      this.handlers.set(name, [...(this.handlers.get(name) ?? []), handler]);
    }
    emit(name: string, event = { data: "" }) {
      for (const handler of this.handlers.get(name) ?? []) handler(event);
    }
    message(type: string, id: string, event?: Record<string, unknown>, subscription_type?: string) {
      this.emit("message", { data: JSON.stringify({ metadata: { message_type: type, message_id: id,
        subscription_type }, payload: type === "session_welcome" ? { session: { id } } : { event } }) });
    }
    close() { if (this.readyState === 3) return; this.readyState = 3; this.emit("close"); }
  }
  const instances: FakeWebSocket[] = [];
  vi.stubGlobal("WebSocket", FakeWebSocket);
  const realFetch = globalThis.fetch;
  let failRefresh = false;
  vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
    const url = String(input);
    if (!url.startsWith("https://")) return realFetch(input, init);
    if (url === "https://id.twitch.tv/oauth2/token") {
      const params = new URLSearchParams(init?.body as URLSearchParams);
      if (params.get("grant_type") === "refresh_token" && failRefresh)
        return Promise.resolve(new Response("revoked", { status: 400 }));
      const code = params.get("code") ?? "a";
      return Promise.resolve(new Response(JSON.stringify({ access_token: `access-${code}`,
        refresh_token: `refresh-${code}`, expires_in: code === "expired" ? 1 : 3600 }), { headers: { "Content-Type": "application/json" } }));
    }
    if (url === "https://id.twitch.tv/oauth2/validate") {
      const token = String(new Headers(init?.headers).get("Authorization"));
      const id = token === "OAuth access-b" || token === "OAuth oauth-202" ? "202" : "101";
      return Promise.resolve(new Response(JSON.stringify({ client_id: config.twitchClientId, user_id: id,
        login: id === "101" ? "tts-a" : "tts-b", scopes: token.includes("oauth-")
          ? ["moderation:read", "user:read:moderated_channels"] : ["user:read:chat", "channel:manage:redemptions"] })));
    }
    if (url.includes("/eventsub/subscriptions")) return Promise.resolve(new Response(JSON.stringify({ data: [] })));
    if (url.includes("/channel_points/custom_rewards")) return Promise.resolve(new Response(JSON.stringify({ data: [{ id: "reward" }] })));
    throw new Error(`Unexpected Twitch request: ${url}`);
  });
  try {
    expect((await fetch(`${baseUrl}/api/tts/channels/${owners[0].channel.id}`, { headers: headers("tts-mod") })).status).toBe(403);
    expect((await fetch(`${baseUrl}/api/tts/channels/${owners[1].channel.id}`, { headers: headers("tts-a") })).status).toBe(404);
    expect((await fetch(`${baseUrl}/api/tts/channels/${owners[0].channel.id}/connect`, { headers: headers("tts-mod") })).status).toBe(403);
    expect((await fetch(`${baseUrl}/api/tts/channels/${owners[1].channel.id}/connect`, { headers: headers("tts-a") })).status).toBe(404);
    startTts(realtime);
    for (const [index, owner] of owners.entries()) {
      const start = await fetch(`${baseUrl}/api/tts/channels/${owner.channel.id}/connect`, { headers: headers(owner.token), redirect: "manual" });
      expect(start.status).toBe(302);
      const grant = new URL(start.headers.get("location")!);
      expect(grant.searchParams.get("scope")).toBe("user:read:chat channel:manage:redemptions");
      const cookie = start.headers.getSetCookie().find((value) => value.startsWith("mod_overlay_tts_state="))!.split(";")[0];
      if (index === 0) {
        const wrongSession = await fetch(`${baseUrl}/api/tts/callback?state=${grant.searchParams.get("state")}&code=a`,
          { headers: { ...headers("tts-b"), Cookie: `${headers("tts-b").Cookie}; ${cookie}` }, redirect: "manual" });
        expect(wrongSession.status).toBe(400);
      }
      const callback = await fetch(`${baseUrl}/api/tts/callback?state=${grant.searchParams.get("state")}&code=${index === 0 ? "a" : "b"}`,
        { headers: { ...headers(owner.token), Cookie: `${headers(owner.token).Cookie}; ${cookie}` }, redirect: "manual" });
      expect(callback.status).toBe(303);
      expect(callback.headers.get("location")).toBe("/streamer?tts=connected");
      expect((await fetch(`${baseUrl}/api/tts/callback?state=${grant.searchParams.get("state")}&code=${index === 0 ? "a" : "b"}`,
        { headers: { ...headers(owner.token), Cookie: `${headers(owner.token).Cookie}; ${cookie}` }, redirect: "manual" })).status).toBe(400);
      const stored = await prisma.settings.findUniqueOrThrow({ where: { key: `tts:twitch:${owner.channel.id}` } });
      expect(stored.value).not.toContain(`access-${index === 0 ? "a" : "b"}`);
      expect(JSON.stringify(await (await fetch(`${baseUrl}/api/tts/channels/${owner.channel.id}`, { headers: headers(owner.token) })).json())).not.toContain("refresh-");
    }
    await expect.poll(() => instances.length).toBe(2);
    instances[0].message("session_welcome", "session-a");
    instances[1].message("session_welcome", "session-b");
    await expect.poll(async () => (await (await fetch(`${baseUrl}/api/tts/channels/${owners[0].channel.id}`, { headers: headers("tts-a") })).json() as { ready: boolean }).ready).toBe(true);
    await expect.poll(async () => (await (await fetch(`${baseUrl}/api/tts/channels/${owners[1].channel.id}`, { headers: headers("tts-b") })).json() as { ready: boolean }).ready).toBe(true);
    expect((await fetch(`${baseUrl}/api/tts/channels/${owners[1].channel.id}/reward`, { method: "POST",
      headers: { ...headers("tts-a"), "Content-Type": "application/json" }, body: JSON.stringify({ cost: 999 }) })).status).toBe(404);
    for (const [index, owner] of owners.entries()) {
      expect((await fetch(`${baseUrl}/api/tts/channels/${owner.channel.id}/reward`, { method: "POST",
        headers: { ...headers(owner.token), "Content-Type": "application/json" },
        body: JSON.stringify({ cost: index === 0 ? 100 : 200 }) })).status).toBe(200);
    }
    expect((await (await fetch(`${baseUrl}/api/tts/channels/${owners[0].channel.id}`, { headers: headers("tts-a") })).json() as { rewardCost: number }).rewardCost).toBe(100);
    expect((await (await fetch(`${baseUrl}/api/tts/channels/${owners[1].channel.id}`, { headers: headers("tts-b") })).json() as { rewardCost: number }).rewardCost).toBe(200);
    const playA: Array<{ id: string; url: string }> = [];
    const playB: Array<{ id: string; url: string }> = [];
    overlayA.on("tts:play", (value) => playA.push(value));
    overlayB.on("tts:play", (value) => playB.push(value));
    const chat = (channel: 0 | 1, id: string, user: string, text: string) => instances[channel].message("notification", id,
      { broadcaster_user_id: owners[channel].twitchId, chatter_user_id: user,
        badges: [{ set_id: "moderator" }], message: { text: `!tts ${text}` } }, "channel.chat.message");
    chat(0, "a-1", "mod-a", "alpha");
    chat(1, "b-1", "mod-b", "beta");
    await expect.poll(() => playA.length).toBe(1);
    await expect.poll(() => playB.length).toBe(1);
    expect(await (await fetch(`${baseUrl}${playA[0].url}`)).text()).toBe("alpha");
    expect(await (await fetch(`${baseUrl}${playB[0].url}`)).text()).toBe("beta");
    instances[0].message("notification", "wrong-channel", { broadcaster_user_id: owners[1].twitchId,
      chatter_user_id: "mod-x", badges: [{ set_id: "moderator" }], message: { text: "!tts must-not-play" } },
    "channel.chat.message");
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect((await (await fetch(`${baseUrl}/api/tts/channels/${owners[0].channel.id}`, { headers: headers("tts-a") })).json() as { queueLength: number }).queueLength).toBe(0);
    for (let index = 0; index < 12; index++) chat(0, `queued-${index}`, `mod-${index}`, `queued-${index}`);
    await expect.poll(async () => (await (await fetch(`${baseUrl}/api/tts/channels/${owners[0].channel.id}`, { headers: headers("tts-a") })).json() as { queueLength: number }).queueLength).toBe(10);
    expect((await (await fetch(`${baseUrl}/api/tts/channels/${owners[1].channel.id}`, { headers: headers("tts-b") })).json() as { queueLength: number }).queueLength).toBe(0);
    const disable = await fetch(`${baseUrl}/api/tts/channels/${owners[0].channel.id}/enabled`, { method: "PUT",
      headers: { ...headers("tts-a"), "Content-Type": "application/json" }, body: JSON.stringify({ enabled: false }) });
    expect(disable.status).toBe(200);
    expect(instances[0].readyState).toBe(3);
    expect((await disable.json() as { queueLength: number }).queueLength).toBe(0);
    expect(instances[1].readyState).toBe(1);
    const expiredStart = await fetch(`${baseUrl}/api/tts/channels/${owners[0].channel.id}/connect`,
      { headers: headers("tts-a"), redirect: "manual" });
    const expiredState = new URL(expiredStart.headers.get("location")!).searchParams.get("state");
    const expiredCookie = expiredStart.headers.getSetCookie().find((value) => value.startsWith("mod_overlay_tts_state="))!.split(";")[0];
    const expiredCallback = await fetch(`${baseUrl}/api/tts/callback?state=${expiredState}&code=expired`,
      { headers: { ...headers("tts-a"), Cookie: `${headers("tts-a").Cookie}; ${expiredCookie}` }, redirect: "manual" });
    expect(expiredCallback.status).toBe(303);
    await expect.poll(() => instances.length).toBe(3);
    failRefresh = true;
    instances[2].message("session_welcome", "session-a-expired");
    await expect.poll(async () => (await (await fetch(`${baseUrl}/api/tts/channels/${owners[0].channel.id}`, { headers: headers("tts-a") })).json() as { connected: boolean }).connected).toBe(false);
    expect((await (await fetch(`${baseUrl}/api/tts/channels/${owners[1].channel.id}`, { headers: headers("tts-b") })).json() as { ready: boolean }).ready).toBe(true);
    failRefresh = false;
    overlayB.emit("tts:done", { id: playB[0].id });
    chat(1, "b-2", "mod-new", "still-running");
    await expect.poll(() => playB.length).toBe(2);
    instances[1].message("revocation", "revoked-b");
    await expect.poll(async () => (await (await fetch(`${baseUrl}/api/tts/channels/${owners[1].channel.id}`, { headers: headers("tts-b") })).json() as { connected: boolean }).connected).toBe(false);
    const revoked = await (await fetch(`${baseUrl}/api/tts/channels/${owners[1].channel.id}`, { headers: headers("tts-b") })).json() as { error: string };
    expect(revoked.error).toContain("revoked");
    const restoredStart = await fetch(`${baseUrl}/api/tts/channels/${owners[0].channel.id}/connect`,
      { headers: headers("tts-a"), redirect: "manual" });
    const restoredState = new URL(restoredStart.headers.get("location")!).searchParams.get("state");
    const restoredCookie = restoredStart.headers.getSetCookie().find((value) => value.startsWith("mod_overlay_tts_state="))!.split(";")[0];
    expect((await fetch(`${baseUrl}/api/tts/callback?state=${restoredState}&code=a`,
      { headers: { ...headers("tts-a"), Cookie: `${headers("tts-a").Cookie}; ${restoredCookie}` }, redirect: "manual" })).status).toBe(303);
    await expect.poll(() => instances.length).toBe(4);
    instances[3].message("session_welcome", "session-a-again");
    stopTts();
    startTts(realtime);
    await expect.poll(() => instances.length).toBe(5);
    instances[4].message("session_welcome", "session-a-restored");
    await expect.poll(async () => (await (await fetch(`${baseUrl}/api/tts/channels/${owners[0].channel.id}`, { headers: headers("tts-a") })).json() as { ready: boolean }).ready).toBe(true);
    expect(instances[1].readyState).toBe(3);
    expect((await (await fetch(`${baseUrl}/api/tts/channels/${owners[1].channel.id}`, { headers: headers("tts-b") })).json() as { ready: boolean }).ready).toBe(false);
  } finally {
    stopTts();
    vi.unstubAllGlobals();
    config.ttsPython = "";
    config.publicOrigin = "";
    config.twitchClientId = "";
    config.twitchClientSecret = "";
  }
});

it("resolves an eblo.id post server-side and checks the resolved media permission", async () => {
  await prisma.user.update({
    where: { id: moderatorId },
    data: {
      permissionsJson: JSON.stringify({
        canUploadImage: false,
        canUploadGif: false,
        canUploadVideo: false,
        canUploadAudio: false
      })
    }
  });
  const originalFetch = globalThis.fetch;
  const externalFetch = vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
    if (String(input) === "https://eblo.id/XRbi1j2") {
      return Promise.resolve(
        new Response(
          '<body data-media-type="image"><img id="preview-image" src="/uploads/XRbi1j2/photo.webp"></body>',
          { headers: { "content-type": "text/html" } }
        )
      );
    }
    return originalFetch(input, init);
  });
  const post = (token: string) =>
    originalFetch(`${baseUrl}/api/media/url`, {
      method: "POST",
      headers: { ...headers(token), "content-type": "application/json" },
      body: JSON.stringify({ url: "https://eblo.id/XRbi1j2" })
    });

  const denied = await post("mod-session");
  expect(denied.status).toBe(403);
  expect(externalFetch).not.toHaveBeenCalled();

  await prisma.user.update({
    where: { id: moderatorId },
    data: { permissionsJson: JSON.stringify({ canUploadImage: false, canUploadVideo: true }) }
  });
  const wrongTypePermission = await post("mod-session");
  expect(wrongTypePermission.status).toBe(403);
  expect(await prisma.media.count()).toBe(0);

  const added = await post("owner-session");
  expect(added.status).toBe(201);
  const result = (await added.json()) as { media: { url: string; type: string } };
  expect(result.media).toMatchObject({
    url: "https://eblo.id/uploads/XRbi1j2/photo.webp",
    type: "IMAGE"
  });
  expect(externalFetch).toHaveBeenCalledWith(
    "https://eblo.id/XRbi1j2",
    expect.objectContaining({ redirect: "manual" })
  );
});

describe("realtime access revocation", () => {
  it("changes canvas atomically for the Twitch owner and updates open editors and OBS", async () => {
    const realFetch = globalThis.fetch;
    vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => String(input) === "https://id.twitch.tv/oauth2/validate"
      ? Promise.resolve(new Response(JSON.stringify({ client_id: config.twitchClientId, user_id: "canvas-owner",
        scopes: ["moderation:read", "user:read:moderated_channels"] })))
      : realFetch(input, init));
    const owner = await prisma.user.create({ data: { username: "twitch:canvas-owner", displayName: "Canvas owner", passwordHash: "!", twitchUserId: "canvas-owner" } });
    await prisma.streamer.update({ where: { id: streamerId }, data: { ownerUserId: owner.id, twitchBroadcasterId: "canvas-owner" } });
    const { encryptOAuthToken } = await import("../src/server/channelAccess");
    await prisma.twitchOAuthConnection.create({ data: { userId: owner.id, mode: "unified", encryptedAccess: encryptOAuthToken("access"), encryptedRefresh: encryptOAuthToken("refresh"), scopesJson: "[]", expiresAt: new Date(Date.now() + 3600_000), checkedAt: new Date() } });
    await prisma.session.create({ data: { userId: owner.id, tokenHash: hashSessionToken("canvas-owner-session"), authMethod: "TWITCH", twitchMode: "unified", expiresAt: new Date(Date.now() + 3600_000) } });
    const preview = await prisma.previewElement.create({ data: { streamerId, type: "IMAGE", name: "Outside", x: -120, y: 100, width: 300, height: 200, rotation: 37, propsJson: JSON.stringify({ cropLeft: 20, cropRight: 10, cropTop: 5, cropBottom: 15 }) } });
    const live = await prisma.liveInstance.create({ data: { streamerId, type: "IMAGE", name: "Live", x: 1600, y: 900, width: 200, height: 100, rotation: -20, propsJson: JSON.stringify({ cropLeft: 10 }) } });
    const editorA = await socketClient({ session: "owner-session" });
    const editorB = await socketClient({ session: "mod-session" });
    const overlay = await socketClient({ overlayToken: "overlay-old" }, "overlay:state");
    const authHeaders = { ...headers("canvas-owner-session"), "Content-Type": "application/json", "X-Channel-Id": streamerId };
    const read = async () => (await (await fetch(`${baseUrl}/api/auth/me`, { headers: authHeaders })).json()) as { streamer: { canvasRevision: string; canvasWidth: number; canvasHeight: number } };
    const initial = (await read()).streamer;
    const save = (width: number, height: number, mode: string, revision: string, requestHeaders = authHeaders) => fetch(`${baseUrl}/api/channels/${streamerId}/canvas`, { method: "PUT", headers: requestHeaders, body: JSON.stringify({ width, height, mode, expectedRevision: revision }) });
    expect((await save(2560, 1440, "scale", initial.canvasRevision, { ...headers("mod-session"), "Content-Type": "application/json", "X-Channel-Id": streamerId })).status).toBe(403);
    expect((await save(2560, 1440, "scale", initial.canvasRevision, { ...authHeaders, "X-Channel-Id": "foreign" })).status).toBe(403);
    for (const [width, height] of [[0, 1080], [1920.5, 1080], [9000, 1080], [300, 300], [7680, 320]]) {
      expect((await save(width, height, "keep", initial.canvasRevision)).status).toBe(400);
    }
    const aResize = event<{ canvasWidth: number; canvasHeight: number }>(editorA, "canvas:state");
    const bResize = event<{ canvasWidth: number; canvasHeight: number }>(editorB, "canvas:state");
    const obsResize = event<{ canvasWidth: number; canvasHeight: number }>(overlay, "canvas:state");
    const canonical = event<Array<{ id: string; x: number }>>(overlay, "overlay:state");
    expect((await save(2560, 1440, "scale", initial.canvasRevision)).status).toBe(200);
    expect(await aResize).toMatchObject({ canvasWidth: 2560, canvasHeight: 1440 });
    expect(await bResize).toMatchObject({ canvasWidth: 2560, canvasHeight: 1440 });
    expect(await obsResize).toMatchObject({ canvasWidth: 2560, canvasHeight: 1440 });
    expect((await canonical).find((item) => item.id === preview.id)?.x).toBe(-160);
    const stale = event<string>(editorA, "app:error");
    editorA.emit("preview:update", { id: preview.id, patch: { x: 999 } });
    expect(await stale).toContain("Canvas resolution changed");
    const scaled = await prisma.previewElement.findUniqueOrThrow({ where: { id: preview.id } });
    expect(scaled).toMatchObject({ x: -160, width: 400, rotation: 37 });
    expect(scaled.y).toBeCloseTo(133.33333333333331);
    const crop = JSON.parse(scaled.propsJson) as { cropLeft: number; cropTop: number };
    expect(crop.cropLeft).toBeCloseTo(26.666666666666664);
    expect(crop.cropTop).toBeCloseTo(6.666666666666666);
    expect((await prisma.liveInstance.findUniqueOrThrow({ where: { id: live.id } })).x).toBeCloseTo(2133.333333333333);
    expect((await save(2560, 1440, "scale", initial.canvasRevision)).status).toBe(409);
    const beforeRename = (await read()).streamer.canvasRevision;
    await prisma.streamer.update({ where: { id: streamerId }, data: { displayName: "Renamed" } });
    const second = (await read()).streamer;
    expect(second.canvasRevision).toBe(beforeRename);
    expect((await save(1080, 1920, "keep", second.canvasRevision)).status).toBe(200);
    expect((await prisma.previewElement.findUniqueOrThrow({ where: { id: preview.id } })).x).toBe(-160);
    const third = (await read()).streamer;
    expect((await save(1920, 1080, "keep", third.canvasRevision)).status).toBe(200);
    const fourth = (await read()).streamer;
    expect((await save(1080, 1920, "scale", fourth.canvasRevision)).status).toBe(200);
    const portrait = await prisma.previewElement.findUniqueOrThrow({ where: { id: preview.id } });
    expect(portrait.x).toBeCloseTo(-160 * 1080 / 1920);
    expect(portrait.y).toBeCloseTo(scaled.y * 1920 / 1080);
    expect(portrait.rotation).toBe(37);
    const fifth = (await read()).streamer;
    expect((await save(1000, 1500, "scale", fifth.canvasRevision)).status).toBe(200);
    expect((await read()).streamer).toMatchObject({ canvasWidth: 1000, canvasHeight: 1500 });
    const obsSetup = await fetch(`${baseUrl}/api/obs`, { headers: authHeaders });
    expect(await obsSetup.json()).toMatchObject({ canvasWidth: 1000, canvasHeight: 1500 });
    await prisma.previewElement.create({ data: { streamerId, type: "TEXT", name: "Tiny", width: 8, height: 8 } });
    const beforeRejected = await prisma.previewElement.findUniqueOrThrow({ where: { id: preview.id } });
    expect((await save(320, 480, "scale", (await read()).streamer.canvasRevision)).status).toBe(422);
    expect((await read()).streamer).toMatchObject({ canvasWidth: 1000, canvasHeight: 1500 });
    expect((await prisma.previewElement.findUniqueOrThrow({ where: { id: preview.id } })).x).toBe(beforeRejected.x);
    expect((await prisma.streamer.findUniqueOrThrow({ where: { id: streamerId } })).overlayToken).toBe("overlay-old");
  });
  it("isolates Twitch and 7TV failures while keeping custom emotes", async () => {
    const streamer = await prisma.streamer.update({
      where: { id: streamerId },
      data: { twitchLogin: "example", twitchBroadcasterId: "12345" }
    });
    await prisma.customEmote.create({
      data: {
        streamerId,
        provider: "custom",
        name: "Saved",
        sourceUrl: "https://example.com/saved.png",
        previewUrl: "https://example.com/saved.png"
      }
    });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      if (String(input).startsWith("https://7tv.io/"))
        return new Response(
          JSON.stringify({
            emote_set: {
              emotes: [
                {
                  id: "a",
                  name: "Alias",
                  data: {
                    animated: true,
                    host: {
                      url: "//cdn.7tv.app/emote/01ABCDEF0123456789ABCDEF01",
                      files: [
                        { name: "1x.webp", width: 32, height: 32 },
                        { name: "4x.webp", width: 128, height: 128 }
                      ]
                    }
                  }
                }
              ]
            }
          }),
          { status: 200 }
        );
      return new Response("Unavailable", { status: 503 });
    });
    const result = await getChannelEmotes(streamer);
    expect(result.twitch).toEqual([]);
    expect(result.errors.twitch).toBeTruthy();
    expect(result.sevenTv).toMatchObject([{ name: "Alias", animated: true }]);
    expect(result.custom).toMatchObject([{ name: "Saved" }]);
    fetchMock.mockRestore();
  });

  it("keeps Twitch emotes when 7TV is unavailable", async () => {
    const streamer = await prisma.streamer.update({
      where: { id: streamerId },
      data: { twitchLogin: "example", twitchBroadcasterId: "67890" }
    });
    config.twitchClientId = "test-client";
    config.twitchClientSecret = "test-secret";
    const providerFetch = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("oauth2/token"))
        return new Response(JSON.stringify({ access_token: "test-token", expires_in: 3600 }), {
          status: 200
        });
      if (url.includes("/helix/chat/emotes?"))
        return new Response(
          JSON.stringify({
            template:
              "https://static-cdn.jtvnw.net/emoticons/v2/{{id}}/{{format}}/{{theme_mode}}/{{scale}}",
            data: [
              {
                id: "1",
                name: "Wave",
                format: ["animated"],
                scale: ["1.0", "3.0"],
                theme_mode: ["dark"]
              }
            ]
          }),
          { status: 200 }
        );
      return new Response("Unavailable", { status: 503 });
    });
    const result = await getChannelEmotes(streamer);
    expect(result.twitch).toMatchObject([{ name: "Wave", animated: true }]);
    expect(result.sevenTv).toEqual([]);
    expect(result.errors.sevenTv).toBeTruthy();
    await getChannelEmotes(streamer);
    expect(
      providerFetch.mock.calls.filter(([input]) => String(input).includes("/helix/chat/emotes?"))
    ).toHaveLength(1);
    await getChannelEmotes(streamer, true);
    expect(
      providerFetch.mock.calls.filter(([input]) => String(input).includes("/helix/chat/emotes?"))
    ).toHaveLength(2);
    config.twitchClientId = "";
    config.twitchClientSecret = "";
  });
  it("stores custom emotes per streamer and adds them only to SPAWN without using uploads", async () => {
    for (const url of [
      "javascript:alert(1)",
      "data:image/png;base64,AA==",
      "file:///tmp/emote.png",
      "http://example.com/emote.png"
    ]) {
      const invalid = await fetch(`${baseUrl}/api/emotes/custom`, {
        method: "POST",
        headers: { ...headers(), "Content-Type": "application/json" },
        body: JSON.stringify({ url })
      });
      expect(invalid.status).toBe(400);
    }
    await prisma.user.update({
      where: { id: moderatorId },
      data: { permissionsJson: JSON.stringify({ canUploadImage: false }) }
    });
    const forbidden = await fetch(`${baseUrl}/api/emotes/custom`, {
      method: "POST",
      headers: { ...headers("mod-session"), "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://example.com/emote.gif" })
    });
    expect(forbidden.status).toBe(403);
    const created = await fetch(`${baseUrl}/api/emotes/custom`, {
      method: "POST",
      headers: { ...headers(), "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://example.com/emote.gif", name: "Wave" })
    });
    expect(created.status).toBe(201);
    const { emote } = (await created.json()) as { emote: { id: string } };
    expect(await files()).toEqual([]);
    expect(
      (await prisma.media.aggregate({ where: { streamerId }, _sum: { size: true } }))._sum.size
    ).toBeNull();
    const second = await prisma.streamer.create({
      data: { displayName: "Second", overlayToken: "second-overlay" }
    });
    expect(await prisma.customEmote.count({ where: { streamerId: second.id } })).toBe(0);

    const socket = await socketClient({ session: "owner-session" });
    const state = event<
      Array<{ id: string; x: number; width: number; height: number; src: string }>
    >(socket, "preview:state");
    socket.emit("preview:add", { emoteProvider: "custom", emoteId: emote.id });
    const added = (await state)[0];
    expect(added).toMatchObject({
      x: -256,
      width: 200,
      height: 200,
      src: "https://example.com/emote.gif"
    });
    expect(await prisma.liveInstance.count({ where: { streamerId } })).toBe(0);
    const removed = await fetch(`${baseUrl}/api/emotes/custom/${emote.id}`, {
      method: "DELETE",
      headers: headers()
    });
    expect(removed.status).toBe(200);
    expect(await prisma.customEmote.count({ where: { streamerId } })).toBe(0);
    expect(await prisma.previewElement.count({ where: { streamerId } })).toBe(1);
  });
  it("relays transient geometry without a write and restores committed geometry on reconnect", async () => {
    const element = await prisma.previewElement.create({
      data: { streamerId, type: "TEXT", name: "drag", text: "drag" }
    });
    const moderator = await socketClient({ session: "owner-session" });
    const overlay = await socketClient({ overlayToken: "overlay-old" }, "overlay:state");
    const moving = event<{ id: string; x: number }>(overlay, "overlay:transform");
    moderator.emit("preview:transform", { id: element.id, x: 900 });
    expect(await moving).toMatchObject({ id: element.id, x: 900 });
    expect((await prisma.previewElement.findUniqueOrThrow({ where: { id: element.id } })).x).toBe(
      100
    );

    const canonical = event<Array<{ id: string; x: number }>>(overlay, "overlay:state");
    expect(
      await moderator.timeout(3000).emitWithAck("preview:update", {
        id: element.id,
        patch: { x: 900 }
      })
    ).toBe(true);
    expect((await canonical).find((item) => item.id === element.id)?.x).toBe(900);
    expect((await prisma.previewElement.findUniqueOrThrow({ where: { id: element.id } })).x).toBe(
      900
    );

    const reconnected = connect(baseUrl, {
      transports: ["websocket"],
      reconnection: false,
      autoConnect: false,
      query: { overlayToken: "overlay-old" }
    });
    clients.push(reconnected);
    const restored = event<Array<{ id: string; x: number }>>(reconnected, "overlay:state");
    reconnected.connect();
    expect((await restored).find((item) => item.id === element.id)?.x).toBe(900);
  });

  it("keeps cropped resize identical in preview, OBS, and persisted state", async () => {
    const element = await prisma.previewElement.create({
      data: {
        streamerId,
        type: "IMAGE",
        name: "crop",
        width: 200,
        height: 100,
        propsJson: JSON.stringify({ cropLeft: 50, cropTop: 25 })
      }
    });
    const moderator = await socketClient({ session: "owner-session" });
    const overlay = await socketClient({ overlayToken: "overlay-old" }, "overlay:state");
    const crop = { left: 100, right: 0, top: 50, bottom: 0 };
    const moving = event<{ width: number; height: number; crop: typeof crop }>(
      overlay,
      "overlay:transform"
    );
    moderator.emit("preview:transform", { id: element.id, width: 400, height: 200, crop });
    expect(await moving).toMatchObject({ id: element.id, width: 400, height: 200, crop });
    expect(
      await prisma.previewElement.findUniqueOrThrow({ where: { id: element.id } })
    ).toMatchObject({
      width: 200,
      height: 100,
      propsJson: JSON.stringify({ cropLeft: 50, cropTop: 25 })
    });

    const previewState = event<
      Array<{ id: string; width: number; props: Record<string, unknown> }>
    >(moderator, "preview:state");
    const overlayState = event<
      Array<{ id: string; width: number; props: Record<string, unknown> }>
    >(overlay, "overlay:state");
    expect(
      await moderator.timeout(3000).emitWithAck("preview:update", {
        id: element.id,
        patch: {
          width: 400,
          height: 200,
          props: { cropLeft: 100, cropRight: 0, cropTop: 50, cropBottom: 0 }
        }
      })
    ).toBe(true);
    const preview = (await previewState).find((item) => item.id === element.id);
    const obs = (await overlayState).find((item) => item.id === element.id);
    expect(preview).toMatchObject({ width: 400, props: { cropLeft: 100, cropTop: 50 } });
    expect(obs).toEqual(preview);
    expect(
      await prisma.previewElement.findUniqueOrThrow({ where: { id: element.id } })
    ).toMatchObject({
      width: 400,
      height: 200
    });
    const reconnected = connect(baseUrl, {
      transports: ["websocket"],
      reconnection: false,
      autoConnect: false,
      query: { overlayToken: "overlay-old" }
    });
    clients.push(reconnected);
    const restored = event<Array<{ id: string; width: number; props: Record<string, unknown> }>>(
      reconnected,
      "overlay:state"
    );
    reconnected.connect();
    expect((await restored).find((item) => item.id === element.id)).toEqual(obs);
  });

  it("rejects unauthorized, unknown, and invalid transforms", async () => {
    const element = await prisma.previewElement.create({
      data: { streamerId, type: "TEXT", name: "drag", text: "drag" }
    });
    const denied = await socketClient({ session: "mod-session" });
    const owner = await socketClient({ session: "owner-session" });
    const overlay = await socketClient({ overlayToken: "overlay-old" }, "overlay:state");
    for (const [socket, payload, message] of [
      [denied, { id: element.id, x: 4 }, "Permission denied"],
      [owner, { id: "unknown", x: 4 }, "Element not found"],
      [owner, { id: element.id, x: 4, props: { playbackCommand: "play" } }, "Unrecognized key"]
    ] as const) {
      const failure = event<string>(socket, "app:error");
      socket.emit("preview:transform", payload);
      expect(await failure).toContain(message);
    }
    expect((await prisma.previewElement.findUniqueOrThrow({ where: { id: element.id } })).x).toBe(
      100
    );
    expect(overlay.connected).toBe(true);
  });

  it("allows normal transform bursts and caps a flood", async () => {
    const element = await prisma.previewElement.create({
      data: { streamerId, type: "TEXT", name: "drag", text: "drag" }
    });
    const moderator = await socketClient({ session: "owner-session" });
    const overlay = await socketClient({ overlayToken: "overlay-old" }, "overlay:state");
    let received = 0;
    overlay.on("overlay:transform", () => {
      received += 1;
    });
    for (let x = 0; x < 60; x += 1) {
      moderator.emit("preview:transform", { id: element.id, x });
      await new Promise((resolve) => setTimeout(resolve, 16));
    }
    await expect.poll(() => received).toBeGreaterThanOrEqual(50);
    const beforeFlood = received;
    for (let x = 60; x < 260; x += 1) moderator.emit("preview:transform", { id: element.id, x });
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(received).toBeLessThanOrEqual(beforeFlood + 120);
    expect((await prisma.previewElement.findUniqueOrThrow({ where: { id: element.id } })).x).toBe(
      100
    );
  });
  it("logout disconnects every socket for that session, but preserves another session", async () => {
    await addSession(ownerId, "other-session");
    const first = await socketClient({ session: "owner-session" });
    const second = await socketClient({ session: "owner-session" });
    const other = await socketClient({ session: "other-session" });
    const disconnected = [event(first, "disconnect"), event(second, "disconnect")];
    const response = await fetch(`${baseUrl}/api/auth/logout`, {
      method: "POST",
      headers: headers()
    });
    expect(response.status).toBe(200);
    await Promise.all(disconnected);
    expect(other.connected).toBe(true);
    await socketClient({ session: "owner-session" }, "connect_error");
    expect(await prisma.session.count()).toBe(2);
  });

  it("rotation disconnects old overlays and rejects their reconnects", async () => {
    const overlay = await socketClient({ overlayToken: "overlay-old" }, "overlay:state");
    const disconnected = event(overlay, "disconnect");
    const response = await fetch(`${baseUrl}/api/obs/regenerate`, {
      method: "POST",
      headers: headers()
    });
    expect(response.status).toBe(200);
    await disconnected;
    await socketClient({ overlayToken: "overlay-old" }, "connect_error");
    const streamer = await prisma.streamer.findUniqueOrThrow({ where: { id: streamerId } });
    expect(
      (await socketClient({ overlayToken: streamer.overlayToken }, "overlay:state")).connected
    ).toBe(true);
  });

  it("expires an idle socket without waiting for its next action", async () => {
    await addSession(ownerId, "short-session", new Date(Date.now() + 1200));
    const socket = await socketClient({ session: "short-session" });
    await event(socket, "disconnect");
    expect(socket.connected).toBe(false);
  });

  it("checks deleted sessions again before mutations", async () => {
    const socket = await socketClient({ session: "owner-session" });
    await prisma.session.deleteMany({ where: { tokenHash: hashSessionToken("owner-session") } });
    const disconnected = event(socket, "disconnect");
    socket.emit("preview:add", { type: "TEXT", text: "forbidden" });
    await disconnected;
    expect(await prisma.previewElement.count()).toBe(0);
  });

  it("requires live rights for every canvas mutation and refreshes changed permissions", async () => {
    const element = await prisma.previewElement.create({
      data: { streamerId, type: "TEXT", name: "original", text: "original" }
    });
    const socket = await socketClient({ session: "mod-session" });
    for (const [name, payload] of [
      ["preview:add", { type: "TEXT", text: "forbidden" }],
      ["preview:update", { id: element.id, patch: { x: 999, props: { playbackCommand: "play" } } }],
      ["preview:duplicate", { id: element.id }],
      ["preview:remove", { id: element.id }]
    ] as const) {
      const denied = event(socket, "app:error");
      socket.emit(name, payload);
      expect(await denied).toBe("Permission denied");
    }
    expect(await prisma.previewElement.count()).toBe(1);
    expect((await prisma.previewElement.findUniqueOrThrow({ where: { id: element.id } })).x).toBe(
      100
    );
    await prisma.user.update({ where: { id: moderatorId }, data: { permissionsJson: "{}" } });
    const ok = await socket
      .timeout(3000)
      .emitWithAck("preview:update", { id: element.id, patch: { x: 222 } });
    expect(ok).toBe(true);
    await prisma.user.update({
      where: { id: moderatorId },
      data: { permissionsJson: '{"canPushLive":false}' }
    });
    expect(
      await socket
        .timeout(3000)
        .emitWithAck("preview:update", { id: element.id, patch: { x: 333 } })
    ).toBe(false);
    expect((await prisma.previewElement.findUniqueOrThrow({ where: { id: element.id } })).x).toBe(
      222
    );
  });
});

describe("protected uploads", () => {
  it("requires credentials for GET/HEAD/Range, accepts OBS tokens and revokes them", async () => {
    const result = await upload();
    expect(result.status).toBe(201);
    const { media } = (await result.json()) as { media: { url: string } };
    for (const method of ["GET", "HEAD"]) {
      expect((await fetch(baseUrl + media.url, { method })).status).toBe(401);
    }
    expect((await fetch(baseUrl + media.url, { headers: { Range: "bytes=0-7" } })).status).toBe(
      401
    );
    const moderator = await fetch(baseUrl + media.url, { headers: headers("mod-session") });
    expect(moderator.status).toBe(200);
    expect(moderator.headers.get("cache-control")).toBe("private, no-store");
    const url = `${baseUrl}${media.url}?overlayToken=overlay-old`;
    const partial = await fetch(url, { headers: { Range: "bytes=0-7" } });
    expect(partial.status).toBe(206);
    expect(Buffer.from(await partial.arrayBuffer())).toEqual(png.subarray(0, 8));
    expect((await fetch(url, { method: "HEAD" })).status).toBe(200);
    await fetch(`${baseUrl}/api/obs/regenerate`, { method: "POST", headers: headers() });
    expect((await fetch(url)).status).toBe(401);
    await fetch(`${baseUrl}/api/auth/logout`, { method: "POST", headers: headers("mod-session") });
    expect((await fetch(baseUrl + media.url, { headers: headers("mod-session") })).status).toBe(
      401
    );
  });

  it("does not authorize another streamer's files or unregistered disk files", async () => {
    const result = await upload();
    const { media } = (await result.json()) as { media: { url: string } };
    await prisma.streamer.create({ data: { displayName: "Other", overlayToken: "other-overlay" } });
    expect((await fetch(`${baseUrl}${media.url}?overlayToken=other-overlay`)).status).toBe(404);
    await fs.writeFile(path.join(config.uploadDir, "orphan.png"), png);
    expect((await fetch(`${baseUrl}/uploads/orphan.png`, { headers: headers() })).status).toBe(404);
  });

  it("keeps concurrent uploads inside the quota and removes rejected files", async () => {
    config.maxTotalUploadSize = png.length;
    const results = await Promise.all([upload(), upload(), upload(), upload()]);
    expect(results.map((response) => response.status).sort()).toEqual([201, 413, 413, 413]);
    expect(await prisma.media.count()).toBe(1);
    expect((await prisma.media.aggregate({ _sum: { size: true } }))._sum.size).toBe(png.length);
    await expect.poll(async () => (await files()).length).toBe(1);
    expect(await fs.readdir(path.join(config.uploadDir, ".tmp"))).toEqual([]);
  });

  it("rolls back media and cleans files when the audit write fails", async () => {
    // Force a real database error after the media insert, inside the transaction.
    await prisma.$executeRawUnsafe(`CREATE TRIGGER fail_upload_audit BEFORE INSERT ON AuditLog
      WHEN NEW.action = 'media.uploaded' BEGIN SELECT RAISE(ABORT, 'test audit failure'); END;`);
    try {
      expect((await upload()).status).toBe(400);
      expect(await prisma.media.count()).toBe(0);
      await expect.poll(files).toEqual([]);
    } finally {
      await prisma.$executeRawUnsafe("DROP TRIGGER fail_upload_audit");
    }
  });

  it("cleans invalid, oversized and forbidden uploads", async () => {
    expect((await upload("owner-session", Buffer.from("not a png"))).status).toBe(400);
    expect((await upload("owner-session", Buffer.alloc(2048))).status).toBe(400);
    await prisma.user.update({
      where: { id: moderatorId },
      data: { permissionsJson: '{"canUploadImage":false}' }
    });
    expect((await upload("mod-session")).status).toBe(403);
    await expect.poll(files).toEqual([]);
    expect(await prisma.media.count()).toBe(0);
  });
});

describe("login throttling", () => {
  it("does not reset account or IP limits when forwarded addresses change", async () => {
    const statuses: number[] = [];
    for (let index = 0; index < 31; index++) {
      const response = await fetch(`${baseUrl}/api/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": `203.0.113.${index}` },
        body: JSON.stringify({
          username: index < 9 ? "missing-account" : `missing-${index}`,
          password: "wrong-password"
        })
      });
      statuses.push(response.status);
    }
    expect(statuses.slice(0, 8)).toEqual(Array(8).fill(401));
    expect(statuses[8]).toBe(429);
    expect(statuses[29]).toBe(401);
    expect(statuses[30]).toBe(429);
  });
});
