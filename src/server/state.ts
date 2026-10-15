import type { LiveInstance, Media, PreviewElement, Streamer, User } from "@prisma/client";
import type { Prisma } from "@prisma/client";
import type { MediaItem, OverlayElement, StreamerView } from "../shared/types";
import { sceneLimits } from "../shared/sceneLimits";
import { elementPropsObjectSchema, elementPropsSchema } from "../shared/validation";
import { prisma } from "./db";

type PreviewPatch = Partial<Omit<OverlayElement, "id" | "previewElementId" | "props">> & {
  props?: Record<string, unknown>;
};

type SceneKind = "preview" | "live";
type SceneDb = Prisma.TransactionClient;

export class SceneLimitError extends Error {}
export const maxLegacySceneBroadcastBytes = 4 * 1024 * 1024;

function bytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

export function sceneStateBytes(elements: OverlayElement[]): number {
  return bytes(elements);
}

export async function sceneNeedsRepair(streamerId: string, kind: SceneKind): Promise<boolean> {
  const summary = kind === "preview"
    ? await prisma.$queryRaw<Array<{ total: bigint }>>`
        SELECT COALESCE(SUM(LENGTH(CAST(name AS BLOB)) + LENGTH(CAST(COALESCE(text, '') AS BLOB)) +
          LENGTH(CAST(COALESCE(src, '') AS BLOB)) + LENGTH(CAST(propsJson AS BLOB)) + 1024), 0) AS total
        FROM PreviewElement WHERE streamerId = ${streamerId}`
    : await prisma.$queryRaw<Array<{ total: bigint }>>`
        SELECT COALESCE(SUM(LENGTH(CAST(name AS BLOB)) + LENGTH(CAST(COALESCE(text, '') AS BLOB)) +
          LENGTH(CAST(COALESCE(src, '') AS BLOB)) + LENGTH(CAST(propsJson AS BLOB)) + 1024), 0) AS total
        FROM LiveInstance WHERE streamerId = ${streamerId}`;
  return Number(summary[0]?.total ?? 0) > maxLegacySceneBroadcastBytes;
}

export async function getSceneRepairItems(streamerId: string, kind: SceneKind) {
  const rows = kind === "preview"
    ? await prisma.$queryRaw<Array<{ id: string; name: string }>>`
        SELECT id, SUBSTR(name, 1, 80) AS name FROM PreviewElement
        WHERE streamerId = ${streamerId} ORDER BY createdAt ASC LIMIT 100`
    : await prisma.$queryRaw<Array<{ id: string; name: string }>>`
        SELECT id, SUBSTR(name, 1, 80) AS name FROM LiveInstance
        WHERE streamerId = ${streamerId} ORDER BY createdAt ASC LIMIT 100`;
  return rows;
}

export async function sceneSnapshot(tx: SceneDb, streamerId: string, kind: SceneKind) {
  const rows = kind === "preview"
    ? await tx.previewElement.findMany({ where: { streamerId } })
    : await tx.liveInstance.findMany({ where: { streamerId } });
  const elements = rows.map((row) => kind === "preview"
    ? previewToElement(row as PreviewElement) : liveToElement(row as LiveInstance));
  return {
    count: elements.length,
    bytes: bytes(elements),
    elements: new Map(elements.map((element, index) => [element.id, {
      bytes: bytes(element), propsBytes: Buffer.byteLength(rows[index].propsJson, "utf8")
    }]))
  };
}

export async function checkedSceneMutation<T>(
  streamerId: string,
  kind: SceneKind,
  action: (tx: SceneDb) => Promise<T>
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    const before = await sceneSnapshot(tx, streamerId, kind);
    const result = await action(tx);
    const after = await sceneSnapshot(tx, streamerId, kind);
    assertSceneBudgetChange(before, after, kind);
    return result;
  }, { isolationLevel: "Serializable", timeout: 30_000 });
}

