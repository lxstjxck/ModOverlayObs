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

export function seekMediaNode(node: PlayableNode | null, seconds: number): void {
  if (!node || !Number.isFinite(seconds)) return;
  const time = Math.max(0, seconds);
  if (node instanceof HTMLMediaElement) {
    node.currentTime = time;
  } else {
    sendYouTubeCommand(node, "seekTo", [time, true]);
  }
}

export function observeYouTubeTime(
  frame: HTMLIFrameElement,
  onTime: (time: { current: number; duration: number }) => void
): () => void {
  let current = 0;
  let duration = 0;
  const listen = () =>
    frame.contentWindow?.postMessage(
      JSON.stringify({ event: "listening", id: "overlay-time" }),
      "https://www.youtube.com"
    );
  const receive = (event: MessageEvent) => {
    if (event.origin !== "https://www.youtube.com" || event.source !== frame.contentWindow) return;
    try {
      const data = typeof event.data === "string" ? JSON.parse(event.data) : event.data;
      if (data?.event !== "infoDelivery" || !data.info) return;
      if (Number.isFinite(data.info.currentTime)) current = Math.max(0, data.info.currentTime);
      if (Number.isFinite(data.info.duration)) duration = Math.max(0, data.info.duration);
      onTime({ current, duration });
    } catch {
      /* Ignore unrelated player messages. */
    }
  };
  window.addEventListener("message", receive);
  frame.addEventListener("load", listen);
  const timer = window.setInterval(listen, 1000);
  listen();
  return () => {
    window.removeEventListener("message", receive);
    frame.removeEventListener("load", listen);
    window.clearInterval(timer);
  };
}
