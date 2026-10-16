import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import type { ElementTransform, OverlayElement, StreamerView } from "../../shared/types";
import { CanvasStage } from "../components/CanvasStage";
import { cropClipPath, getCrop } from "../cropGeometry";
import { overlayMediaUrl } from "../overlayMediaUrl";
import {
  shouldClearOverlayOnConnectError,
  shouldClearOverlayOnDisconnect
} from "../overlayConnection";
import {
  isPlayableNode,
  seekMediaNode,
  pauseMediaNode,
  playMediaNode,
  restartMediaNode,
  runYouTubeCommand,
  setMediaNodeMuted,
  setMediaNodeVolume,
  stopMediaNode,
  type PlayableNode
} from "../mediaPlayback";
import { youtubeController } from "../youtubePlayer";

const defaultStreamer: StreamerView = {
  id: "overlay",
  displayName: "Overlay",
  canvasWidth: 1920,
  canvasHeight: 1080,
  canvasRevision: ""
};

export function OverlayPage({ token }: { token: string }) {
  const [canvas, setCanvas] = useState<OverlayElement[]>([]);
  const [streamer, setStreamer] = useState<StreamerView>(defaultStreamer);
  const streamerRef = useRef<StreamerView>(defaultStreamer);
  const socketRef = useRef<Socket | null>(null);
  const appliedCommandKeys = useRef(new Map<string, string>());
  const sourceKeys = useRef(new Map<string, string | null>());
  const canonicalCanvas = useRef<OverlayElement[]>([]);
  const onAirRef = useRef<OverlayElement[]>([]);
  const lastStatusSent = useRef(new Map<string, number>());

  const reportStatus = (id: string, force = false) => {
    const socket = socketRef.current;
    const media = getPlayableMedia(id);
    if (!socket?.connected || !media) return;
    const now = Date.now();
    if (!force && now - (lastStatusSent.current.get(id) ?? 0) < 1000) return;
    lastStatusSent.current.set(id, now);
    const details = media instanceof HTMLMediaElement ? {
      position: Number.isFinite(media.currentTime) ? Math.min(86400, Math.max(0, media.currentTime)) : 0,
      duration: Number.isFinite(media.duration) ? Math.min(86400, Math.max(0, media.duration)) : 0,
      playing: !media.paused && !media.ended,
      state: media.ended ? "ENDED" : media.readyState < 3 && !media.paused ? "BUFFERING" : media.paused ? "PAUSED" : "PLAYING",
      player: "html5",
      commandId: appliedCommandKeys.current.get(id) ?? null
    } : youtubeController(media)?.status();
    if (!details) return;
    socket.emit("media:status", {
      elementId: id,
      connectionId: socket.id,
      ...details
    });
  };

  useEffect(() => {
    document.documentElement.classList.add("overlay-document");
    document.body.classList.add("overlay-document");
    return () => {
      document.documentElement.classList.remove("overlay-document");
      document.body.classList.remove("overlay-document");
    };
  }, []);

  useEffect(() => {
    const storageKey = "lxst-overlay-reload-attempt";
    const pendingAttempt = window.sessionStorage.getItem(storageKey);
    const socket = io({
      path: "/socket.io",
      query: { overlayToken: token }
    });
    socketRef.current = socket;
    let ttsAudio: HTMLAudioElement | null = null;
    const stopTts = () => {
      ttsAudio?.pause();
      ttsAudio = null;
    };
    const clearCanvas = () => {
      stopTts();
      setCanvas([]);
      canonicalCanvas.current = [];
      appliedCommandKeys.current.clear();
      sourceKeys.current.clear();
      lastStatusSent.current.clear();
      setStreamer(defaultStreamer);
      streamerRef.current = defaultStreamer;
    };
    socket.on("canvas:state", (value: StreamerView) => {
      streamerRef.current = value;
      setStreamer(value);
    });
    socket.on("connect", () => {
      window.setTimeout(() => {
        for (const element of onAirRef.current) reportStatus(element.id, true);
      }, 0);
    });
    socket.on("access:revoked", clearCanvas);
    socket.on("disconnect", (reason) => {
      stopTts();
      if (shouldClearOverlayOnDisconnect(reason)) clearCanvas();
    });
    socket.on("connect_error", (error: Error) => {
      if (shouldClearOverlayOnConnectError(error.message)) clearCanvas();
    });
    socket.on("overlay:state", (state: OverlayElement[]) => {
      canonicalCanvas.current = state;
      const ids = new Set(state.map((element) => element.id));
      for (const id of appliedCommandKeys.current.keys()) if (!ids.has(id)) appliedCommandKeys.current.delete(id);
      for (const id of sourceKeys.current.keys()) if (!ids.has(id)) sourceKeys.current.delete(id);
      for (const id of lastStatusSent.current.keys()) if (!ids.has(id)) lastStatusSent.current.delete(id);
      setCanvas(state);
      window.setTimeout(() => {
        for (const element of state) reportStatus(element.id, true);
      }, 0);
      if (pendingAttempt) {
        socket.emit("overlay:reload:ready", { attemptId: pendingAttempt });
        window.sessionStorage.removeItem(storageKey);
      }
    });
    socket.on("overlay:reload", (payload: { attemptId?: unknown }, acknowledge?: () => void) => {
      if (typeof payload?.attemptId !== "string") return;
      window.sessionStorage.setItem(storageKey, payload.attemptId);
      acknowledge?.();
      window.setTimeout(() => window.location.reload(), 100);
    });
    socket.on("overlay:transform", (transform: ElementTransform) => {
      const base = canonicalCanvas.current.find((item) => item.id === transform.id);
      const node = getStageElement(transform.id);
      const stage = node?.closest<HTMLElement>(".stage-surface");
      if (!base || !node || !stage) return;
      const dx =
        (((transform.x ?? base.x) - base.x) * stage.clientWidth) / streamerRef.current.canvasWidth;
      const dy =
        (((transform.y ?? base.y) - base.y) * stage.clientHeight) / streamerRef.current.canvasHeight;
      node.style.transition = "transform 25ms linear, width 25ms linear, height 25ms linear";
      node.style.transform = `translate3d(${dx}px, ${dy}px, 0) rotate(${transform.rotation ?? base.rotation}deg)`;
      if (transform.width !== undefined)
        node.style.width = `${(transform.width / streamerRef.current.canvasWidth) * 100}%`;
      if (transform.height !== undefined)
        node.style.height = `${(transform.height / streamerRef.current.canvasHeight) * 100}%`;
      if (transform.crop) {
        const media = node.querySelector<HTMLElement>(".media-element");
        if (media)
          media.style.clipPath = cropClipPath(
            transform.crop,
            transform.width ?? base.width,
            transform.height ?? base.height
          );
      }
    });
    socket.on("overlay:add", (element: OverlayElement) =>
      setCanvas((items) => [...items.filter((item) => item.id !== element.id), element])
    );
    socket.on("overlay:update", (element: OverlayElement) =>
      setCanvas((items) => items.map((item) => (item.id === element.id ? element : item)))
    );
    socket.on("overlay:remove", ({ id }: { id: string }) => {
      appliedCommandKeys.current.delete(id);
      sourceKeys.current.delete(id);
      lastStatusSent.current.delete(id);
      setCanvas((items) => items.filter((item) => item.id !== id));
    });
    socket.on("overlay:clear", () => {
      appliedCommandKeys.current.clear();
      sourceKeys.current.clear();
      lastStatusSent.current.clear();
      setCanvas([]);
    });
    for (const [eventName, command] of [["video:play", "play"], ["video:pause", "pause"], ["video:stop", "stop"], ["video:restart", "restart"]] as const) {
      socket.on(eventName, ({ id, commandId }: { id: string; commandId?: string }) => {
        if (commandId && appliedCommandKeys.current.get(id) === commandId) return;
        const media = getPlayableMedia(id);
        if (!media) return;
        if (media instanceof HTMLIFrameElement && commandId) {
          if (!runYouTubeCommand(media, command, commandId)) return;
        } else runPlaybackCommand(command, media);
        if (commandId) appliedCommandKeys.current.set(id, commandId);
        window.setTimeout(() => reportStatus(id, true), 100);
      });
    }
    socket.on("tts:play", ({ id, url }: { id: string; url: string }) => {
      stopTts();
      if (!url.startsWith("/api/tts/audio/") || !/^[A-Za-z0-9_-]{43}$/.test(id)) return;
      const audio = new Audio(url);
      ttsAudio = audio;
      audio.addEventListener("ended", () => {
        if (ttsAudio === audio) {
          ttsAudio = null;
          socket.emit("tts:done", { id });
        }
      });
      audio.addEventListener("error", () => {
        if (ttsAudio === audio) {
          ttsAudio = null;
          socket.emit("tts:error", { id });
        }
      });
      void audio.play().catch(() => {
        if (ttsAudio === audio) {
          ttsAudio = null;
          socket.emit("tts:error", { id });
        }
      });
    });
    return () => {
      stopTts();
      socket.disconnect();
      socketRef.current = null;
    };
  }, [token]);

  const displayElements = useMemo(
    () => canvas.map((element) => ({ ...element, src: overlayMediaUrl(element.src, token) })),
    [canvas, token]
  );
  const onAirElements = useMemo(
    () => displayElements.filter((element) => isElementInViewport(element, streamer)),
    [displayElements, streamer]
  );
  onAirRef.current = onAirElements;

  useLayoutEffect(() => {
    for (const element of displayElements) {
      const node = getStageElement(element.id);
      if (!node) continue;
      node.style.transition = "";
      node.style.transform = `rotate(${element.rotation}deg)`;
      node.style.width = `${(element.width / streamer.canvasWidth) * 100}%`;
      node.style.height = `${(element.height / streamer.canvasHeight) * 100}%`;
      const media = node.querySelector<HTMLElement>(".media-element");
      if (media) {
        media.style.clipPath = cropClipPath(getCrop(element), element.width, element.height);
      }
    }
  }, [displayElements, streamer]);

  useEffect(() => {
    for (const element of onAirElements) {
      if (element.type !== "VIDEO" && element.type !== "AUDIO") {
        continue;
      }
      const media = getPlayableMedia(element.id);
      if (media) {
        if (sourceKeys.current.has(element.id) && sourceKeys.current.get(element.id) !== (element.src ?? null)) {
          appliedCommandKeys.current.delete(element.id);
        }
        sourceKeys.current.set(element.id, element.src ?? null);
        setMediaNodeVolume(media, element.liveVolume);
        setMediaNodeMuted(media, element.muted);
        applyPlaybackCommand(element, media, appliedCommandKeys.current);
        reportStatus(element.id);
      }
    }
  }, [onAirElements]);

  useEffect(() => {
    const disposers: Array<() => void> = [];
    for (const element of onAirElements) {
      const media = getPlayableMedia(element.id);
      const report = () => reportStatus(element.id, true);
      if (media instanceof HTMLIFrameElement) {
        media.addEventListener("youtube:status", report);
        disposers.push(() => media.removeEventListener("youtube:status", report));
        continue;
      }
      if (!(media instanceof HTMLMediaElement)) continue;
      const tick = () => reportStatus(element.id);
      for (const name of ["play", "pause", "seeked", "loadedmetadata", "durationchange", "ended"]) {
        media.addEventListener(name, report);
        disposers.push(() => media.removeEventListener(name, report));
      }
      media.addEventListener("timeupdate", tick);
      disposers.push(() => media.removeEventListener("timeupdate", tick));
    }
    const timer = window.setInterval(() => {
      for (const element of onAirRef.current) {
        if (getPlayableMedia(element.id) instanceof HTMLMediaElement) reportStatus(element.id);
      }
    }, 1000);
    return () => {
      disposers.forEach((dispose) => dispose());
      window.clearInterval(timer);
    };
  }, [onAirElements]);

  return (
    <main className="overlay-page">
      <CanvasStage mode="overlay" streamer={streamer} elements={displayElements} />
    </main>
  );
}