export function assertSceneBudgetChange(
  before: Awaited<ReturnType<typeof sceneSnapshot>>,
  after: Awaited<ReturnType<typeof sceneSnapshot>>,
  kind: SceneKind
): void {
    const countLimit = kind === "preview" ? sceneLimits.previewElements : sceneLimits.liveInstances;
    const byteLimit = kind === "preview" ? sceneLimits.previewBytes : sceneLimits.liveBytes;
    if (after.count > countLimit && after.count > before.count) {
      throw new SceneLimitError("Достигнут лимит элементов сцены. Удалите ненужные элементы, чтобы добавить новые.");
    }
    if (after.bytes > byteLimit && after.bytes > before.bytes) {
      throw new SceneLimitError("Достигнут лимит размера данных сцены. Удалите или сократите элементы.");
    }
    for (const [id, current] of after.elements) {
      const previous = before.elements.get(id);
      if ((current.bytes > sceneLimits.elementBytes && current.bytes > (previous?.bytes ?? 0)) ||
          (current.propsBytes > sceneLimits.propsBytes && current.propsBytes > (previous?.propsBytes ?? 0))) {
        throw new SceneLimitError("Размер данных элемента превышает допустимый лимит.");
      }
    }
}

export async function getDefaultStreamer(): Promise<Streamer> {
  const streamer = await prisma.streamer.findFirst({ orderBy: { createdAt: "asc" } });
  if (!streamer) throw new Error("Legacy channel unavailable");
  return streamer;
}

export function toStreamerView(streamer: Streamer, includeToken = false): StreamerView {
  return {
    id: streamer.id,
    displayName: streamer.displayName,
    canvasWidth: streamer.canvasWidth,
    canvasHeight: streamer.canvasHeight,
    canvasRevision: getCanvasRevision(streamer),
    twitchLogin: streamer.twitchLogin,
    twitchBroadcasterId: streamer.twitchBroadcasterId,
    overlayToken: includeToken ? streamer.overlayToken : undefined
  };
}

