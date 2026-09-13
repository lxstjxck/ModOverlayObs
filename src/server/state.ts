import type {
  LiveInstance,
  Media,
  PreviewElement,
  Streamer,
  User
} from "@prisma/client";
import crypto from "node:crypto";
import type { MediaItem, OverlayElement, StreamerView } from "../shared/types";
import { prisma } from "./db";

type PreviewPatch = Partial<Omit<OverlayElement, "id" | "previewElementId" | "props">> & {
  props?: Record<string, unknown>;
};

export async function getDefaultStreamer(): Promise<Streamer> {
  const streamer = await prisma.streamer.findFirst({ orderBy: { createdAt: "asc" } });
  if (!streamer) {
    return prisma.streamer.create({
      data: {
        displayName: "Default Streamer",
        overlayToken: crypto.randomBytes(32).toString("hex"),
        canvasWidth: 1920,
        canvasHeight: 1080
      }
    });
  }
  return streamer;
}

export function toStreamerView(streamer: Streamer, includeToken = false): StreamerView {
  return {
    id: streamer.id,
    displayName: streamer.displayName,
    canvasWidth: streamer.canvasWidth,
    canvasHeight: streamer.canvasHeight,
    overlayToken: includeToken ? streamer.overlayToken : undefined
  };
}

export function toMediaItem(media: Media & { uploadedBy?: User | null }): MediaItem {
  return {
    id: media.id,
    filename: media.filename,
    originalName: media.originalName,
    mimeType: media.mimeType,
    type: media.type,
    size: media.size,
    url: media.url,
    durationMs: media.durationMs,
    width: media.width,
    height: media.height,
    uploadedBy: media.uploadedBy?.displayName ?? null,
    uploadedAt: media.createdAt.toISOString()
  };
}

export function previewToElement(row: PreviewElement): OverlayElement {
  return {
    id: row.id,
    mediaId: row.mediaId,
    type: row.type,
    name: row.name,
    src: row.src,
    text: row.text,
    x: row.x,
    y: row.y,
    width: row.width,
    height: row.height,
    rotation: row.rotation,
    opacity: row.opacity,
    zIndex: row.zIndex,
    visible: row.visible,
    durationMs: row.durationMs,
    animationIn: parseAnimation(row.animationIn),
    animationOut: parseAnimation(row.animationOut),
    previewVolume: row.previewVolume,
    liveVolume: row.liveVolume,
    muted: row.muted,
    loop: row.loop,
    startTime: row.startTime,
    props: parseProps(row.propsJson)
  };
}

export function liveToElement(row: LiveInstance): OverlayElement {
  return {
    id: row.id,
    previewElementId: row.previewElementId,
    mediaId: row.mediaId,
    type: row.type,
    name: row.name,
    src: row.src,
    text: row.text,
    x: row.x,
    y: row.y,
    width: row.width,
    height: row.height,
    rotation: row.rotation,
    opacity: row.opacity,
    zIndex: row.zIndex,
    visible: row.visible,
    durationMs: row.durationMs,
    animationIn: parseAnimation(row.animationIn),
    animationOut: parseAnimation(row.animationOut),
    liveVolume: row.liveVolume,
    muted: row.muted,
    loop: row.loop,
    startTime: row.startTime,
    startedAt: row.startedAt.toISOString(),
    endsAt: row.endsAt?.toISOString() ?? null,
    props: parseProps(row.propsJson)
  };
}

export async function getPreviewState(streamerId: string): Promise<OverlayElement[]> {
  const rows = await prisma.previewElement.findMany({
    where: { streamerId },
    orderBy: [{ zIndex: "asc" }, { createdAt: "asc" }]
  });
  return rows.map(previewToElement);
}

export async function getLiveState(streamerId: string): Promise<OverlayElement[]> {
  const rows = await prisma.liveInstance.findMany({
    where: { streamerId },
    orderBy: [{ zIndex: "asc" }, { createdAt: "asc" }]
  });
  return rows.map(liveToElement);
}

export async function listMedia(streamerId: string): Promise<MediaItem[]> {
  const rows = await prisma.media.findMany({
    where: { streamerId },
    include: { uploadedBy: true },
    orderBy: { createdAt: "desc" }
  });
  return rows.map(toMediaItem);
}

