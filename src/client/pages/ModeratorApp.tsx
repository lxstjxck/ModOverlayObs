import {
  AlertTriangle,
  ClipboardList,
  LogOut,
  Monitor,
  RefreshCw,
  ShieldCheck
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import type {
  MediaItem,
  MediaType,
  OverlayElement,
  PermissionMap,
  PresenceState,
  StreamerView,
  UserView
} from "../../shared/types";
import { api, ApiError } from "../api";
import { appVersion } from "../appVersion";
import { CanvasStage } from "../components/CanvasStage";
import { LayersPanel } from "../components/LayersPanel";
import { MediaLibrary } from "../components/MediaLibrary";
import { PropertiesPanel } from "../components/PropertiesPanel";
import { reconcilePreview } from "../previewSync";

type ZoomValue = "fit" | 0.25 | 0.5 | 0.75 | 1;

interface MeResponse {
  user: UserView;
  streamer: StreamerView;
}

interface MediaResponse {
  media: MediaItem[];
}

export function ModeratorApp() {
  const [user, setUser] = useState<UserView | null>(null);
  const [streamer, setStreamer] = useState<StreamerView | null>(null);
  const [media, setMedia] = useState<MediaItem[]>([]);
  const [preview, setPreview] = useState<OverlayElement[]>([]);
  const [presence, setPresence] = useState<PresenceState>({
    overlayConnected: false,
    overlayCount: 0,
    moderators: []
  });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [zoom, setZoom] = useState<ZoomValue>("fit");
  const [error, setError] = useState("");
  const socketRef = useRef<Socket | null>(null);
  const pendingPreviewPatches = useRef(new Map<string, Partial<OverlayElement>>());
  const inFlightPreviewPatches = useRef(new Map<string, Partial<OverlayElement>>());
  const previewPatchTimers = useRef(new Map<string, number>());

  useEffect(() => {
    let cancelled = false;
    async function boot() {
      try {
        const me = await api<MeResponse>("/api/auth/me");
        if (cancelled) {
          return;
        }
        setUser(me.user);
        setStreamer(me.streamer);
        const mediaResult = await api<MediaResponse>("/api/media");
        setMedia(mediaResult.media);
      } catch (bootError) {
        if (bootError instanceof ApiError && bootError.status === 401) {
          window.location.href = "/login";
          return;
        }
        setError(bootError instanceof Error ? bootError.message : "Could not load app");
      }
    }
    void boot();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!user) {
      return undefined;
    }
    const socket = io({ path: "/socket.io" });
    socketRef.current = socket;
    socket.on("access:revoked", () => {
      window.location.href = "/login";
    });
    socket.on("preview:state", (state: OverlayElement[]) =>
      setPreview(
        reconcilePreview(state, inFlightPreviewPatches.current, pendingPreviewPatches.current)
      )
    );
    socket.on("disconnect", () => {
      for (const timer of previewPatchTimers.current.values()) window.clearTimeout(timer);
      previewPatchTimers.current.clear();
      pendingPreviewPatches.current.clear();
      inFlightPreviewPatches.current.clear();
      setError("Connection lost. Reconnecting; unconfirmed changes may not have been saved.");
    });
    socket.on("presence:update", (state: PresenceState) => setPresence(state));
    socket.on("app:error", (message: string) => setError(message));
    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [user]);

  useEffect(() => {
    return () => {
      for (const timer of previewPatchTimers.current.values()) {
        window.clearTimeout(timer);
      }
      previewPatchTimers.current.clear();
      pendingPreviewPatches.current.clear();
    };
  }, []);

  const permissions: PermissionMap | null = user?.permissions ?? null;
  const canEditCanvas = Boolean(permissions?.canEditPreview && permissions?.canPushLive);
  const selected = useMemo(
    () => preview.find((element) => element.id === selectedId) ?? null,
    [preview, selectedId]
  );

  useEffect(() => {
    if (selectedId && !preview.some((element) => element.id === selectedId)) {
      setSelectedId(null);
    }
  }, [preview, selectedId]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (
        target?.closest("input, textarea, select, [contenteditable=true]") ||
        (event.key !== "Delete" && event.key !== "Backspace") ||
        !selectedId
      ) {
        return;
      }
      event.preventDefault();
      emit("preview:remove", { id: selectedId });
      setSelectedId(null);
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedId]);

  if (!user || !streamer) {
    return (
      <main className="loading-page">
        <RefreshCw className="spin" size={24} />
        Loading Moderator Overlay
      </main>
    );
  }

  async function refreshMedia() {
    const mediaResult = await api<MediaResponse>("/api/media");
    setMedia(mediaResult.media);
  }

  async function uploadFiles(files: FileList | File[], addToCanvas = false) {
    setError("");
    for (const file of Array.from(files)) {
      const data = new FormData();
      data.append("file", file);
      try {
        const result = await api<{ media: MediaItem }>("/api/media", {
          method: "POST",
          body: data
        });
        setMedia((items) => [result.media, ...items]);
        if (addToCanvas) {
          emit("preview:add", { mediaId: result.media.id });
        }
      } catch (uploadError) {
        setError(uploadError instanceof Error ? uploadError.message : "Upload failed");
      }
    }
  }

  async function addMediaUrl(payload: { url: string; type: MediaType; name?: string }) {
    setError("");
    try {
      const result = await api<{ media: MediaItem }>("/api/media/url", {
        method: "POST",
        body: JSON.stringify(payload)
      });
      setMedia((items) => [result.media, ...items]);
      emit("preview:add", { mediaId: result.media.id });
    } catch (urlError) {
      setError(urlError instanceof Error ? urlError.message : "Could not add media URL");
    }
  }

  function emit(event: string, payload?: unknown) {
    if (event.startsWith("preview:") && !canEditCanvas) {
      setError("Canvas editing requires permission to edit and control the live overlay.");
      return;
    }
    socketRef.current?.emit(event, payload);
  }

  function patchPreviewLocal(id: string, patch: Partial<OverlayElement>) {
    if (!canEditCanvas) {
      setError("Canvas editing requires permission to edit and control the live overlay.");
      return;
    }
    if (!socketRef.current?.connected) {
      setError("No server connection. Wait for reconnection before editing.");
      return;
    }
    setPreview((items) =>
      items.map((item) => (item.id === id ? mergeElementPatch(item, patch) : item))
    );
    schedulePreviewPatch(id, patch);
  }

  function schedulePreviewPatch(id: string, patch: Partial<OverlayElement>) {
    const existing = pendingPreviewPatches.current.get(id);
    pendingPreviewPatches.current.set(id, existing ? mergePatch(existing, patch) : patch);
    schedulePreviewFlush(id);
  }

  function schedulePreviewFlush(id: string) {
    if (previewPatchTimers.current.has(id)) {
      return;
    }
    const timer = window.setTimeout(() => {
      previewPatchTimers.current.delete(id);
      if (inFlightPreviewPatches.current.has(id)) return;
      const nextPatch = pendingPreviewPatches.current.get(id);
      pendingPreviewPatches.current.delete(id);
      const socket = socketRef.current;
      if (nextPatch && socket?.connected) {
        inFlightPreviewPatches.current.set(id, nextPatch);
        socket
          .timeout(10000)
          .emit("preview:update", { id, patch: nextPatch }, (error: Error | null, ok: boolean) => {
            if (inFlightPreviewPatches.current.get(id) !== nextPatch) return;
            inFlightPreviewPatches.current.delete(id);
            if (error || !ok) {
              // Reload canonical state instead of silently keeping rejected optimistic edits.
              socket.disconnect().connect();
              setError("Could not save changes. Reloading canvas from the server.");
              return;
            }
            if (pendingPreviewPatches.current.has(id)) schedulePreviewFlush(id);
          });
      }
    }, 80);
    previewPatchTimers.current.set(id, timer);
  }

  async function deleteMedia(mediaId: string) {
    if (!window.confirm("Delete this media file?")) {
      return;
    }
    await api(`/api/media/${mediaId}`, { method: "DELETE" });
    await refreshMedia();
  }

  async function logout() {
    await api("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  }

  return (
    <main
      className="moderator-app"
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        if (event.dataTransfer.files.length > 0) {
          void uploadFiles(event.dataTransfer.files, true);
        }
      }}
    >
      <header className="topbar">
        <div className="topbar-brand">
          <ShieldCheck size={20} />
          <strong>Moderator Overlay</strong>
          <span className="app-version">v{appVersion}</span>
        </div>
        <div className={`presence ${presence.overlayConnected ? "online" : "offline"}`}>
          <Monitor size={16} />
          OBS {presence.overlayConnected ? "ONLINE" : "OFFLINE"}
        </div>
        <div className="presence">
          Mods: {presence.moderators.length}
          {presence.moderators.length > 0 && (
            <span className="moderator-names">
              {presence.moderators.map((moderator) => moderator.displayName).join(", ")}
            </span>
          )}
        </div>
        <div className="segmented">
          {(["fit", 0.25, 0.5, 0.75, 1] as const).map((item) => (
            <button
              type="button"
              className={zoom === item ? "active" : ""}
              key={item}
              onClick={() => setZoom(item)}
            >
              {item === "fit" ? "FIT" : `${item * 100}%`}
            </button>
          ))}
        </div>
        <button type="button" onClick={() => (window.location.href = "/obs-setup")}>
          <ClipboardList size={16} />
          OBS Setup
        </button>
        <button type="button" onClick={() => void logout()}>
          <LogOut size={16} />
        </button>
      </header>

      {error && (
        <div className="toast">
          <AlertTriangle size={16} />
          {error}
          <button type="button" onClick={() => setError("")}>
            x
          </button>
        </div>
      )}

      <div className="workspace">
        <MediaLibrary
          media={media}
          onUpload={(files) => void uploadFiles(files)}
          onAdd={(mediaId) => emit("preview:add", { mediaId })}
          onAddUrl={(payload) => void addMediaUrl(payload)}
          onDelete={(mediaId) => void deleteMedia(mediaId)}
          onAddText={() => emit("preview:add", { type: "TEXT", text: "New text" })}
          canDelete={permissions?.canDeleteMedia ?? false}
        />

        <CanvasStage
          mode="workspace"
          streamer={streamer}
          elements={preview}
          selectedId={selectedId}
          zoom={zoom}
          onSelect={(id) => setSelectedId(id || null)}
          onUpdate={canEditCanvas ? patchPreviewLocal : undefined}
        />

        <PropertiesPanel
          selected={selected}
          onUpdate={patchPreviewLocal}
          onDuplicate={() => selectedId && emit("preview:duplicate", { id: selectedId })}
          onRemove={() => selectedId && emit("preview:remove", { id: selectedId })}
        />
      </div>

      <footer className="bottom-panels single-panel">
        <details>
          <summary>Объекты на полотне ({preview.length})</summary>
          <LayersPanel
            title="Canvas Assets"
            elements={preview}
            selectedId={selectedId}
            onSelect={(id) => setSelectedId(id)}
            onToggle={(id, visible) => patchPreviewLocal(id, { visible })}
          />
        </details>
      </footer>
    </main>
  );
}

function mergeElementPatch(
  element: OverlayElement,
  patch: Partial<OverlayElement>
): OverlayElement {
  return {
    ...element,
    ...patch,
    props: patch.props ? patch.props : element.props
  };
}

function mergePatch(
  existing: Partial<OverlayElement>,
  patch: Partial<OverlayElement>
): Partial<OverlayElement> {
  return {
    ...existing,
    ...patch,
    ...(patch.props || existing.props ? { props: patch.props ?? existing.props } : {})
  };
}
