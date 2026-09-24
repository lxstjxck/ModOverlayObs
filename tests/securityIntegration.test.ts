import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
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
    originAllowlist: []
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
  options: { session?: string; overlayToken?: string },
  expected = "live:state"
) {
  const socket = connect(baseUrl, {
    transports: ["websocket"],
    reconnection: false,
    autoConnect: false,
    extraHeaders: options.session ? { Cookie: headers(options.session).Cookie } : undefined,
    query: options.overlayToken ? { overlayToken: options.overlayToken } : undefined
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
  await prisma.user.deleteMany();
  for (const name of await files()) await fs.unlink(path.join(config.uploadDir, name));
  config.maxTotalUploadSize = 10240;
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

describe("realtime access revocation", () => {
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
