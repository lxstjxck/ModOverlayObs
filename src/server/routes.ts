import bcrypt from "bcryptjs";
import express from "express";
import crypto from "node:crypto";
import path from "node:path";
import { z } from "zod";
import { loginSchema, mediaUrlSchema } from "../shared/validation";
import {
  createSession,
  destroySession,
  getCsrfTokenFromRequest,
  requireAuth,
  requirePermission,
  toUserView,
  type AuthenticatedRequest
} from "./auth";
import { config } from "./config";
import { prisma } from "./db";
import { clientIp, createRateLimitMiddleware } from "./security";
import {
  clearLiveState,
  getDefaultStreamer,
  listMedia,
  toMediaItem,
  toStreamerView,
  writeAudit
} from "./state";
import {
  deleteStoredUpload,
  uploadErrorHandler,
  uploadMiddleware,
  validateAndStoreUpload
} from "./uploads";

const loginIpRateLimit = createRateLimitMiddleware({
  max: 30,
  windowMs: 60_000,
  message: "Too many login attempts. Try again later.",
  key: (request) => `login:ip:${clientIp(request)}`
});

const loginAccountRateLimit = createRateLimitMiddleware({
  max: 8,
  windowMs: 60_000,
  message: "Too many login attempts for this account. Try again later.",
  key: (request) => {
    const body = request.body as { username?: unknown };
    const username = typeof body.username === "string" ? body.username.toLowerCase() : "unknown";
    return `login:account:${clientIp(request)}:${username}`;
  }
});

const uploadRateLimit = createRateLimitMiddleware({
  max: 20,
  windowMs: 60 * 60_000,
  message: "Too many uploads. Try again later.",
  key: (request) => `upload:${(request as AuthenticatedRequest).user.id}`
});

