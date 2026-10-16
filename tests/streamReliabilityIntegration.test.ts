import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import express from "express";
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { io as connect, type Socket } from "socket.io-client";
import type { Server } from "socket.io";

const fixture = await vi.hoisted(async () => {
  const fs = await import("node:fs/promises");
  const os = await import("node:os");
  const path = await import("node:path");
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "modoverlay-reliability-"));
  if (!path.isAbsolute(root) || !path.basename(root).startsWith("modoverlay-reliability-")) {
    throw new Error("Unsafe reliability test directory");
  }
  return { root, databaseUrl: `file:${path.join(root, "test.db").replaceAll("\\", "/")}` };
});

vi.mock("../src/server/db", async () => {
  if (!fixture.databaseUrl.startsWith(`file:${fixture.root.replaceAll("\\", "/")}/`)) {
    throw new Error("Refusing to use a database outside the reliability fixture");
  }
  const { PrismaClient } = await import("@prisma/client");
  return { prisma: new PrismaClient({ datasourceUrl: fixture.databaseUrl }) };
});
vi.mock("../src/server/config", () => ({
  isProduction: false,
  config: {
    projectRoot: fixture.root, nodeEnv: "test", port: 0, domain: "", publicOrigin: "",
    sessionSecret: "isolated-reliability-test-secret-at-least-32-characters",
    uploadDir: `${fixture.root}/uploads`,
    maxImageSize: 1024, maxGifSize: 1024, maxVideoSize: 1024, maxAudioSize: 1024,
    maxTotalUploadSize: 10240, minFreeDiskBytes: 512 * 1024 * 1024,
    originAllowlist: [], initialAdminUsername: "owner", initialAdminPassword: "",
    twitchClientId: "reliability-client", twitchClientSecret: "reliability-secret",
    twitchOAuthRedirectUri: "", oauthTokenEncryptionKey: "1".repeat(64), ttsEnabled: false
  }
}));

import { prisma } from "../src/server/db";
import { config } from "../src/server/config";
import { hashSessionToken, sessionCookieName } from "../src/server/auth";
import { encryptOAuthToken } from "../src/server/channelAccess";
import { configureSocket } from "../src/server/socket";
import { accessRevocation } from "../src/server/accessRevocation";

let baseUrl: string;
let realtime: Server;
let server: http.Server;
let streamerId: string;
const clients: Socket[] = [];

function event<T>(socket: Socket, name: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(name, listener);
      reject(new Error(`Timeout waiting for ${name}`));
    }, 4000);
    const listener = (payload: T) => { clearTimeout(timer); resolve(payload); };
    socket.once(name, listener);
  });
}

async function addSession(userId: string, token: string): Promise<void> {
  await prisma.session.create({ data: {
    userId, tokenHash: hashSessionToken(token), authMethod: "TWITCH", twitchMode: "unified",
    expiresAt: new Date(Date.now() + 60_000)
  } });
}

async function socketClient(
  options: { session?: string; overlayToken?: string; channelId?: string },
  expected = "live:state"
): Promise<Socket> {
  const socket = connect(baseUrl, {
    transports: ["websocket"], reconnection: false, autoConnect: false,
    extraHeaders: options.session ? { Cookie: `${sessionCookieName}=${options.session}` } : undefined,
    query: options.overlayToken ? { overlayToken: options.overlayToken } : { channelId: options.channelId }
  });
  clients.push(socket);
  const ready = event(socket, expected);
  socket.connect();
  await ready;
  return socket;
}

