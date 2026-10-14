import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import type { TwitchChannelView } from "../../shared/types";
import { api } from "../api";
import { ownTwitchChannel } from "../dashboardNavigation";
import { usePublicAuthContext } from "../publicTwitchAuth";
import { OverlayReloadFeedback } from "./OverlayReloadFeedback";
import { LoadingSpinner } from "./ui/LoadingSpinner";
import { useOverlayReload } from "./useOverlayReload";

export function LandingOverlayReload() {
  const { auth } = usePublicAuthContext();
  const [channelId, setChannelId] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState("");
  const [retryKey, setRetryKey] = useState(0);
  const reload = useOverlayReload(channelId);

  useEffect(() => {
    if (auth.status !== "authenticated" || !auth.user) {
      setChannelId(null);
      return;
    }
    let active = true;
    setChecking(true);
    setError("");
    void api<{ channels: TwitchChannelView[] }>("/api/auth/twitch/channels")
      .then(({ channels }) => {
        if (!active) return;
        const own = ownTwitchChannel(channels, auth.user!.id);
        setChannelId(own?.role === "owner" && own.status === "connected" ? own.id : null);
      })
      .catch(() => { if (active) { setChannelId(null); setError("Не удалось проверить свой канал."); } })
      .finally(() => { if (active) setChecking(false); });
    return () => { active = false; };
  }, [auth.status, auth.user?.id, retryKey]);

  if (auth.status !== "authenticated") return null;
  if (checking) return <p className="landing-reload-status" role="status"><LoadingSpinner /> Проверяем канал…</p>;
  if (error) return <p className="landing-reload-status" role="alert">{error} <button type="button" onClick={() => setRetryKey((value) => value + 1)}>Повторить</button></p>;
  if (!channelId) return null;
  return <div className="landing-reload-control">
    <button type="button" className="landing-reload-button" disabled={reload.busy} onClick={() => void reload.reload()}>
      {reload.busy ? <LoadingSpinner /> : <RefreshCw size={17} aria-hidden="true" />}
      Перезагрузить OBS Overlay
    </button>
    <OverlayReloadFeedback status={reload.status} message={reload.message} />
  </div>;
}
