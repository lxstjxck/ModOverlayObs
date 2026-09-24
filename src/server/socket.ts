import type { Server as HttpServer } from "node:http";
import { Server, type Socket } from "socket.io";
import type { PermissionFlag, PresenceState } from "../shared/types";
import {
  elementPatchSchema,
  idSchema,
  liveShowSchema,
  liveUpdateSchema,
  previewAddSchema
} from "../shared/validation";
import {
  getUserFromCookieHeader,
  getSessionFromCookieHeader,
  readSessionToken,
  hashSessionToken
} from "./auth";
import { accessRevocation } from "./accessRevocation";
import { prisma } from "./db";
import { hasPermission } from "./permissions";
import { isOriginAllowed, WindowRateLimiter } from "./security";
import {
  clearLiveState,
  createPreviewElement,
  duplicatePreviewElement,
  getDefaultStreamer,
  getLiveState,
  getPreviewState,
  removeExpiredLiveInstances,
  removeLiveInstance,
  removePreviewElement,
  showPreviewElementLive,
  updateLiveFromPreview,
  updatePreviewElement,
  writeAudit
} from "./state";

type SocketContext =
  | {
      kind: "moderator";
      streamerId: string;
      user: NonNullable<Awaited<ReturnType<typeof getUserFromCookieHeader>>>;
    }
  | {
      kind: "overlay";
      streamerId: string;
    };

const contexts = new WeakMap<Socket, SocketContext>();
const moderatorsByStreamer = new Map<string, Map<string, { id: string; displayName: string }>>();
const overlaysByStreamer = new Map<string, Set<string>>();
const liveTimers = new Map<string, NodeJS.Timeout>();
const socketConnectionLimiter = new WindowRateLimiter(60, 60_000);
const socketEventLimiter = new WindowRateLimiter(300, 10_000);

setInterval(() => {
  socketConnectionLimiter.prune();
  socketEventLimiter.prune();
}, 60_000).unref();

export function configureSocket(httpServer: HttpServer): Server {
  const io = new Server(httpServer, {
    path: "/socket.io",
    serveClient: false,
    cors: {
      origin(origin, callback) {
        if (isOriginAllowed(origin)) {
          callback(null, true);
          return;
        }
        callback(new Error("Request origin is not allowed"));
      },
      credentials: true
    }
  });

  io.use(async (socket, next) => {
    const token = readStringQuery(socket.handshake.query.overlayToken);
    const sessionToken = readSessionToken(socket.handshake.headers.cookie);
    const sessionHash = sessionToken ? hashSessionToken(sessionToken) : null;
    let revoked = false;
    let expiryTimer: NodeJS.Timeout | undefined;
    const revoke = () => {
      revoked = true;
      socket.emit("access:revoked");
      socket.disconnect(true);
    };
    const onSessionRevoked = (hash: string) => {
      if (hash === sessionHash) revoke();
    };
    const onOverlayRevoked = (oldToken: string) => {
      if (token === oldToken) revoke();
    };
    const cleanup = () => {
      accessRevocation.off("session", onSessionRevoked);
      accessRevocation.off("overlay", onOverlayRevoked);
      clearTimeout(expiryTimer);
    };
    accessRevocation.on("session", onSessionRevoked);
    accessRevocation.on("overlay", onOverlayRevoked);
    socket.once("disconnect", cleanup);
    socket.conn.once("close", cleanup);
    const finish: typeof next = (error) => {
      if (error || revoked) cleanup();
      next(error ?? (revoked ? new Error("Access revoked") : undefined));
    };
    try {
      if (!isOriginAllowed(socket.handshake.headers.origin)) {
        finish(new Error("Request origin is not allowed"));
        return;
      }
      const connectionLimit = socketConnectionLimiter.consume(
        `socket:connect:${socket.handshake.address || "unknown"}`
      );
      if (!connectionLimit.allowed) {
        finish(new Error("Too many socket connections. Try again later."));
        return;
      }

      if (token) {
        const streamer = await prisma.streamer.findUnique({ where: { overlayToken: token } });
        if (!streamer) {
          finish(new Error("Invalid overlay token"));
          return;
        }
        contexts.set(socket, { kind: "overlay", streamerId: streamer.id });
        finish();
        return;
      }

      const session = await getSessionFromCookieHeader(socket.handshake.headers.cookie);
      if (!session) {
        finish(new Error("Authentication required"));
        return;
      }
      const streamer = await getDefaultStreamer();
      if (session.expiresAt.getTime() <= Date.now()) {
        finish(new Error("Session expired"));
        return;
      }
      contexts.set(socket, { kind: "moderator", streamerId: streamer.id, user: session.user });
      expiryTimer = setTimeout(revoke, Math.max(0, session.expiresAt.getTime() - Date.now()));
      expiryTimer.unref();
      finish();
    } catch (error) {
      finish(error instanceof Error ? error : new Error("Socket authentication failed"));
    }
  });

  io.on("connection", async (socket) => {
    try {
      const context = contexts.get(socket);
      if (!context) {
        socket.disconnect(true);
        return;
      }

      if (context.kind === "overlay") {
        await handleOverlayConnection(io, socket, context.streamerId);
        return;
      }

      await handleModeratorConnection(io, socket, context.streamerId, context.user);
    } catch {
      socket.disconnect(true);
    }
  });

  void restoreLiveTimers(io);
  const cleanupTimer = setInterval(() => {
    void cleanupExpiredAndBroadcast(io);
  }, 5_000).unref();
  httpServer.once("close", () => {
    clearInterval(cleanupTimer);
    clearAllTimers();
  });

  return io;
}