beforeAll(async () => {
  await fs.writeFile(path.join(fixture.root, "test.db"), "", { flag: "wx" });
  await promisify(execFile)(process.execPath, [
    path.resolve("node_modules/prisma/build/index.js"), "db", "push", "--skip-generate",
    "--schema", path.resolve("prisma/schema.prisma")
  ], { env: { ...process.env, DATABASE_URL: fixture.databaseUrl }, timeout: 25000 });
  const databases = await prisma.$queryRawUnsafe<Array<{ file: string }>>("PRAGMA database_list");
  if (databases.length !== 1 || path.resolve(databases[0].file) !== path.join(fixture.root, "test.db")) {
    throw new Error("Refusing to run against a database outside the reliability fixture");
  }
  await fs.mkdir(path.join(config.uploadDir, ".tmp"), { recursive: true });
  server = http.createServer(express());
  realtime = configureSocket(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as import("node:net").AddressInfo).port}`;
}, 30000);

beforeEach(async () => {
  const databases = await prisma.$queryRawUnsafe<Array<{ file: string }>>("PRAGMA database_list");
  if (databases.length !== 1 || path.resolve(databases[0].file) !== path.join(fixture.root, "test.db")) {
    throw new Error("Refusing to reset a database outside the reliability fixture");
  }
  await prisma.streamer.deleteMany();
  await prisma.user.deleteMany();
  const user = await prisma.user.create({ data: {
    username: "twitch:90001", displayName: "Owner", passwordHash: "!", twitchUserId: "90001"
  } });
  await prisma.twitchOAuthConnection.create({ data: {
    userId: user.id, mode: "unified", encryptedAccess: encryptOAuthToken("fixture-90001"),
    encryptedRefresh: encryptOAuthToken("refresh-90001"),
    scopesJson: JSON.stringify(["moderation:read", "user:read:moderated_channels"]),
    expiresAt: new Date(Date.now() + 3600_000), checkedAt: new Date()
  } });
  await addSession(user.id, "owner-session");
  streamerId = (await prisma.streamer.create({ data: {
    displayName: "Base", overlayToken: "overlay-old", ownerUserId: user.id,
    twitchBroadcasterId: "90001"
  } })).id;
  const realFetch = globalThis.fetch;
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input) === "https://id.twitch.tv/oauth2/validate") {
      const token = new Headers(init?.headers).get("Authorization")?.replace("OAuth fixture-", "");
      if (token === "90001") return Promise.resolve(new Response(JSON.stringify({
        client_id: config.twitchClientId, user_id: token,
        scopes: ["moderation:read", "user:read:moderated_channels"]
      })));
    }
    return realFetch(input, init);
  });
});

afterEach(async () => {
  vi.unstubAllGlobals();
  for (const socket of clients.splice(0)) socket.disconnect();
  realtime.disconnectSockets(true);
  await expect.poll(() => accessRevocation.listenerCount("session")).toBe(0);
});

afterAll(async () => {
  if (realtime) await new Promise<void>((resolve) => realtime.close(() => resolve()));
  await prisma.$disconnect();
  await fs.rm(fixture.root, { recursive: true, force: true });
});

it.each([2, 3, 5])("keeps %i active channels isolated through concurrent edits and OBS reconnects", async (count) => {
  const channels = [{ id: streamerId, overlayToken: "overlay-old", session: "owner-session" }];
  const fixtureFetch = globalThis.fetch;
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input) === "https://id.twitch.tv/oauth2/validate") {
      const token = new Headers(init?.headers).get("Authorization")?.replace("OAuth fixture-", "");
      if (token?.startsWith("reliability-")) {
        return Promise.resolve(new Response(JSON.stringify({
          client_id: config.twitchClientId, user_id: token,
          scopes: ["moderation:read", "user:read:moderated_channels"]
        })));
      }
    }
    return fixtureFetch(input, init);
  });
  for (let index = 1; index < count; index += 1) {
    const twitchId = `reliability-${count}-${index}`;
    const user = await prisma.user.create({ data: {
      username: `twitch:${twitchId}`, displayName: twitchId, passwordHash: "!", twitchUserId: twitchId
    } });
    await prisma.twitchOAuthConnection.create({ data: {
      userId: user.id, mode: "unified", encryptedAccess: encryptOAuthToken(`fixture-${twitchId}`),
      encryptedRefresh: encryptOAuthToken(`refresh-${twitchId}`),
      scopesJson: JSON.stringify(["moderation:read", "user:read:moderated_channels"]),
      expiresAt: new Date(Date.now() + 3600_000), checkedAt: new Date()
    } });
    const session = `reliability-session-${count}-${index}`;
    await addSession(user.id, session);
    const overlayToken = `reliability-overlay-${count}-${index}`;
    const channel = await prisma.streamer.create({ data: {
      displayName: twitchId, overlayToken, ownerUserId: user.id, twitchBroadcasterId: twitchId
    } });
    channels.push({ id: channel.id, overlayToken, session });
  }

  const overlays = await Promise.all(channels.map((channel) =>
    socketClient({ overlayToken: channel.overlayToken }, "overlay:state")
  ));
  const editors = await Promise.all(channels.map((channel) =>
    socketClient({ session: channel.session, channelId: channel.id })
  ));
  let errorCount = 0;
  editors.forEach((editor) => editor.on("app:error", () => { errorCount += 1; }));
  const cpuStart = process.cpuUsage();
  const editStart = performance.now();
  const updates = overlays.map((overlay) => event<Array<{ text: string }>>(overlay, "overlay:state"));
  editors.forEach((editor, index) => editor.emit("preview:add", { type: "TEXT", text: `channel-${index}` }));
  const states = await Promise.all(updates);
  const editLatencyMs = Math.round(performance.now() - editStart);
  states.forEach((state, index) => expect(state.map((item) => item.text)).toEqual([`channel-${index}`]));
  for (const [index, channel] of channels.entries()) {
    expect((await prisma.previewElement.findMany({ where: { streamerId: channel.id } })).map((item) => item.text))
      .toEqual([`channel-${index}`]);
  }

  const secondOverlay = await socketClient({ overlayToken: channels[0].overlayToken }, "overlay:state");
  const presence = new Promise<{ overlayCount: number; overlayConnected: boolean }>((resolve) => {
    const onPresence = (value: { overlayCount: number; overlayConnected: boolean }) => {
      if (value.overlayCount !== 1) return;
      editors[0].off("presence:update", onPresence);
      resolve(value);
    };
    editors[0].on("presence:update", onPresence);
  });
  overlays[0].disconnect();
  expect(await presence).toMatchObject({ overlayCount: 1, overlayConnected: true });
  expect(secondOverlay.connected).toBe(true);
  expect(editors.slice(1).every((editor) => editor.connected)).toBe(true);
  const element = await prisma.previewElement.findFirstOrThrow({ where: { streamerId: channels[0].id } });
  const changed = event<Array<{ x: number }>>(secondOverlay, "overlay:state");
  editors[0].emit("preview:update", { id: element.id, patch: { x: 777 } });
  expect((await changed)[0].x).toBe(777);
  const replacement = connect(baseUrl, {
    transports: ["websocket"], reconnection: false, autoConnect: false,
    query: { overlayToken: channels[0].overlayToken }
  });
  clients.push(replacement);
  let reconnectErrors = 0;
  replacement.on("connect_error", () => { reconnectErrors += 1; });
  const recoveryStart = performance.now();
  const restored = event<Array<{ x: number }>>(replacement, "overlay:state");
  replacement.connect();
  expect((await restored)[0].x).toBe(777);
  const recoveryMs = Math.round(performance.now() - recoveryStart);
  expect(replacement.connected).toBe(true);
  expect(await prisma.previewElement.count({ where: { streamerId: channels[0].id } })).toBe(1);
  const cpu = process.cpuUsage(cpuStart);
  const memory = process.memoryUsage();
  const disk = await fs.statfs(config.uploadDir);
  const staleTmpFiles = (await fs.readdir(path.join(config.uploadDir, ".tmp"))).length;
  console.info("stream-reliability", JSON.stringify({
    channels: count, sockets: realtime.sockets.sockets.size, errors: errorCount, reconnectErrors,
    editLatencyMs, recoveryMs, cpuMs: Math.round((cpu.user + cpu.system) / 1000),
    rssMiB: Math.round(memory.rss / 1024 / 1024), heapMiB: Math.round(memory.heapUsed / 1024 / 1024),
    diskFreeMiB: Math.round(disk.bavail * disk.bsize / 1024 / 1024), staleTmpFiles
  }));
  expect(errorCount).toBe(0);
});
