import { useEffect, useRef, useState } from "react";
import type { OverlayReloadStatus } from "../../shared/types";
import { ApiError, api } from "../api";

export function useOverlayReload(channelId: string | null) {
  const [status, setStatus] = useState<OverlayReloadStatus | null>(null);
  const [message, setMessage] = useState("");
  const [starting, setStarting] = useState(false);
  const inFlight = useRef(false);

  useEffect(() => {
    setStatus(null);
    setMessage("");
  }, [channelId]);

  useEffect(() => {
    if (!channelId || status?.state !== "waiting") return;
    const operationId = status.id;
    let active = true;
    const timer = window.setInterval(() => {
      void api<OverlayReloadStatus>(`/api/auth/twitch/channels/${encodeURIComponent(channelId)}/overlay-reload/${encodeURIComponent(operationId)}`)
        .then((next) => { if (active) { setStatus(next); setMessage(""); } })
        .catch(() => { if (active) setMessage("Не удалось получить статус перезагрузки. Проверьте подключение OBS."); });
    }, 1000);
    return () => { active = false; window.clearInterval(timer); };
  }, [channelId, status?.id, status?.state]);

  async function reload() {
    if (!channelId || inFlight.current || status?.state === "waiting") return;
    inFlight.current = true;
    setStarting(true);
    setMessage("");
    try {
      const next = await api<OverlayReloadStatus>(
        `/api/auth/twitch/channels/${encodeURIComponent(channelId)}/overlay-reload`,
        { method: "POST" }
      );
      setStatus(next);
    } catch (cause) {
      setMessage(cause instanceof ApiError && cause.status === 503
        ? "OBS Overlay сейчас не подключён. Откройте Browser Source в OBS и повторите попытку."
        : cause instanceof ApiError && cause.status === 409
          ? "Перезагрузка уже выполняется или команда была отправлена недавно. Подождите и повторите попытку."
          : cause instanceof Error ? cause.message : "Не удалось отправить команду OBS");
    } finally {
      inFlight.current = false;
      setStarting(false);
    }
  }

  function reset() {
    setStatus(null);
    setMessage("");
  }

  return { status, message, busy: starting || status?.state === "waiting", reload, reset };
}
