import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import type { ElementTransform, OverlayElement, StreamerView } from "../../shared/types";
import { CanvasStage } from "../components/CanvasStage";
import { overlayMediaUrl } from "../overlayMediaUrl";
import {
  isPlayableNode,
  seekMediaNode,
  pauseMediaNode,
  playMediaNode,
  restartMediaNode,
  setMediaNodeMuted,
  setMediaNodeVolume,
  stopMediaNode,
  type PlayableNode
} from "../mediaPlayback";

const defaultStreamer: StreamerView = {
  id: "overlay",
  displayName: "Overlay",
  canvasWidth: 1920,
  canvasHeight: 1080
};

export function OverlayPage({ token }: { token: string }) {
  const [canvas, setCanvas] = useState<OverlayElement[]>([]);
  const socketRef = useRef<Socket | null>(null);
  const appliedCommandKeys = useRef(new Map<string, string>());
  const canonicalCanvas = useRef<OverlayElement[]>([]);

  useEffect(() => {
    document.documentElement.classList.add("overlay-document");
    document.body.classList.add("overlay-document");
    return () => {
      document.documentElement.classList.remove("overlay-document");
      document.body.classList.remove("overlay-document");
    };
  }, []);

  useEffect(() => {
    const socket = io({
      path: "/socket.io",
      query: { overlayToken: token }
    });
    socketRef.current = socket;
    const clearCanvas = () => {
      setCanvas([]);
      canonicalCanvas.current = [];
      appliedCommandKeys.current.clear();
    };
    socket.on("access:revoked", clearCanvas);
    socket.on("disconnect", clearCanvas);
    socket.on("connect_error", clearCanvas);
    socket.on("overlay:state", (state: OverlayElement[]) => {
      canonicalCanvas.current = state;
      setCanvas(state);
    });
    socket.on("overlay:transform", (transform: ElementTransform) => {
      const base = canonicalCanvas.current.find((item) => item.id === transform.id);
      const node = getStageElement(transform.id);
      const stage = node?.closest<HTMLElement>(".stage-surface");
      if (!base || !node || !stage) return;
      const dx =
        (((transform.x ?? base.x) - base.x) * stage.clientWidth) / defaultStreamer.canvasWidth;
      const dy =
        (((transform.y ?? base.y) - base.y) * stage.clientHeight) / defaultStreamer.canvasHeight;
      node.style.transition = "transform 25ms linear, width 25ms linear, height 25ms linear";
      node.style.transform = `translate3d(${dx}px, ${dy}px, 0) rotate(${transform.rotation ?? base.rotation}deg)`;
      if (transform.width !== undefined)
        node.style.width = `${(transform.width / defaultStreamer.canvasWidth) * 100}%`;
      if (transform.height !== undefined)
        node.style.height = `${(transform.height / defaultStreamer.canvasHeight) * 100}%`;
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
    socket.on("overlay:remove", ({ id }: { id: string }) =>
      setCanvas((items) => items.filter((item) => item.id !== id))
    );
    socket.on("overlay:clear", () => setCanvas([]));
    socket.on("video:play", ({ id }: { id: string }) => playMediaNode(getPlayableMedia(id)));
    socket.on("video:pause", ({ id }: { id: string }) => pauseMediaNode(getPlayableMedia(id)));
    socket.on("video:stop", ({ id }: { id: string }) => stopMediaNode(getPlayableMedia(id)));
    socket.on("video:restart", ({ id }: { id: string }) => restartMediaNode(getPlayableMedia(id)));
    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [token]);

  const displayElements = useMemo(
    () => canvas.map((element) => ({ ...element, src: overlayMediaUrl(element.src, token) })),
    [canvas, token]
  );
  const onAirElements = useMemo(
    () => displayElements.filter((element) => isElementInViewport(element, defaultStreamer)),
    [displayElements]
  );

  useLayoutEffect(() => {
    for (const element of displayElements) {
      const node = getStageElement(element.id);
      if (!node) continue;
      node.style.transition = "";
      node.style.transform = `rotate(${element.rotation}deg)`;
      node.style.width = `${(element.width / defaultStreamer.canvasWidth) * 100}%`;
      node.style.height = `${(element.height / defaultStreamer.canvasHeight) * 100}%`;
      const media = node.querySelector<HTMLElement>(".media-element");
      if (media) {
        media.style.clipPath = cropClipPath(
          {
            left: Number(element.props.cropLeft) || 0,
            right: Number(element.props.cropRight) || 0,
            top: Number(element.props.cropTop) || 0,
            bottom: Number(element.props.cropBottom) || 0
          },
          element.width,
          element.height
        );
      }
    }
  }, [displayElements]);

  useEffect(() => {
    for (const element of onAirElements) {
      if (element.type !== "VIDEO" && element.type !== "AUDIO") {
        continue;
      }
      const media = getPlayableMedia(element.id);
      if (media) {
        setMediaNodeVolume(media, element.liveVolume);
        setMediaNodeMuted(media, element.muted);
        applyPlaybackCommand(element, media, appliedCommandKeys.current);
      }
    }
  }, [onAirElements]);

  return (
    <main className="overlay-page">
      <CanvasStage
        mode="overlay"
        streamer={defaultStreamer}
        elements={displayElements}
        zoom="fit"
      />
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

function cropClipPath(
  crop: NonNullable<ElementTransform["crop"]>,
  width: number,
  height: number
): string {
  return `inset(${(crop.top / height) * 100}% ${(crop.right / width) * 100}% ${(crop.bottom / height) * 100}% ${(crop.left / width) * 100}%)`;
}

function applyPlaybackCommand(
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
  applied.set(element.id, key);
  if (command === "seek") {
    const seconds = element.props.seekSeconds;
    if (typeof seconds === "number") seekMediaNode(media, seconds);
  } else if (command === "play") {
    playMediaNode(media);
  } else if (command === "pause") {
    pauseMediaNode(media);
  } else if (command === "stop") {
    stopMediaNode(media);
  } else {
    restartMediaNode(media);
  }
}

function isElementInViewport(element: OverlayElement, streamer: StreamerView): boolean {
  return (
    element.x + element.width > 0 &&
    element.y + element.height > 0 &&
    element.x < streamer.canvasWidth &&
    element.y < streamer.canvasHeight
  );
}