async function handleOverlayConnection(
  io: Server,
  socket: Socket,
  streamerId: string
): Promise<void> {
  if (!socket.connected) return;
  socket.join(overlayRoom(streamerId));
  const overlays = overlaysByStreamer.get(streamerId) ?? new Set<string>();
  overlays.add(socket.id);
  overlaysByStreamer.set(streamerId, overlays);

  socket.on("disconnect", () => {
    overlaysByStreamer.get(streamerId)?.delete(socket.id);
    emitPresence(io, streamerId);
  });
  const state = await getPreviewState(streamerId);
  if (!socket.connected) return;
  socket.emit("overlay:state", state);
  emitPresence(io, streamerId);
}

async function handleModeratorConnection(
  io: Server,
  socket: Socket,
  streamerId: string,
  user: NonNullable<Awaited<ReturnType<typeof getUserFromCookieHeader>>>
): Promise<void> {
  if (!socket.connected) return;
  socket.join(moderatorRoom(streamerId));
  const moderators = moderatorsByStreamer.get(streamerId) ?? new Map();
  moderators.set(socket.id, { id: user.id, displayName: user.displayName });
  moderatorsByStreamer.set(streamerId, moderators);

  socket.on("disconnect", () => {
    moderatorsByStreamer.get(streamerId)?.delete(socket.id);
    emitPresence(io, streamerId);
  });

  socket.emit("preview:state", await getPreviewState(streamerId));
  socket.emit("live:state", await getLiveState(streamerId));
  if (!socket.connected) return;
  emitPresence(io, streamerId);

  socket.on("preview:add", async (payload) => {
    await guarded(socket, user, "canEditPreview", async (user) => {
      const parsed = previewAddSchema.parse(payload);
      if (parsed.type === "TEXT") {
        assertAllowed(user, "canCreateText");
      }
      const created = await createPreviewElement(streamerId, parsed);
      await writeAudit(streamerId, user.id, "preview.added", { previewId: created.id });
      await emitPreviewState(io, streamerId);
    });
  });

  socket.on("preview:update", async (payload, acknowledge) => {
    const ok = await guarded(socket, user, "canEditPreview", async () => {
      const parsed = idSchema
        .extend({
          patch: elementPatchSchema
        })
        .parse(payload);
      await updatePreviewElement(streamerId, parsed.id, parsed.patch);
      await emitPreviewState(io, streamerId);
    });
    if (typeof acknowledge === "function") acknowledge(ok);
  });

  socket.on("preview:duplicate", async (payload) => {
    await guarded(socket, user, "canEditPreview", async (user) => {
      const parsed = idSchema.parse(payload);
      const created = await duplicatePreviewElement(streamerId, parsed.id);
      await writeAudit(streamerId, user.id, "preview.duplicated", { previewId: created.id });
      await emitPreviewState(io, streamerId);
    });
  });

  socket.on("preview:remove", async (payload) => {
    await guarded(socket, user, "canEditPreview", async (user) => {
      const parsed = idSchema.parse(payload);
      await removePreviewElement(streamerId, parsed.id);
      await writeAudit(streamerId, user.id, "preview.removed", { previewId: parsed.id });
      await emitPreviewState(io, streamerId);
    });
  });

  socket.on("live:show", async (payload) => {
    await guarded(socket, user, "canPushLive", async (user) => {
      const parsed = liveShowSchema.parse(payload);
      const live = await showPreviewElementLive(streamerId, parsed.previewId);
      await writeAudit(streamerId, user.id, "live.show", {
        previewId: parsed.previewId,
        liveId: live.id
      });
      scheduleLiveRemoval(io, streamerId, live.id, live.endsAt ?? null);
      await emitLiveState(io, streamerId);
    });
  });

  socket.on("live:update", async (payload) => {
    await guarded(socket, user, "canPushLive", async () => {
      const parsed = liveUpdateSchema.parse(payload);
      const live = await updateLiveFromPreview(
        streamerId,
        parsed.liveId,
        parsed.previewId,
        parsed.patch
      );
      scheduleLiveRemoval(io, streamerId, live.id, live.endsAt ?? null);
      await emitLiveState(io, streamerId);
    });
  });

  socket.on("live:remove", async (payload) => {
    await guarded(socket, user, "canRemoveLive", async (user) => {
      const parsed = idSchema.parse(payload);
      await removeLiveInstance(streamerId, parsed.id);
      clearTimer(parsed.id);
      await writeAudit(streamerId, user.id, "live.removed", { liveId: parsed.id });
      await emitLiveState(io, streamerId);
    });
  });

  socket.on("live:clear", async () => {
    await guarded(socket, user, "canClearLive", async (user) => {
      await clearLiveState(streamerId);
      clearAllTimers();
      await writeAudit(streamerId, user.id, "live.cleared");
      await emitLiveState(io, streamerId);
    });
  });

  for (const eventName of [
    "video:live:play",
    "video:live:pause",
    "video:live:stop",
    "video:live:restart"
  ] as const) {
    socket.on(eventName, async (payload) => {
      await guarded(socket, user, "canPushLive", async () => {
        const parsed = idSchema.parse(payload);
        const overlayEvent =
          eventName === "video:live:play"
            ? "video:play"
            : eventName === "video:live:pause"
              ? "video:pause"
              : eventName === "video:live:stop"
                ? "video:stop"
                : "video:restart";
        io.to(overlayRoom(streamerId)).emit(overlayEvent, { id: parsed.id });
      });
    });
  }
}

