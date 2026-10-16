import { youtubeController } from "./youtubePlayer";

export type PlayableNode = HTMLMediaElement | HTMLIFrameElement;

export function isPlayableNode(value: Element | null): value is PlayableNode {
  return value instanceof HTMLMediaElement || value instanceof HTMLIFrameElement;
}

export function playMediaNode(node: PlayableNode | null): void {
  if (!node) {
    return;
  }
  if (node instanceof HTMLMediaElement) {
    void node.play().catch(reportPlaybackFailure);
    return;
  }
  youtubeController(node)?.run("play");
}

export function pauseMediaNode(node: PlayableNode | null): void {
  if (!node) {
    return;
  }
  if (node instanceof HTMLMediaElement) {
    node.pause();
    return;
  }
  youtubeController(node)?.run("pause");
}

export function restartMediaNode(node: PlayableNode | null): void {
  if (!node) {
    return;
  }
  if (node instanceof HTMLMediaElement) {
    node.currentTime = 0;
    void node.play().catch(reportPlaybackFailure);
    return;
  }
  youtubeController(node)?.run("restart");
}

function reportPlaybackFailure(): void {
  // Do not log the media URL: protected uploads include an OBS token.
  console.warn("Media playback failed");
}

export function stopMediaNode(node: PlayableNode | null): void {
  if (!node) {
    return;
  }
  if (node instanceof HTMLMediaElement) {
    node.pause();
    node.currentTime = 0;
    return;
  }
  youtubeController(node)?.run("stop");
}

export function setMediaNodeVolume(node: PlayableNode | null, volume: number): void {
  if (!node) {
    return;
  }
  const safeVolume = Math.max(0, Math.min(1, volume));
  if (node instanceof HTMLMediaElement) {
    node.volume = safeVolume;
    return;
  }
  youtubeController(node)?.setVolume(safeVolume);
}

export function setMediaNodeMuted(node: PlayableNode | null, muted: boolean): void {
  if (!node) {
    return;
  }
  if (node instanceof HTMLMediaElement) {
    node.muted = muted;
    return;
  }
  youtubeController(node)?.setMuted(muted);
}

export function seekMediaNode(node: PlayableNode | null, seconds: number): void {
  if (!node || !Number.isFinite(seconds)) return;
  const time = Math.max(0, seconds);
  if (node instanceof HTMLMediaElement) {
    node.currentTime = time;
  } else {
    youtubeController(node)?.run("seek", null, time);
  }
}

export function observeYouTubeTime(
  frame: HTMLIFrameElement,
  onTime: (time: { current: number; duration: number }) => void
): () => void {
  return youtubeController(frame)?.subscribe(() => {
    const status = youtubeController(frame)?.status();
    if (status) onTime({ current: status.position, duration: status.duration });
  }) ?? (() => undefined);
}

export function runYouTubeCommand(frame: HTMLIFrameElement, command: "play" | "pause" | "stop" | "restart" | "seek", id: string, seconds?: number): boolean {
  const controller = youtubeController(frame);
  if (!controller) return false;
  controller.run(command, id, seconds);
  return true;
}
