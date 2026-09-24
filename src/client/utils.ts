import type { OverlayElement } from "../shared/types";

export function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function formatDuration(ms: number | null | undefined): string {
  if (!ms) {
    return "infinite";
  }
  const seconds = Math.round(ms / 1000);
  return `${seconds}s`;
}

export function formatClock(seconds: number): string {
  if (!Number.isFinite(seconds)) {
    return "00:00";
  }
  const safe = Math.max(0, Math.floor(seconds));
  const mins = Math.floor(safe / 60)
    .toString()
    .padStart(2, "0");
  const secs = (safe % 60).toString().padStart(2, "0");
  return `${mins}:${secs}`;
}

export function sortElements(elements: OverlayElement[]): OverlayElement[] {
  return [...elements].sort((a, b) => a.zIndex - b.zIndex || a.id.localeCompare(b.id));
}

export function isVideo(element: OverlayElement | null | undefined): boolean {
  return element?.type === "VIDEO";
}

export function isAudio(element: OverlayElement | null | undefined): boolean {
  return element?.type === "AUDIO";
}

export function isPlayableMedia(element: OverlayElement | null | undefined): boolean {
  return element?.type === "VIDEO" || element?.type === "AUDIO";
}

export function isText(element: OverlayElement | null | undefined): boolean {
  return element?.type === "TEXT";
}