export function createAppRouter(): express.Router {
  const router = express.Router();

  router.post("/auth/login", loginIpRateLimit, loginAccountRateLimit, async (request, response) => {
    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: "Invalid login payload" });
      return;
    }

    const streamer = await getDefaultStreamer();
    const user = await prisma.user.findUnique({
      where: { username: parsed.data.username }
    });
    if (!user || !(await bcrypt.compare(parsed.data.password, user.passwordHash))) {
      await writeAudit(streamer.id, user?.id ?? null, "auth.login_failed", {
        username: parsed.data.username,
        ip: clientIp(request)
      });
      response.status(401).json({ error: "Invalid username or password" });
      return;
    }

    const csrfToken = await createSession(user.id, response);
    await writeAudit(streamer.id, user.id, "auth.login_success", { ip: clientIp(request) });
    response.json({ user: toUserView(user), streamer: toStreamerView(streamer), csrfToken });
  });

  router.post("/auth/logout", requireAuth, async (request, response) => {
    await destroySession(request, response);
    response.json({ ok: true });
  });

  router.get("/auth/me", requireAuth, async (request, response) => {
    const streamer = await getDefaultStreamer();
    response.json({
      user: toUserView((request as AuthenticatedRequest).user),
      streamer: toStreamerView(streamer),
      csrfToken: getCsrfTokenFromRequest(request)
    });
  });

  router.get("/media", requireAuth, async (_request, response) => {
    const streamer = await getDefaultStreamer();
    response.json({ media: await listMedia(streamer.id) });
  });

  router.post("/media/url", requireAuth, uploadRateLimit, async (request, response) => {
    const parsed = mediaUrlSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: "Invalid media URL" });
      return;
    }

    const user = (request as AuthenticatedRequest).user;
    const permission = parsed.data.type === "AUDIO" ? "canUploadAudio" : "canUploadVideo";
    if (!toUserView(user).permissions[permission]) {
      response.status(403).json({ error: "Permission denied" });
      return;
    }

    const streamer = await getDefaultStreamer();
    const mediaUrl = new URL(parsed.data.url);
    const fallbackName = decodeURIComponent(mediaUrl.pathname.split("/").filter(Boolean).pop() ?? "");
    const originalName =
      parsed.data.name?.trim() ||
      fallbackName ||
      (parsed.data.type === "AUDIO" ? "Remote audio" : "Remote video");
    const media = await prisma.media.create({
      data: {
        streamerId: streamer.id,
        filename: `remote-${crypto.randomUUID()}`,
        originalName,
        mimeType: parsed.data.type === "AUDIO" ? "audio/remote" : "video/remote",
        type: parsed.data.type,
        size: 0,
        url: parsed.data.url,
        uploadedById: user.id
      },
      include: { uploadedBy: true }
    });

    await writeAudit(streamer.id, user.id, "media.url_added", {
      type: parsed.data.type,
      urlHost: mediaUrl.host,
      mediaId: media.id
    });
    response.status(201).json({ media: toMediaItem(media) });
  });

  router.post(
    "/media",
    requireAuth,
    uploadRateLimit,
    uploadMiddleware.single("file"),
    async (request, response) => {
      const user = (request as AuthenticatedRequest).user;
      const file = request.file;
      if (!file) {
        response.status(400).json({ error: "File is required" });
        return;
      }

      try {
        const upload = await validateAndStoreUpload(file);
        const permission =
          upload.type === "VIDEO"
            ? "canUploadVideo"
            : upload.type === "GIF"
              ? "canUploadGif"
              : upload.type === "AUDIO"
                ? "canUploadAudio"
                : "canUploadImage";

        if (!toUserView(user).permissions[permission]) {
          await deleteStoredUpload(upload.filename);
          response.status(403).json({ error: "Permission denied" });
          return;
        }

        const streamer = await getDefaultStreamer();
        const currentUsage = await prisma.media.aggregate({
          where: { streamerId: streamer.id },
          _sum: { size: true }
        });
        const totalSize = (currentUsage._sum.size ?? 0) + upload.size;
        if (totalSize > config.maxTotalUploadSize) {
          await deleteStoredUpload(upload.filename);
          response.status(413).json({ error: "Upload storage quota exceeded" });
          return;
        }

        const media = await prisma.media.create({
          data: {
            streamerId: streamer.id,
            filename: upload.filename,
            originalName: upload.originalName,
            mimeType: upload.mimeType,
            type: upload.type,
            size: upload.size,
            url: upload.url,
            uploadedById: user.id
          },
          include: { uploadedBy: true }
        });
        await writeAudit(streamer.id, user.id, "media.uploaded", {
          originalName: upload.originalName,
          type: upload.type,
          size: upload.size
        });
        response.status(201).json({ media: toMediaItem(media) });
      } catch (error) {
        response.status(400).json({ error: uploadErrorHandler(error, request) });
      }
    }
  );

  router.patch("/media/:id", requireAuth, async (request, response) => {
    const mediaId = readRouteParam(request.params.id);
    if (!mediaId) {
      response.status(400).json({ error: "Invalid media id" });
      return;
    }
    const body = z.object({ originalName: z.string().trim().min(1).max(180) }).safeParse(request.body);
    if (!body.success) {
      response.status(400).json({ error: "Invalid media name" });
      return;
    }
    const streamer = await getDefaultStreamer();
    const media = await prisma.media.update({
      where: { id: mediaId, streamerId: streamer.id },
      data: { originalName: body.data.originalName },
      include: { uploadedBy: true }
    });
    response.json({ media: toMediaItem(media) });
  });

  router.delete(
    "/media/:id",
    requireAuth,
    requirePermission("canDeleteMedia"),
    async (request, response) => {
      const mediaId = readRouteParam(request.params.id);
      if (!mediaId) {
        response.status(400).json({ error: "Invalid media id" });
        return;
      }
      const streamer = await getDefaultStreamer();
      const media = await prisma.media.delete({
        where: { id: mediaId, streamerId: streamer.id }
      });
      await deleteStoredUpload(media.filename);
      await writeAudit(streamer.id, (request as AuthenticatedRequest).user.id, "media.deleted", {
        mediaId: media.id,
        originalName: media.originalName
      });
      response.json({ ok: true });
    }
  );

  router.get("/streamer", requireAuth, async (_request, response) => {
    const streamer = await getDefaultStreamer();
    response.json({ streamer: toStreamerView(streamer, true) });
  });

  router.get("/obs", requireAuth, async (request, response) => {
    const streamer = await getDefaultStreamer();
    response.json({
      overlayUrl: buildOverlayUrl(request, streamer.overlayToken),
      canvasWidth: streamer.canvasWidth,
      canvasHeight: streamer.canvasHeight
    });
  });

  router.post("/obs/regenerate", requireAuth, requirePermission("canClearLive"), async (request, response) => {
    const streamer = await getDefaultStreamer();
    await clearLiveState(streamer.id);
    const updated = await prisma.streamer.update({
      where: { id: streamer.id },
      data: { overlayToken: crypto.randomBytes(32).toString("hex") }
    });
    await writeAudit(updated.id, (request as AuthenticatedRequest).user.id, "overlay.token.regenerated");
    response.json({
      overlayUrl: buildOverlayUrl(request, updated.overlayToken),
      canvasWidth: updated.canvasWidth,
      canvasHeight: updated.canvasHeight
    });
  });

  return router;
}

export function configureUploads(app: express.Express): void {
  app.use(
    "/uploads",
    express.static(config.uploadDir, {
      dotfiles: "deny",
      index: false,
      fallthrough: false,
      immutable: true,
      maxAge: "7d",
      setHeaders(response) {
        response.setHeader("X-Content-Type-Options", "nosniff");
        response.setHeader("Cross-Origin-Resource-Policy", "same-origin");
        response.setHeader("Cache-Control", "public, max-age=604800, immutable");
      }
    })
  );
}

export function configureStatic(app: express.Express): void {
  const clientDist = path.join(config.projectRoot, "dist", "client");
  app.use(express.static(clientDist));
  app.get("*", (_request, response, next) => {
    response.sendFile(path.join(clientDist, "index.html"), (error) => {
      if (error) {
        next();
      }
    });
  });
}

function buildOverlayUrl(request: express.Request, token: string): string {
  const origin = config.publicOrigin || config.domain || `${request.protocol}://${request.get("host")}`;
  return `${origin.replace(/\/$/, "")}/overlay/${token}`;
}

function readRouteParam(value: string | string[] | undefined): string | null {
  if (!value) {
    return null;
  }
  return Array.isArray(value) ? (value[0] ?? null) : value;
}