export async function createPreviewElement(
  streamerId: string,
  payload: { mediaId?: string; type?: "TEXT"; text?: string; x?: number; y?: number }
): Promise<OverlayElement> {
  const zIndex = await nextPreviewZIndex(streamerId);
  if (payload.mediaId) {
    const media = await prisma.media.findFirstOrThrow({
      where: { id: payload.mediaId, streamerId }
    });
    const isPortrait = media.width && media.height ? media.height > media.width : false;
    const width = media.type === "AUDIO" ? 520 : media.type === "VIDEO" ? 480 : isPortrait ? 260 : 360;
    const height = media.type === "AUDIO" ? 120 : media.type === "VIDEO" ? 270 : isPortrait ? 360 : 240;
    const x = payload.x ?? -width - 56;
    const y = payload.y ?? 120;
    const created = await prisma.previewElement.create({
      data: {
        streamerId,
        mediaId: media.id,
        type: media.type === "IMAGE" ? "IMAGE" : media.type,
        name: media.originalName,
        src: media.url,
        x,
        y,
        width,
        height,
        zIndex,
        durationMs: media.type === "VIDEO" || media.type === "AUDIO" ? 10_000 : 8_000,
        propsJson:
          media.type === "AUDIO"
            ? JSON.stringify({
                title: media.originalName,
                visualizer: true
              })
            : "{}"
      }
    });
    return previewToElement(created);
  }

  const created = await prisma.previewElement.create({
    data: {
      streamerId,
      type: "TEXT",
      name: "Text",
      text: payload.text ?? "New text",
      x: payload.x ?? -476,
      y: payload.y ?? 120,
      width: 420,
      height: 96,
      zIndex,
      durationMs: 8_000,
      propsJson: JSON.stringify({
        fontFamily: "Inter, Arial, sans-serif",
        fontSize: 46,
        fontWeight: 800,
        color: "#ffffff",
        background: "rgba(0,0,0,0)",
        stroke: "#000000",
        strokeWidth: 0,
        align: "left",
        shadow: true
      })
    }
  });
  return previewToElement(created);
}

export async function updatePreviewElement(
  streamerId: string,
  id: string,
  patch: PreviewPatch
): Promise<OverlayElement> {
  const data = patchToPrisma(patch);
  const updated = await prisma.previewElement.update({
    where: { id, streamerId },
    data
  });
  return previewToElement(updated);
}

export async function duplicatePreviewElement(streamerId: string, id: string): Promise<OverlayElement> {
  const source = await prisma.previewElement.findFirstOrThrow({ where: { id, streamerId } });
  const zIndex = await nextPreviewZIndex(streamerId);
  const created = await prisma.previewElement.create({
    data: {
      streamerId,
      mediaId: source.mediaId,
      type: source.type,
      name: `${source.name} copy`,
      src: source.src,
      text: source.text,
      x: source.x + 32,
      y: source.y + 32,
      width: source.width,
      height: source.height,
      rotation: source.rotation,
      opacity: source.opacity,
      zIndex,
      visible: source.visible,
      durationMs: source.durationMs,
      animationIn: source.animationIn,
      animationOut: source.animationOut,
      previewVolume: source.previewVolume,
      liveVolume: source.liveVolume,
      muted: source.muted,
      loop: source.loop,
      startTime: source.startTime,
      propsJson: source.propsJson
    }
  });
  return previewToElement(created);
}

export async function removePreviewElement(streamerId: string, id: string): Promise<void> {
  await prisma.previewElement.delete({ where: { id, streamerId } });
}

export async function showPreviewElementLive(
  streamerId: string,
  previewId: string
): Promise<OverlayElement> {
  const source = await prisma.previewElement.findFirstOrThrow({
    where: { id: previewId, streamerId }
  });
  const startedAt = new Date();
  const endsAt = source.durationMs ? new Date(startedAt.getTime() + source.durationMs) : null;
  const created = await prisma.liveInstance.create({
    data: {
      streamerId,
      previewElementId: source.id,
      mediaId: source.mediaId,
      type: source.type,
      name: source.name,
      src: source.src,
      text: source.text,
      x: source.x,
      y: source.y,
      width: source.width,
      height: source.height,
      rotation: source.rotation,
      opacity: source.opacity,
      zIndex: source.zIndex,
      visible: source.visible,
      durationMs: source.durationMs,
      animationIn: source.animationIn,
      animationOut: source.animationOut,
      liveVolume: source.liveVolume,
      muted: source.muted,
      loop: source.loop,
      startTime: source.startTime,
      propsJson: source.propsJson,
      startedAt,
      endsAt
    }
  });
  return liveToElement(created);
}

