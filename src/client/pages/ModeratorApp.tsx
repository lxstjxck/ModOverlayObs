import {
  AlertTriangle,
  LogOut,
  Monitor
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import type {
  MediaItem,
  MediaType,
  ChannelEmote,
  ElementTransform,
  OverlayElement,
  PermissionMap,
  PresenceState,
  SceneRepairNotice,
  StreamerView,
  UserView
} from "../../shared/types";
import { api, ApiError } from "../api";
import { appVersion } from "../appVersion";
import { CanvasStage } from "../components/CanvasStage";
import { BrandMark } from "../components/BrandMark";
import { LayersPanel } from "../components/LayersPanel";
import { MediaLibrary } from "../components/MediaLibrary";
import { EmotesPanel } from "../components/EmotesPanel";
import { PropertiesPanel } from "../components/PropertiesPanel";
import type { MediaStatus } from "../../shared/mediaStatus";
import { LoadingScreen } from "../components/ui/LoadingSpinner";
import { reconcilePreview } from "../previewSync";
import { fitInitialMediaDimensions, readMediaDimensions } from "../mediaDimensions";
import { layerOrderPatches, reversePatch, transformCommand } from "../canvasCommands";
import { isRenderableMediaUrl, unsafeMediaUrlMessage } from "../../shared/mediaUrl";

type HistoryChange = {
  id: string;
  before: Partial<OverlayElement>;
  after: Partial<OverlayElement>;
};
type HistoryEntry = { changes: HistoryChange[] };

interface MeResponse {
  user: UserView;
  streamer: StreamerView;
}

interface MediaResponse {
  media: MediaItem[];
}

export function EditorTopbar({
  streamer,
  user,
  path,
  overlayConnected,
  connectionIssue,
  onLogout
}: {
  streamer: StreamerView;
  user: UserView;
  path: string;
  overlayConnected: boolean;
  connectionIssue: boolean;
  onLogout: () => void;
}) {
  const channelEditor = path.startsWith("/channel/");
  const backLink = channelEditor ? (user.role === "OWNER" ? "/streamer" : "/channels") : "/obs-setup";
  const backLabel = channelEditor ? (user.role === "OWNER" ? "Панель управления" : "Мои каналы") : "OBS Setup";
  const twitchLogin = streamer.twitchLogin?.trim() || null;
  const moderatorLogin = user.twitchLogin?.trim();

  return (
    <header className="topbar">
      <div className="topbar-brand">
        <span className="brand-symbol">
          <BrandMark />
        </span>
        <span className="brand-copy">
          <strong>
            LXST <span>OVERLAY</span>
          </strong>
          <small>
            v{appVersion}
          </small>
        </span>
      </div>
      <div className="topbar-status">
        {connectionIssue && (
          <div className="presence server-presence offline" role="alert">
            <AlertTriangle size={16} aria-hidden="true" />
            <span className="presence-copy">
              <strong>Нет соединения. Переподключение…</strong>
            </span>
          </div>
        )}
        <div className={`presence obs-presence ${overlayConnected ? "online" : "offline"}`}>
          <span className="status-light" aria-hidden="true" />
          <span className="presence-copy">
            <strong>OBS {overlayConnected ? "ONLINE" : "OFFLINE"}</strong>
          </span>
        </div>
        <div className="presence channel-login-presence" title={twitchLogin ?? "Логин канала не указан"}>
          <span className="presence-copy">
            <strong>{twitchLogin ? `twitch: ${twitchLogin}` : "twitch: не указан"}</strong>
          </span>
        </div>
        {user.role !== "OWNER" && moderatorLogin && (
          <div className="presence moderator-login-presence" title={`moderator: ${moderatorLogin}`}>
            <span className="presence-copy">
              <strong>moderator: {moderatorLogin}</strong>
            </span>
          </div>
        )}
      </div>
      <div className="topbar-tools">
        <a className="setup-link" href={backLink}>
          {backLabel}
        </a>
        <button
          className="logout-button"
          type="button"
          title="Sign out"
          aria-label="Sign out"
          onClick={onLogout}
        >
          <LogOut size={16} />
        </button>
      </div>
    </header>
  );
}

export function ModeratorApp() {
  const [user, setUser] = useState<UserView | null>(null);
  const [streamer, setStreamer] = useState<StreamerView | null>(null);
  const [propertiesVisible, setPropertiesVisible] = useState(true);
  const [media, setMedia] = useState<MediaItem[]>([]);
  const [mediaStatuses, setMediaStatuses] = useState<MediaStatus[]>([]);
  const [selectedConnectionId, setSelectedConnectionId] = useState("");
  const [mediaLoading, setMediaLoading] = useState(true);
  const [uploadingCount, setUploadingCount] = useState(0);
  const [connected, setConnected] = useState(false);
  const [connectionIssue, setConnectionIssue] = useState(false);
  const [assetTab, setAssetTab] = useState<"media" | "emotes">("media");
  const [emotesOpened, setEmotesOpened] = useState(false);
  const [preview, setPreview] = useState<OverlayElement[]>([]);
  const [blockedLive, setBlockedLive] = useState<Array<{ id: string; name: string }>>([]);
  const [sceneRepair, setSceneRepair] = useState<Record<"preview" | "live", Array<{ id: string; name: string }>>>(
    { preview: [], live: [] }
  );
  const [presence, setPresence] = useState<PresenceState>({
    overlayConnected: false,
    overlayCount: 0,
    moderators: []
  });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  useEffect(() => {
    setSelectedConnectionId(streamer?.id
      ? window.sessionStorage.getItem(`lxst-obs-source:${streamer.id}`) ?? "" : "");
  }, [streamer?.id]);
  function selectConnection(id: string) {
    setSelectedConnectionId(id);
    if (streamer?.id) {
      const key = `lxst-obs-source:${streamer.id}`;
      if (id) window.sessionStorage.setItem(key, id);
      else window.sessionStorage.removeItem(key);
    }
  }
  const [error, setError] = useState("");
  const [mediaError, setMediaError] = useState("");
  const [mediaDeleteIds, setMediaDeleteIds] = useState<string[]>([]);
  const [deletingMedia, setDeletingMedia] = useState(false);
  const socketRef = useRef<Socket | null>(null);
  const canvasRevisionRef = useRef("");
  const canvasRefreshPending = useRef(false);
  const pendingPreviewPatches = useRef(new Map<string, Partial<OverlayElement>>());
  const inFlightPreviewPatches = useRef(new Map<string, Partial<OverlayElement>>());
  const previewPatchTimers = useRef(new Map<string, number>());
  const transientPatches = useRef(new Map<string, Partial<OverlayElement>>());
  const transformTimers = useRef(new Map<string, number>());
  const lastTransformSent = useRef(new Map<string, number>());
  const lastDebugPing = useRef(0);
  const previewRef = useRef<OverlayElement[]>([]);
  const editorActive = useRef(false);
  const copiedId = useRef<string | null>(null);
  const history = useRef<{ undo: HistoryEntry[]; redo: HistoryEntry[] }>({ undo: [], redo: [] });
  previewRef.current = preview;
  const blockedPreview = preview.filter((item) => item.type !== "TEXT" && !isRenderableMediaUrl(item.src));

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
        canvasRevisionRef.current = me.streamer.canvasRevision;
        try {
          const mediaResult = await api<MediaResponse>("/api/media");
          if (!cancelled) setMedia(mediaResult.media);
        } catch (mediaLoadError) {
          if (
            mediaLoadError instanceof ApiError &&
            (mediaLoadError.status === 401 || mediaLoadError.status === 403)
          )
            throw mediaLoadError;
          if (!cancelled)
            setMediaError(
              mediaLoadError instanceof Error
                ? mediaLoadError.message
                : "Не удалось загрузить медиа"
            );
        } finally {
          if (!cancelled) setMediaLoading(false);
        }
      } catch (bootError) {
        if (
          bootError instanceof ApiError &&
          (bootError.status === 401 ||
            (bootError.status === 403 && window.location.pathname.startsWith("/channel/")))
        ) {
          window.location.href = window.location.pathname.startsWith("/channel/")
            ? "/channels"
            : "/overlay";
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
    const channelId = /^\/channel\/([^/]+)$/.exec(window.location.pathname)?.[1];
    const socket = io({
      path: "/socket.io",
      query: channelId ? { channelId: decodeURIComponent(channelId) } : undefined
    });
    socketRef.current = socket;
    socket.on("canvas:state", (value: StreamerView) => {
      if (canvasRevisionRef.current !== value.canvasRevision) {
        canvasRefreshPending.current = true;
        history.current = { undo: [], redo: [] };
        for (const timer of previewPatchTimers.current.values()) window.clearTimeout(timer);
        previewPatchTimers.current.clear();
        pendingPreviewPatches.current.clear();
        inFlightPreviewPatches.current.clear();
        transientPatches.current.clear();
        for (const timer of transformTimers.current.values()) window.clearTimeout(timer);
        transformTimers.current.clear();
        setPreview([]);
      }
      canvasRevisionRef.current = value.canvasRevision;
      setStreamer(value);
    });
    socket.on("access:revoked", () => {
      window.location.href = channelId
        ? user.role === "OWNER"
          ? "/streamer"
          : "/channels"
        : "/overlay";
    });
    socket.on("preview:state", (state: OverlayElement[]) => {
      setSceneRepair((current) => ({ ...current, preview: [] }));
      canvasRefreshPending.current = false;
      if (
        previewRef.current.length > 0 &&
        (previewRef.current.length !== state.length ||
          previewRef.current.some((item) => !state.some((next) => next.id === item.id)))
      ) {
        history.current = { undo: [], redo: [] };
      }
      const reconciled = reconcilePreview(
        state,
        inFlightPreviewPatches.current,
        pendingPreviewPatches.current
      );
      setPreview(
        reconciled.map((item) => {
          const patch = transientPatches.current.get(item.id);
          return patch ? mergeElementPatch(item, patch) : item;
        })
      );
    });
    socket.on("preview:transform", (transform: ElementTransform) => {
      const { crop, ...geometry } = transform;
      setPreview((items) =>
        items.map((item) =>
          item.id === transform.id
            ? mergeElementPatch(item, {
                ...geometry,
                props: crop
                  ? {
                      ...item.props,
                      cropLeft: crop.left,
                      cropRight: crop.right,
                      cropTop: crop.top,
                      cropBottom: crop.bottom
                    }
                  : undefined
              })
            : item
        )
      );
    });
    socket.on("disconnect", () => {
      setMediaStatuses([]);
      setConnected(false);
      setConnectionIssue(true);
      history.current = { undo: [], redo: [] };
      for (const timer of previewPatchTimers.current.values()) window.clearTimeout(timer);
      previewPatchTimers.current.clear();
      pendingPreviewPatches.current.clear();
      inFlightPreviewPatches.current.clear();
      transientPatches.current.clear();
      for (const timer of transformTimers.current.values()) window.clearTimeout(timer);
      transformTimers.current.clear();
    });
    socket.on("connect_error", () => setConnectionIssue(true));
    socket.on("connect", () => {
      setConnected(true);
      setConnectionIssue(false);
      setError((current) =>
        current.startsWith("Connection lost.") || current.startsWith("Нет соединения с сервером.")
          ? ""
          : current
      );
    });
    socket.on("presence:update", (state: PresenceState) => setPresence(state));
    socket.on("media:statuses", (statuses: MediaStatus[]) =>
      setMediaStatuses(statuses.map((status) => ({ ...status, observedAt: Date.now() }))));
    socket.on("media:status", (status: MediaStatus) => {
      const received = { ...status, observedAt: Date.now() };
      setMediaStatuses((current) => [...current.filter((item) =>
        item.connectionId !== status.connectionId || item.elementId !== status.elementId
      ), received]);
    });
    socket.on("media:offline", ({ connectionId }: { connectionId: string }) => {
      setMediaStatuses((current) => current.filter((item) => item.connectionId !== connectionId));
    });
    socket.on("app:error", (message: string) => setError(message));
    socket.on("scene:repair", (notice: SceneRepairNotice) => {
      setSceneRepair((current) => ({ ...current, [notice.kind]: notice.items }));
      if (notice.kind === "live") setBlockedLive([]);
      if (notice.kind === "preview") {
        canvasRefreshPending.current = false;
        setPreview([]);
      }
      setError("Сцена слишком велика для безопасной передачи. Владелец может удалить лишние элементы ниже.");
    });
    socket.on("live:state", (state: OverlayElement[]) => {
      setSceneRepair((current) => ({ ...current, live: [] }));
      setBlockedLive(state.filter((item) => item.type !== "TEXT" && !isRenderableMediaUrl(item.src)));
    });
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
      for (const timer of transformTimers.current.values()) window.clearTimeout(timer);
      transformTimers.current.clear();
      transientPatches.current.clear();
    };
  }, []);

  const permissions: PermissionMap | null = user?.permissions ?? null;
  const canEditCanvas = Boolean(permissions?.canEditPreview && permissions?.canPushLive);
  const selected = useMemo(
    () => preview.find((element) => element.id === selectedId) ?? null,
    [preview, selectedId]
  );
  const previewConnectionId = selectedConnectionId || mediaStatuses
    .filter((status) => status.elementId === selectedId && Date.now() - status.observedAt < 5000)
    .sort((a, b) => a.connectionId.localeCompare(b.connectionId))[0]?.connectionId || "";

  useEffect(() => {
    if (selectedId && !preview.some((element) => element.id === selectedId)) {
      setSelectedId(null);
    }
  }, [preview, selectedId]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (
        !editorActive.current ||
        !canEditCanvas ||
        !streamer ||
        target?.closest("input, textarea, select, [contenteditable=true], [role=dialog]") ||
        event.altKey ||
        event.metaKey
      )
        return;
      const selected = previewRef.current.find((item) => item.id === selectedId);
      const ctrl = event.ctrlKey;
      const key = event.key.toLowerCase();
      if (ctrl && key === "z") {
        event.preventDefault();
        runHistory(event.shiftKey ? "redo" : "undo");
        return;
      }
      if (ctrl && key === "v" && copiedId.current) {
        event.preventDefault();
        if (previewRef.current.some((item) => item.id === copiedId.current)) {
          history.current = { undo: [], redo: [] };
          emit("preview:duplicate", { id: copiedId.current });
        }
        return;
      }
      if (!selected) return;
      if (ctrl && key === "c") {
        event.preventDefault();
        copiedId.current = selected.id;
        return;
      }
      if (!ctrl && (key === "delete" || key === "backspace")) {
        event.preventDefault();
        history.current = { undo: [], redo: [] };
        emit("preview:remove", { id: selected.id });
        setSelectedId(null);
        return;
      }
      if (!ctrl && ["arrowleft", "arrowright", "arrowup", "arrowdown"].includes(key)) {
        event.preventDefault();
        patchPreviewLocal(selected.id, {
          x: selected.x + (key === "arrowleft" ? -1 : key === "arrowright" ? 1 : 0),
          y: selected.y + (key === "arrowup" ? -1 : key === "arrowdown" ? 1 : 0)
        });
        return;
      }
      if (!ctrl) return;
      if (key === "e") {
        event.preventDefault();
        document.querySelector<HTMLInputElement>("[data-transform-focus=true]")?.focus();
        return;
      }
      const command =
        key === "r"
          ? "reset"
          : key === "f"
            ? "fit"
            : key === "s"
              ? "stretch"
              : key === "d"
                ? "center"
                : null;
      if (command) {
        event.preventDefault();
        patchPreviewLocal(
          selected.id,
          transformCommand(
            selected,
            streamer,
            command,
            media.find((item) => item.id === selected.mediaId)
          )
        );
        return;
      }
      const direction =
        key === "arrowup"
          ? "up"
          : key === "arrowdown"
            ? "down"
            : key === "home"
              ? "top"
              : key === "end"
                ? "bottom"
                : null;
      if (direction) {
        event.preventDefault();
        const patches = layerOrderPatches(previewRef.current, selected.id, direction);
        if (patches.length > 0) {
          const changes = patches.flatMap(({ id, zIndex }) => {
            const current = previewRef.current.find((item) => item.id === id);
            return current && current.zIndex !== zIndex
              ? [{ id, before: { zIndex: current.zIndex }, after: { zIndex } }]
              : [];
          });
          if (changes.length > 0) {
            recordHistory({ changes });
            for (const change of changes)
              patchPreviewLocal(change.id, change.after, undefined, false);
          }
        }
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedId, canEditCanvas, streamer, media]);

  useEffect(() => {
    if (mediaDeleteIds.length === 0) return;
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape" && !deletingMedia) setMediaDeleteIds([]);
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [mediaDeleteIds.length, deletingMedia]);

  if (!user || !streamer) {
    if (!error) return <LoadingScreen message="Загружаем LXST Overlay…" />;
    return <main className="lxst-loading-screen">
      <div className="error-box" role="alert">{error}</div>
      <button type="button" onClick={() => window.location.reload()}>Повторить загрузку</button>
    </main>;
  }

  async function refreshMedia() {
    const mediaResult = await api<MediaResponse>("/api/media");
    setMedia(mediaResult.media);
  }

  async function addMediaToCanvas(item: MediaItem) {
    try {
      const dimensions = await readMediaDimensions(item);
      emit("preview:add", {
        mediaId: item.id,
        ...(dimensions && streamer
          ? fitInitialMediaDimensions(dimensions, streamer.canvasWidth, streamer.canvasHeight)
          : {})
      });
    } catch (sizeError) {
      setError(sizeError instanceof Error ? sizeError.message : "Could not read media dimensions");
    }
  }

  async function uploadFiles(files: FileList | File[], addToCanvas = false) {
    setError("");
    setMediaError("");
    for (const file of Array.from(files)) {
      const data = new FormData();
      data.append("file", file);
      setUploadingCount((count) => count + 1);
      try {
        const result = await api<{ media: MediaItem }>("/api/media", {
          method: "POST",
          body: data
        });
        setMedia((items) => [result.media, ...items]);
        if (addToCanvas) {
          await addMediaToCanvas(result.media);
        }
      } catch (uploadError) {
        const message =
          uploadError instanceof Error ? uploadError.message : "Не удалось загрузить файл";
        setError(message);
        setMediaError(message);
      } finally {
        setUploadingCount((count) => count - 1);
      }
    }
  }

  async function addMediaUrl(payload: {
    url: string;
    type?: MediaType;
    name?: string;
  }): Promise<boolean> {
    setError("");
    setMediaError("");
    try {
      const result = await api<{ media: MediaItem }>("/api/media/url", {
        method: "POST",
        body: JSON.stringify(payload)
      });
      setMedia((items) => [result.media, ...items]);
      await addMediaToCanvas(result.media);
      return true;
    } catch (urlError) {
      const message = urlError instanceof Error ? urlError.message : "Не удалось добавить ссылку";
      setError(message);
      setMediaError(message);
      return false;
    }
  }

  function emit(event: string, payload?: unknown) {
    if (event.startsWith("preview:") && !canEditCanvas) {
      setError("Canvas editing requires permission to edit and control the live overlay.");
      return;
    }
    if (event.startsWith("preview:") && !socketRef.current?.connected) {
      setError("Нет соединения с сервером. Дождитесь восстановления перед изменением холста.");
      return;
    }
    if (canvasRefreshPending.current) return;
    if (
      ["preview:add", "preview:duplicate", "preview:remove"].includes(event) &&
      payload &&
      typeof payload === "object"
    ) {
      socketRef.current?.emit(event, { ...payload, revision: canvasRevisionRef.current });
    } else socketRef.current?.emit(event, payload);
  }

  function recordHistory(entry: HistoryEntry) {
    history.current.undo.push(entry);
    if (history.current.undo.length > 100) history.current.undo.shift();
    history.current.redo = [];
  }

  function runHistory(direction: "undo" | "redo") {
    const stack = history.current[direction];
    const entry = stack.pop();
    if (!entry) return;
    const expected = direction === "undo" ? "after" : "before";
    if (
      entry.changes.some((change) => {
        const element = previewRef.current.find((item) => item.id === change.id);
        return (
          !element ||
          Object.entries(change[expected]).some(
            ([key, value]) =>
              JSON.stringify(element[key as keyof OverlayElement]) !== JSON.stringify(value)
          )
        );
      })
    ) {
      history.current = { undo: [], redo: [] };
      setError("Undo history was cleared because the canvas changed elsewhere.");
      return;
    }
    for (const change of entry.changes) {
      patchPreviewLocal(
        change.id,
        change[direction === "undo" ? "before" : "after"],
        undefined,
        false
      );
    }
    history.current[direction === "undo" ? "redo" : "undo"].push(entry);
  }

  function patchPreviewLocal(
    id: string,
    patch: Partial<OverlayElement>,
    before?: OverlayElement,
    record = true
  ) {
    if (!canEditCanvas) {
      setError("Canvas editing requires permission to edit and control the live overlay.");
      return;
    }
    if (!socketRef.current?.connected || canvasRefreshPending.current) {
      setError("No server connection. Wait for reconnection before editing.");
      return;
    }
    const current = before ?? previewRef.current.find((item) => item.id === id);
    if (record && current) {
      const previous = reversePatch(current, patch);
      if (JSON.stringify(previous) !== JSON.stringify(patch))
        recordHistory({ changes: [{ id, before: previous, after: patch }] });
    }
    previewRef.current = previewRef.current.map((item) =>
      item.id === id ? mergeElementPatch(item, patch) : item
    );
    setPreview(previewRef.current);
    schedulePreviewPatch(id, patch);
  }

  function updateTransformLocal(id: string, patch: Partial<OverlayElement>) {
    if (!canEditCanvas || !socketRef.current?.connected || canvasRefreshPending.current) return;
    setPreview((items) =>
      items.map((item) => (item.id === id ? mergeElementPatch(item, patch) : item))
    );
    transientPatches.current.set(id, patch);
    const send = () => {
      transformTimers.current.delete(id);
      const latest = transientPatches.current.get(id);
      if (!latest || !socketRef.current?.connected) return;
      lastTransformSent.current.set(id, performance.now());
      const payload = {
        id,
        revision: canvasRevisionRef.current,
        x: latest.x,
        y: latest.y,
        width: latest.width,
        height: latest.height,
        rotation: latest.rotation,
        crop: cropFromProps(latest.props)
      } satisfies ElementTransform & { revision: string };
      if (import.meta.env.DEV && performance.now() - lastDebugPing.current > 1000) {
        lastDebugPing.current = performance.now();
        const started = performance.now();
        socketRef.current
          .timeout(2000)
          .volatile.emit("preview:transform", payload, (error: Error | null, ok: boolean) => {
            if (!error && ok)
              document.documentElement.dataset.transformRttMs = String(
                Math.round(performance.now() - started)
              );
          });
      } else {
        socketRef.current.volatile.emit("preview:transform", payload);
      }
    };
    const wait = Math.max(
      0,
      25 - (performance.now() - (lastTransformSent.current.get(id) ?? -Infinity))
    );
    if (wait === 0) {
      if (transformTimers.current.has(id)) window.clearTimeout(transformTimers.current.get(id));
      send();
    } else if (!transformTimers.current.has(id)) {
      transformTimers.current.set(id, window.setTimeout(send, wait));
    }
  }

  function commitTransform(id: string, patch: Partial<OverlayElement>, before: OverlayElement) {
    const timer = transformTimers.current.get(id);
    if (timer !== undefined) window.clearTimeout(timer);
    transformTimers.current.delete(id);
    transientPatches.current.delete(id);
    patchPreviewLocal(id, patch, before);
    const flushTimer = previewPatchTimers.current.get(id);
    if (flushTimer !== undefined) window.clearTimeout(flushTimer);
    previewPatchTimers.current.delete(id);
    schedulePreviewFlush(id, 0);
  }

  function schedulePreviewPatch(id: string, patch: Partial<OverlayElement>) {
    const existing = pendingPreviewPatches.current.get(id);
    pendingPreviewPatches.current.set(id, existing ? mergePatch(existing, patch) : patch);
    schedulePreviewFlush(id);
  }

  function schedulePreviewFlush(id: string, delay = 80) {
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
          .emit(
            "preview:update",
            { id, patch: nextPatch, revision: canvasRevisionRef.current },
            (error: Error | null, ok: boolean) => {
              if (inFlightPreviewPatches.current.get(id) !== nextPatch) return;
              inFlightPreviewPatches.current.delete(id);
              if (error || !ok) {
                // Reload canonical state instead of silently keeping rejected optimistic edits.
                socket.disconnect().connect();
                setError("Could not save changes. Reloading canvas from the server.");
                return;
              }
              if (pendingPreviewPatches.current.has(id)) schedulePreviewFlush(id);
            }
          );
      }
    }, delay);
    previewPatchTimers.current.set(id, timer);
  }

  async function deleteMedia() {
    if (deletingMedia || mediaDeleteIds.length === 0) return;
    setDeletingMedia(true);
    setError("");
    setMediaError("");
    const remaining = [...mediaDeleteIds];
    const deleted = new Set<string>();
    let deletionError = "";
    try {
      for (const id of mediaDeleteIds) {
        await api(`/api/media/${encodeURIComponent(id)}`, { method: "DELETE" });
        remaining.shift();
        deleted.add(id);
      }
    } catch (deleteError) {
      const reason = deleteError instanceof Error ? deleteError.message : "Не удалось удалить медиа";
      deletionError = `Удалено: ${deleted.size}. Осталось: ${remaining.length}. ${reason}`;
    } finally {
      if (deleted.size > 0) setMedia((items) => items.filter((item) => !deleted.has(item.id)));
      setMediaDeleteIds(remaining);
      try {
        await refreshMedia();
      } catch (refreshError) {
        const message = refreshError instanceof Error ? refreshError.message : "Не удалось обновить библиотеку";
        deletionError = deletionError ? `${deletionError} ${message}` : message;
      }
      if (deletionError) {
        setError(deletionError);
        setMediaError(deletionError);
      }
      setDeletingMedia(false);
    }
  }

  async function logout() {
    await api("/api/auth/logout", { method: "POST" });
    window.location.href = "/";
  }

  return (
    <main
      className="moderator-app"
      onPointerDownCapture={(event) => {
        editorActive.current = Boolean(
          (event.target as HTMLElement).closest(
            ".workspace-center, .layers-panel, .properties-panel"
          )
        );
      }}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        if (event.dataTransfer.files.length > 0) {
          void uploadFiles(event.dataTransfer.files, true);
        }
      }}
    >
      <EditorTopbar
        streamer={streamer}
        user={user}
        path={window.location.pathname}
        overlayConnected={presence.overlayConnected}
        connectionIssue={connectionIssue}
        onLogout={() => void logout()}
      />

      {error && (
        <div className="toast">
          <AlertTriangle size={16} />
          {error}
          <button type="button" onClick={() => setError("")}>
            x
          </button>
        </div>
      )}

      {(blockedPreview.length > 0 || blockedLive.length > 0) && (
        <section className="scene-repair" aria-label="Заблокированные внешние медиа" role="status">
          <p>{unsafeMediaUrlMessage}</p>
          {blockedPreview.length > 0 && <div><strong>Подготовка</strong>{blockedPreview.map((item) => <div key={item.id}>{item.name}</div>)}</div>}
          {blockedLive.length > 0 && <div><strong>LIVE</strong>{blockedLive.map((item) => <div key={item.id}>{item.name}</div>)}</div>}
        </section>
      )}

      {(sceneRepair.preview.length > 0 || sceneRepair.live.length > 0) && (
        <section className="scene-repair" aria-label="Исправление размера сцены">
          <p>Сцена превышает безопасный размер. Удалите ненужные элементы, чтобы восстановить синхронизацию с OBS.</p>
          {(["preview", "live"] as const).map((kind) => sceneRepair[kind].length > 0 && (
            <div key={kind}>
              <strong>{kind === "preview" ? "Элементы редактора" : "Активные элементы LIVE"}</strong>
              {sceneRepair[kind].map((item) => (
                <div key={item.id}>
                  <span>{item.name}</span>
                  {user?.role === "OWNER" && (
                    <button type="button" onClick={() => emit(kind === "preview" ? "preview:remove" : "live:remove", { id: item.id })}>
                      Удалить
                    </button>
                  )}
                </div>
              ))}
              {sceneRepair[kind].length === 100 && <p>Показаны первые 100 элементов. После удаления список обновится.</p>}
            </div>
          ))}
        </section>
      )}

      <div className={`workspace ${propertiesVisible ? "" : "workspace-no-properties"}`}>
        <div className="asset-sidebar">
          <div className="sidebar-heading">
            SOURCE LIBRARY
          </div>
          <div className="asset-tabs">
            <button
              type="button"
              className={assetTab === "media" ? "active" : ""}
              onClick={() => setAssetTab("media")}
            >
              MEDIA
            </button>
            <button
              type="button"
              className={assetTab === "emotes" ? "active" : ""}
              onClick={() => {
                setEmotesOpened(true);
                setAssetTab("emotes");
              }}
            >
              EMOTES
            </button>
          </div>
          <div className="asset-tab-content" hidden={assetTab !== "media"}>
            <MediaLibrary
              media={media}
              loading={mediaLoading}
              uploadingCount={uploadingCount}
              error={mediaError}
              canPlace={canEditCanvas && connected}
              onUpload={(files) => void uploadFiles(files)}
              onAdd={(mediaId) => {
                const item = media.find((entry) => entry.id === mediaId);
                if (item) void addMediaToCanvas(item);
              }}
              onAddUrl={addMediaUrl}
              onDelete={setMediaDeleteIds}
              onAddText={() => emit("preview:add", { type: "TEXT", text: "New text" })}
              canDelete={permissions?.canDeleteMedia ?? false}
            />
          </div>
          {emotesOpened && (
            <div className="asset-tab-content" hidden={assetTab !== "emotes"}>
              <EmotesPanel
                streamer={streamer}
                onStreamerChange={setStreamer}
                onAdd={(emote: ChannelEmote) =>
                  emit("preview:add", { emoteId: emote.id, emoteProvider: emote.provider })
                }
                canConfigure={permissions?.canEditPreview ?? false}
                canCreate={permissions?.canUploadImage ?? false}
                canDelete={permissions?.canDeleteMedia ?? false}
                canPlace={canEditCanvas && connected}
              />
            </div>
          )}
        </div>

        <section className="workspace-center" aria-label="Canvas workspace">
          <div className="workspace-heading">
            <div>
              <h1>Рабочая область</h1>
            </div>
            <div className="workspace-heading-actions">
              <span className="canvas-resolution">
                <Monitor size={14} /> OBS {streamer.canvasWidth} × {streamer.canvasHeight}
              </span>
              <button type="button" className="properties-toggle" aria-pressed={propertiesVisible}
                onClick={() => setPropertiesVisible((visible) => !visible)}>
                {propertiesVisible ? "Скрыть свойства" : "Показать свойства"}
              </button>
            </div>
          </div>
          <CanvasStage
            key={streamer.canvasRevision}
            mode="workspace"
            streamer={streamer}
            elements={preview}
            mediaStatuses={mediaStatuses}
            selectedConnectionId={previewConnectionId}
            selectedId={selectedId}
            onSelect={(id) => setSelectedId(id || null)}
            onTransientUpdate={canEditCanvas ? updateTransformLocal : undefined}
            onCommitUpdate={canEditCanvas ? commitTransform : undefined}
          />
          <div className="workspace-caption">
            <span>
              <i className="caption-key live" /> OBS CANVAS · ЭФИР
            </span>
            <span>
              <i className="caption-key spawn" /> ЗА ПРЕДЕЛАМИ · ПОДГОТОВКА
            </span>
            <span className="workspace-caption-note">
              Колесо — масштаб · Space + перетаскивание — обзор
            </span>
          </div>
        </section>

        {propertiesVisible && <PropertiesPanel
          selected={selected}
          mediaStatuses={mediaStatuses.filter((status) => status.elementId === selected?.id)}
          selectedConnectionId={selectedConnectionId}
          onSourceChange={selectConnection}
          canControlPlayback={canEditCanvas && connected}
          onUpdate={patchPreviewLocal}
          onDuplicate={() => {
            if (selectedId) {
              history.current = { undo: [], redo: [] };
              emit("preview:duplicate", { id: selectedId });
            }
          }}
          onRemove={() => {
            if (selectedId) {
              history.current = { undo: [], redo: [] };
              emit("preview:remove", { id: selectedId });
            }
          }}
        />}
      </div>

      <footer className="bottom-panels single-panel">
        <details>
          <summary>
            LAYERS <span>{preview.length.toString().padStart(2, "0")}</span>
          </summary>
          <LayersPanel
            title="Canvas Assets"
            elements={preview}
            selectedId={selectedId}
            onSelect={(id) => setSelectedId(id)}
            onToggle={(id, visible) => patchPreviewLocal(id, { visible })}
          />
        </details>
      </footer>
      {mediaDeleteIds.length > 0 && (
        <div
          className="media-delete-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !deletingMedia) setMediaDeleteIds([]);
          }}
        >
          <div
            className="media-delete-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="media-delete-title"
            onKeyDown={(event) => {
              if (event.key !== "Tab") return;
              const buttons = Array.from(
                event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")
              );
              const first = buttons[0];
              const last = buttons[buttons.length - 1];
              if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last?.focus();
              } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first?.focus();
              }
            }}
          >
            <h2 id="media-delete-title">Удалить медиа?</h2>
            <p>
              Выбрано: {mediaDeleteIds.length}. Файлы будут удалены из библиотеки; если они уже
              используются на полотне или в OBS, воспроизведение прекратится. Это действие нельзя
              отменить.
            </p>
            <div className="media-delete-actions">
              <button
                type="button"
                autoFocus
                disabled={deletingMedia}
                onClick={() => setMediaDeleteIds([])}
              >
                Отмена
              </button>
              <button
                type="button"
                className="danger"
                disabled={deletingMedia}
                onClick={() => void deleteMedia()}
              >
                {deletingMedia ? "Удаление…" : `Удалить ${mediaDeleteIds.length}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

function cropFromProps(props: Record<string, unknown> | undefined): ElementTransform["crop"] {
  if (!props) return undefined;
  const { cropLeft, cropRight, cropTop, cropBottom } = props;
  if (
    [cropLeft, cropRight, cropTop, cropBottom].every(
      (value) => typeof value === "number" && Number.isFinite(value)
    )
  ) {
    return {
      left: cropLeft as number,
      right: cropRight as number,
      top: cropTop as number,
      bottom: cropBottom as number
    };
  }
  return undefined;
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