async function guarded(
  socket: Socket,
  user: NonNullable<Awaited<ReturnType<typeof getUserFromCookieHeader>>>,
  permission: PermissionFlag,
  action: (user: NonNullable<Awaited<ReturnType<typeof getUserFromCookieHeader>>>) => Promise<void>
): Promise<boolean> {
  try {
    const rateLimit = socketEventLimiter.consume(`socket:event:${socket.id}`);
    if (!rateLimit.allowed) {
      socket.emit("app:error", "Too many realtime actions. Slow down and try again.");
      return false;
    }
    const currentUser = await getUserFromCookieHeader(socket.handshake.headers.cookie);
    if (!socket.connected || !currentUser || currentUser.id !== user.id) {
      socket.emit("access:revoked");
      socket.disconnect(true);
      return false;
    }
    assertAllowed(currentUser, permission);
    // The canvas is broadcast directly to OBS, including preview mutations.
    if (permission === "canEditPreview") assertAllowed(currentUser, "canPushLive");
    await action(currentUser);
    return true;
  } catch (error) {
    socket.emit("app:error", error instanceof Error ? error.message : "Action failed");
    return false;
  }
}

function assertAllowed(
  user: NonNullable<Awaited<ReturnType<typeof getUserFromCookieHeader>>>,
  permission: PermissionFlag
): void {
  if (!hasPermission(user.role, user.permissionsJson, permission)) {
    throw new Error("Permission denied");
  }
}

