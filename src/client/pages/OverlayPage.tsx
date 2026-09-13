import { useEffect, useMemo, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import type { OverlayElement, StreamerView } from "../../shared/types";
import { CanvasStage } from "../components/CanvasStage";
import {
  isPlayableNode,
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
    socket.on("overlay:state", (state: OverlayElement[]) => setCanvas(state));
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

  const onAirElements = useMemo(
    () => canvas.filter((element) => isElementInViewport(element, defaultStreamer)),
    [canvas]
  );

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
        elements={onAirElements}
        zoom="fit"
      />
    </main>
  );
}

function getPlayableMedia(id: string): PlayableNode | null {
  const node = document.querySelector(`[data-overlay-media-id="${CSS.escape(id)}"]`);
  return isPlayableNode(node) ? node : null;
}

function applyPlaybackCommand(
  element: OverlayElement,
  media: PlayableNode,
  applied: Map<string, string>
): void {
  const command = element.props.playbackCommand;
  const commandId = element.props.playbackCommandId;
  if (
    (command !== "play" && command !== "pause" && command !== "stop" && command !== "restart") ||
    (typeof commandId !== "string" && typeof commandId !== "number")
  ) {
    return;
  }
  const key = String(commandId);
  if (applied.get(element.id) === key) {
    return;
  }
  applied.set(element.id, key);
  if (command === "play") {
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
