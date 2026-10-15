import type { Streamer } from "@prisma/client";
import crypto from "node:crypto";
import type { CanvasSettingsInput } from "../shared/types";
import { prisma } from "./db";
import { assertSceneBudgetChange, getCanvasRevision, sceneSnapshot } from "./state";

const pending = new Map<string, Promise<void>>();
const queued = new Map<string, number>();

export async function withCanvasLock<T>(channelId: string, action: () => Promise<T>): Promise<T> {
  const waiting = queued.get(channelId) ?? 0;
  if (waiting >= 64) throw new Error("Сцена занята. Повторите действие чуть позже.");
  queued.set(channelId, waiting + 1);
  const previous = pending.get(channelId) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => { release = resolve; });
  pending.set(channelId, current);
  await previous;
  try { return await action(); }
  finally {
    const remaining = (queued.get(channelId) ?? 1) - 1;
    if (remaining === 0) queued.delete(channelId);
    else queued.set(channelId, remaining);
    release();
    if (pending.get(channelId) === current) pending.delete(channelId);
  }
}

export class CanvasConflictError extends Error {}
export class CanvasGeometryError extends Error {}

type Bounds = { x: number; y: number; width: number; height: number; propsJson: string };

export function scaledBounds(row: Bounds, scaleX: number, scaleY: number): Bounds {
  const x = row.x * scaleX;
  const y = row.y * scaleY;
  const width = row.width * scaleX;
  const height = row.height * scaleY;
  if (![x, y, width, height].every(Number.isFinite) ||
      Math.abs(x) > 10000 || Math.abs(y) > 10000 ||
      width < 8 || height < 8 || width > 10000 || height > 10000) {
    throw new CanvasGeometryError("Scaled element exceeds editor geometry limits");
  }
  const props = JSON.parse(row.propsJson) as Record<string, unknown>;
  const scaleInsets = (a: string, b: string, factor: number, limit: number) => {
    const first = typeof props[a] === "number" ? props[a] * factor : 0;
    const second = typeof props[b] === "number" ? props[b] * factor : 0;
    if (first + second >= limit) throw new CanvasGeometryError("Scaled crop has no visible area");
    if (a in props) props[a] = first;
    if (b in props) props[b] = second;
  };
  scaleInsets("cropLeft", "cropRight", scaleX, width);
  scaleInsets("cropTop", "cropBottom", scaleY, height);
  // Text glyphs remain uniform when the canvas aspect ratio changes.
  for (const key of ["fontSize", "strokeWidth"]) {
    if (typeof props[key] === "number") props[key] *= Math.min(scaleX, scaleY);
  }
  return { x, y, width, height, propsJson: JSON.stringify(props) };
}

export async function saveCanvasSettings(
  channelId: string,
  userId: string,
  input: CanvasSettingsInput
): Promise<Streamer> {
  return withCanvasLock(channelId, () => prisma.$transaction(async (tx) => {
    const current = await tx.streamer.findUniqueOrThrow({ where: { id: channelId } });
    if (getCanvasRevision(current) !== input.expectedRevision) {
      throw new CanvasConflictError("Canvas changed. Reload settings and try again.");
    }
    const scaleX = input.width / current.canvasWidth;
    const scaleY = input.height / current.canvasHeight;
    if (input.mode === "scale") {
      const beforePreview = await sceneSnapshot(tx, channelId, "preview");
      const beforeLive = await sceneSnapshot(tx, channelId, "live");
      const previews = await tx.previewElement.findMany({ where: { streamerId: channelId } });
      const live = await tx.liveInstance.findMany({ where: { streamerId: channelId } });
      for (const row of previews) {
        await tx.previewElement.update({ where: { id: row.id }, data: scaledBounds(row, scaleX, scaleY) });
      }
      for (const row of live) {
        await tx.liveInstance.update({ where: { id: row.id }, data: scaledBounds(row, scaleX, scaleY) });
      }
      assertSceneBudgetChange(beforePreview, await sceneSnapshot(tx, channelId, "preview"), "preview");
      assertSceneBudgetChange(beforeLive, await sceneSnapshot(tx, channelId, "live"), "live");
    }
    let settings: Record<string, unknown>;
    try { settings = JSON.parse(current.settingsJson) as Record<string, unknown>; }
    catch { throw new CanvasGeometryError("Channel settings are invalid"); }
    const updated = await tx.streamer.update({
      where: { id: channelId }, data: { canvasWidth: input.width, canvasHeight: input.height,
        settingsJson: JSON.stringify({ ...settings, canvasRevision: crypto.randomUUID() }) }
    });
    await tx.auditLog.create({ data: {
      streamerId: channelId, userId, action: "canvas.settings_changed",
      metadataJson: JSON.stringify({ from: [current.canvasWidth, current.canvasHeight], to: [input.width, input.height], mode: input.mode })
    } });
    return updated;
  }, { isolationLevel: "Serializable", timeout: 30_000 }));
}