async function emitPreviewState(io: Server, streamerId: string): Promise<void> {
  const state = await getPreviewState(streamerId);
  io.to(moderatorRoom(streamerId)).emit("preview:state", state);
  io.to(overlayRoom(streamerId)).emit("overlay:state", state);
}

async function emitLiveState(io: Server, streamerId: string): Promise<void> {
  const state = await getLiveState(streamerId);
  io.to(moderatorRoom(streamerId)).emit("live:state", state);
}

function emitPresence(io: Server, streamerId: string): void {
  const moderators = Array.from(moderatorsByStreamer.get(streamerId)?.values() ?? []);
  const overlayCount = overlaysByStreamer.get(streamerId)?.size ?? 0;
  const payload: PresenceState = {
    overlayConnected: overlayCount > 0,
    overlayCount,
    moderators
  };
  io.to(moderatorRoom(streamerId)).emit("presence:update", payload);
}

async function restoreLiveTimers(io: Server): Promise<void> {
  await cleanupExpiredAndBroadcast(io);
  const liveItems = await prisma.liveInstance.findMany({
    where: { endsAt: { not: null } },
    select: { id: true, streamerId: true, endsAt: true }
  });
  for (const item of liveItems) {
    scheduleLiveRemoval(io, item.streamerId, item.id, item.endsAt?.toISOString() ?? null);
  }
}

function scheduleLiveRemoval(
  io: Server,
  streamerId: string,
  liveId: string,
  endsAt: string | null
): void {
  clearTimer(liveId);
  if (!endsAt) {
    return;
  }
  const delay = Math.max(0, new Date(endsAt).getTime() - Date.now());
  const timer = setTimeout(() => {
    void (async () => {
      await prisma.liveInstance.deleteMany({ where: { id: liveId } });
      await emitLiveState(io, streamerId);
      liveTimers.delete(liveId);
    })();
  }, delay);
  timer.unref();
  liveTimers.set(liveId, timer);
}

async function cleanupExpiredAndBroadcast(io: Server): Promise<void> {
  const streamers = await prisma.streamer.findMany({ select: { id: true } });
  for (const streamer of streamers) {
    const removed = await removeExpiredLiveInstances(streamer.id);
    if (removed.length > 0) {
      for (const id of removed) {
        clearTimer(id);
      }
      await emitLiveState(io, streamer.id);
    }
  }
}

function clearTimer(liveId: string): void {
  const timer = liveTimers.get(liveId);
  if (timer) {
    clearTimeout(timer);
    liveTimers.delete(liveId);
  }
}

function clearAllTimers(): void {
  for (const timer of liveTimers.values()) {
    clearTimeout(timer);
  }
  liveTimers.clear();
}

function moderatorRoom(streamerId: string): string {
  return `streamer:${streamerId}:moderators`;
}

function overlayRoom(streamerId: string): string {
  return `streamer:${streamerId}:overlay`;
}

function readStringQuery(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }
  return value ?? null;
}
