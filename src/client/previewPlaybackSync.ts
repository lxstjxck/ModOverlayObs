import type { MediaStatus } from "../shared/mediaStatus";

export type PreviewAction = "seek" | "play" | "pause";

export function previewSyncActions(
  status: MediaStatus,
  local: { position: number; state: string },
  initialized: boolean,
  now: number
): PreviewAction[] {
  if (now - status.observedAt >= 5000 || status.player !== "youtube" ||
      (status.state !== "PLAYING" && status.state !== "PAUSED")) return [];
  const target = status.position + (status.state === "PLAYING"
    ? Math.min(5, Math.max(0, now - status.observedAt) / 1000) : 0);
  const actions: PreviewAction[] = [];
  if (status.duration > 0 && (!initialized ||
      (local.state === status.state && Math.abs(local.position - target) > 2.5))) actions.push("seek");
  if (status.state === "PLAYING" && local.state !== "PLAYING" && local.state !== "BUFFERING") actions.push("play");
  if (status.state === "PAUSED" && local.state !== "PAUSED") actions.push("pause");
  return actions;
}

export function previewTargetPosition(status: MediaStatus, now: number): number {
  return Math.min(status.duration || 86400, 86400, status.position + (status.state === "PLAYING"
    ? Math.min(5, Math.max(0, now - status.observedAt) / 1000) : 0));
}