export async function updateLiveFromPreview(
  streamerId: string,
  liveId: string,
  previewId?: string,
  patch?: PreviewPatch
): Promise<OverlayElement> {
  const source = previewId
    ? await prisma.previewElement.findFirstOrThrow({ where: { id: previewId, streamerId } })
    : null;

  const data = source
    ? {
        mediaId: source.mediaId,
        type: source.type,
        name: source.name,
        src: source.src,
        text: source.text,
        x: source.x,
        y: source.y,
        width: source.width,
        height: source.height,
        rotation: source.rotation,
        opacity: source.opacity,
        zIndex: source.zIndex,
        visible: source.visible,
        durationMs: source.durationMs,
        animationIn: source.animationIn,
        animationOut: source.animationOut,
        liveVolume: source.liveVolume,
        muted: source.muted,
        loop: source.loop,
        startTime: source.startTime,
        propsJson: source.propsJson,
        endsAt: source.durationMs ? new Date(Date.now() + source.durationMs) : null
      }
    : patchToPrisma(patch ?? {});

  const updated = await prisma.liveInstance.update({
    where: { id: liveId, streamerId },
    data
  });
  return liveToElement(updated);
}

export async function removeLiveInstance(streamerId: string, id: string): Promise<void> {
  await prisma.liveInstance.delete({ where: { id, streamerId } });
}

export async function clearLiveState(streamerId: string): Promise<void> {
  await prisma.liveInstance.deleteMany({ where: { streamerId } });
}

export async function removeExpiredLiveInstances(streamerId?: string): Promise<string[]> {
  const now = new Date();
  const expired = await prisma.liveInstance.findMany({
    where: {
      ...(streamerId ? { streamerId } : {}),
      endsAt: { not: null, lte: now }
    },
    select: { id: true }
  });
  if (expired.length > 0) {
    await prisma.liveInstance.deleteMany({
      where: { id: { in: expired.map((item) => item.id) } }
    });
  }
  return expired.map((item) => item.id);
}

export async function writeAudit(
  streamerId: string,
  userId: string | null,
  action: string,
  metadata: Record<string, unknown> = {},
  mediaId?: string | null
): Promise<void> {
  await prisma.auditLog.create({
    data: {
      streamerId,
      userId,
      action,
      mediaId,
      metadataJson: JSON.stringify(metadata)
    }
  });
}

function parseProps(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function parseAnimation(value: string): OverlayElement["animationIn"] {
  const allowed = new Set([
    "none",
    "fade",
    "scale",
    "slide-left",
    "slide-right",
    "slide-up",
    "slide-down"
  ]);
  return allowed.has(value) ? (value as OverlayElement["animationIn"]) : "none";
}

function patchToPrisma(patch: PreviewPatch) {
  const data: Record<string, unknown> = {};
  const keys: Array<keyof PreviewPatch> = [
    "name",
    "text",
    "x",
    "y",
    "width",
    "height",
    "rotation",
    "opacity",
    "zIndex",
    "visible",
    "durationMs",
    "animationIn",
    "animationOut",
    "previewVolume",
    "liveVolume",
    "muted",
    "loop",
    "startTime"
  ];
  for (const key of keys) {
    if (patch[key] !== undefined) {
      data[key] = patch[key];
    }
  }
  if (patch.props !== undefined) {
    data.propsJson = JSON.stringify(patch.props);
  }
  return data;
}

async function nextPreviewZIndex(streamerId: string): Promise<number> {
  const result = await prisma.previewElement.aggregate({
    where: { streamerId },
    _max: { zIndex: true }
  });
  return (result._max.zIndex ?? 0) + 1;
}