function getPlayableMedia(id: string): PlayableNode | null {
  const node = document.querySelector(`[data-overlay-media-id="${CSS.escape(id)}"]`);
  return isPlayableNode(node) ? node : null;
}

function getStageElement(id: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(
    `.stage-overlay [data-stage-element-id="${CSS.escape(id)}"]`
  );
}

export function applyPlaybackCommand(
  element: OverlayElement,
  media: PlayableNode,
  applied: Map<string, string>
): void {
  const command = element.props.playbackCommand;
  const commandId = element.props.playbackCommandId;
  if (
    (command !== "play" &&
      command !== "pause" &&
      command !== "stop" &&
      command !== "restart" &&
      command !== "seek") ||
    (typeof commandId !== "string" && typeof commandId !== "number")
  ) {
    return;
  }
  const key = String(commandId);
  if (applied.get(element.id) === key) {
    return;
  }
  if (typeof HTMLIFrameElement !== "undefined" && media instanceof HTMLIFrameElement) {
    if (runYouTubeCommand(media, command, key, command === "seek" ? element.props.seekSeconds as number : undefined)) {
      applied.set(element.id, key);
    }
    return;
  }
  applied.set(element.id, key);
  if (command === "seek") {
    const seconds = element.props.seekSeconds;
    if (typeof seconds === "number") seekMediaNode(media, seconds);
  } else {
    runPlaybackCommand(command, media);
  }
}

function runPlaybackCommand(command: "play" | "pause" | "stop" | "restart", media: PlayableNode): void {
  if (command === "play") playMediaNode(media);
  else if (command === "pause") pauseMediaNode(media);
  else if (command === "stop") stopMediaNode(media);
  else restartMediaNode(media);
}

function isElementInViewport(element: OverlayElement, streamer: StreamerView): boolean {
  return (
    element.x + element.width > 0 &&
    element.y + element.height > 0 &&
    element.x < streamer.canvasWidth &&
    element.y < streamer.canvasHeight
  );
}
