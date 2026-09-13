import type { OverlayElement } from "./types";

export function clonePreviewElementToLive(
  preview: OverlayElement,
  liveId: string,
  now: Date
): OverlayElement {
  const startedAt = now.toISOString();
  const endsAt =
    preview.durationMs && Number.isFinite(preview.durationMs)
      ? new Date(now.getTime() + preview.durationMs).toISOString()
      : null;

  return {
    ...preview,
    id: liveId,
    previewElementId: preview.id,
    previewVolume: undefined,
    startedAt,
    endsAt,
    startTime: preview.startTime ?? 0
  };
}