export function getCanvasRevision(streamer: Pick<Streamer, "settingsJson">): string {
  try {
    const settings = JSON.parse(streamer.settingsJson) as Record<string, unknown>;
    return typeof settings.canvasRevision === "string" ? settings.canvasRevision : "0";
  } catch {
    return "0";
  }
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
  payload: {
    mediaId?: string;
    type?: "TEXT";
    text?: string;
    x?: number;
    y?: number;
    width?: number;
    height?: number;
    emote?: { name: string; sourceUrl: string; width?: number; height?: number };
  }
): Promise<OverlayElement> {
  return checkedSceneMutation(streamerId, "preview", async (tx) => {
  const zIndex = await nextPreviewZIndex(tx, streamerId);
  if (payload.emote) {
    const { name, sourceUrl, width: nativeWidth, height: nativeHeight } = payload.emote;
    const ratio = nativeWidth && nativeHeight ? nativeWidth / nativeHeight : 1;
    const width = Math.round(ratio >= 1 ? 200 : 200 * ratio);
    const height = Math.round(ratio >= 1 ? 200 / ratio : 200);
    const created = await tx.previewElement.create({
      data: {
        streamerId,
        type: "IMAGE",
        name,
        src: sourceUrl,
        x: payload.x ?? -width - 56,
        y: payload.y ?? 120,
        width,
        height,
        zIndex,
        durationMs: 8_000
      }
    });
    return previewToElement(created);
  }
  if (payload.mediaId) {
    const media = await tx.media.findFirstOrThrow({
      where: { id: payload.mediaId, streamerId }
    });
    const isPortrait = media.width && media.height ? media.height > media.width : false;
    const width =
      payload.width ??
      media.width ??
      (media.type === "AUDIO" ? 520 : media.type === "VIDEO" ? 480 : isPortrait ? 260 : 360);
    const height =
      payload.height ??
      media.height ??
      (media.type === "AUDIO" ? 120 : media.type === "VIDEO" ? 270 : isPortrait ? 360 : 240);
    const x = payload.x ?? -width - 56;
    const y = payload.y ?? 120;
    const created = await tx.previewElement.create({
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

  const created = await tx.previewElement.create({
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
  });
}

export async function updatePreviewElement(
  streamerId: string,
  id: string,
  patch: PreviewPatch
): Promise<OverlayElement> {
  return checkedSceneMutation(streamerId, "preview", async (tx) => {
  const data = patchToPrisma(patch);
  if (patch.props) {
    const existing = await tx.previewElement.findUniqueOrThrow({ where: { id, streamerId } });
    if (Buffer.byteLength(existing.propsJson, "utf8") > 64 * 1024) {
      throw new SceneLimitError("Старые данные элемента слишком велики. Удалите элемент после создания резервной копии сцены.");
    }
    data.propsJson = JSON.stringify({ ...parseRawProps(existing.propsJson), ...patch.props });
  }
  const updated = await tx.previewElement.update({
    where: { id, streamerId },
    data
  });
  return previewToElement(updated);
  });
}

export async function duplicatePreviewElement(
  streamerId: string,
  id: string
): Promise<OverlayElement> {
  return checkedSceneMutation(streamerId, "preview", async (tx) => {
  const source = await tx.previewElement.findFirstOrThrow({ where: { id, streamerId } });
  const zIndex = await nextPreviewZIndex(tx, streamerId);
  const created = await tx.previewElement.create({
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
  });
}

export async function removePreviewElement(streamerId: string, id: string): Promise<void> {
  await prisma.previewElement.delete({ where: { id, streamerId } });
}

export async function showPreviewElementLive(
  streamerId: string,
  previewId: string
): Promise<OverlayElement> {
  return checkedSceneMutation(streamerId, "live", async (tx) => {
  const source = await tx.previewElement.findFirstOrThrow({
    where: { id: previewId, streamerId }
  });
  const startedAt = new Date();
  const endsAt = source.durationMs ? new Date(startedAt.getTime() + source.durationMs) : null;
  const created = await tx.liveInstance.create({
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
  });
}

export async function updateLiveFromPreview(
  streamerId: string,
  liveId: string,
  previewId?: string,
  patch?: PreviewPatch
): Promise<OverlayElement> {
  return checkedSceneMutation(streamerId, "live", async (tx) => {
  const source = previewId
    ? await tx.previewElement.findFirstOrThrow({ where: { id: previewId, streamerId } })
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

  if (!source && patch?.props) {
    const existing = await tx.liveInstance.findUniqueOrThrow({ where: { id: liveId, streamerId } });
    if (Buffer.byteLength(existing.propsJson, "utf8") > 64 * 1024) {
      throw new SceneLimitError("Старые данные элемента слишком велики. Удалите элемент после создания резервной копии сцены.");
    }
    data.propsJson = JSON.stringify({ ...parseRawProps(existing.propsJson), ...patch.props });
  }

  const updated = await tx.liveInstance.update({
    where: { id: liveId, streamerId },
    data
  });
  return liveToElement(updated);
  });
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

function parseRawProps(raw: string): Record<string, unknown> {
  try {
    if (Buffer.byteLength(raw, "utf8") > 64 * 1024) return {};
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function parseProps(raw: string): Record<string, unknown> {
  const parsed = parseRawProps(raw);
  const safe: Record<string, unknown> = {};
  const shape = elementPropsObjectSchema.shape as Record<string, { safeParse: (value: unknown) => { success: boolean } }>;
  for (const [key, value] of Object.entries(parsed)) {
    if (Object.hasOwn(shape, key) && shape[key].safeParse(value).success) safe[key] = value;
  }
  return elementPropsSchema.safeParse(safe).success ? safe : {};
}

export async function hasLegacySceneProps(streamerId: string): Promise<boolean> {
  const [previews, live] = await Promise.all([
    prisma.previewElement.findMany({ where: { streamerId }, select: { propsJson: true } }),
    prisma.liveInstance.findMany({ where: { streamerId }, select: { propsJson: true } })
  ]);
  return [...previews, ...live].some(({ propsJson }) => {
    if (Buffer.byteLength(propsJson, "utf8") > sceneLimits.propsBytes) return true;
    return !elementPropsSchema.safeParse(parseRawProps(propsJson)).success ||
      Object.keys(parseRawProps(propsJson)).length !== Object.keys(parseProps(propsJson)).length;
  });
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

async function nextPreviewZIndex(tx: SceneDb, streamerId: string): Promise<number> {
  const result = await tx.previewElement.aggregate({
    where: { streamerId },
    _max: { zIndex: true }
  });
  return (result._max.zIndex ?? 0) + 1;
}
