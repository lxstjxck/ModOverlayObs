export type PlayableNode = HTMLMediaElement | HTMLIFrameElement;

export function isPlayableNode(value: Element | null): value is PlayableNode {
  return value instanceof HTMLMediaElement || value instanceof HTMLIFrameElement;
}

export function playMediaNode(node: PlayableNode | null): void {
  if (!node) {
    return;
  }
  if (node instanceof HTMLMediaElement) {
    void node.play();
    return;
  }
  sendYouTubeCommand(node, "playVideo");
}

export function pauseMediaNode(node: PlayableNode | null): void {
  if (!node) {
    return;
  }
  if (node instanceof HTMLMediaElement) {
    node.pause();
    return;
  }
  sendYouTubeCommand(node, "pauseVideo");
}

export function restartMediaNode(node: PlayableNode | null): void {
  if (!node) {
    return;
  }
  if (node instanceof HTMLMediaElement) {
    node.currentTime = 0;
    void node.play();
    return;
  }
  sendYouTubeCommand(node, "seekTo", [0, true]);
  sendYouTubeCommand(node, "playVideo");
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
  sendYouTubeCommand(node, "stopVideo");
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
  sendYouTubeCommand(node, "setVolume", [Math.round(safeVolume * 100)]);
}

export function setMediaNodeMuted(node: PlayableNode | null, muted: boolean): void {
  if (!node) {
    return;
  }
  if (node instanceof HTMLMediaElement) {
    node.muted = muted;
    return;
  }
  sendYouTubeCommand(node, muted ? "mute" : "unMute");
}

function sendYouTubeCommand(frame: HTMLIFrameElement, func: string, args: unknown[] = []): void {
  if (!frame.src.includes("youtube.com/embed/") || !frame.contentWindow) {
    return;
  }
  const payload = JSON.stringify({
    event: "command",
    func,
    args
  });
  for (const delay of [0, 250, 750]) {
    window.setTimeout(() => {
      frame.contentWindow?.postMessage(payload, "https://www.youtube.com");
    }, delay);
  }
}
