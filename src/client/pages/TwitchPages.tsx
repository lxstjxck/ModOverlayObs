import { ArrowDown, AudioLines, Image, LockKeyhole, Smile } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";
import type {
  ObsSetupView,
  PresenceState,
  CanvasChangeMode,
  StreamerView,
  TwitchChannelView,
  TwitchModeratorView,
  TwitchProfileView
} from "../../shared/types";
import type { TtsSetupView } from "../../shared/types";
import { ApiError, api } from "../api";
import { dashboardMode, dashboardUrl, ownTwitchChannel } from "../dashboardNavigation";
import { BrandIdentity } from "../components/BrandIdentity";
import { LandingEditorDemo } from "../components/LandingEditorDemo";
import { LandingOverlayReload } from "../components/LandingOverlayReload";
import { PublicFooter } from "../components/PublicFooter";
import { PublicAuthControls } from "../components/PublicAuthControls";
import { PublicAuthProvider } from "../publicTwitchAuth";
import { TwitchDashboardView } from "../components/TwitchDashboardView";
import { useOverlayReload } from "../components/useOverlayReload";
import { LoadingScreen } from "../components/ui/LoadingSpinner";
import { FeatureCard, SectionHeading } from "../components/ui/LandingUi";

type TwitchMe = { user: TwitchProfileView; csrfToken: string };

function keepUnchangedChannels(current: TwitchChannelView[], next: TwitchChannelView[]) {
  return current.length === next.length && current.every((channel, index) => {
    const updated = next[index];
    return updated && channel.id === updated.id && channel.twitchId === updated.twitchId &&
      channel.displayName === updated.displayName && channel.avatarUrl === updated.avatarUrl &&
      channel.status === updated.status && channel.role === updated.role;
  }) ? current : next;
}

export function TwitchLandingPage() {
  return <PublicAuthProvider><TwitchLandingContent /></PublicAuthProvider>;
}

function TwitchLandingContent() {
  return (
    <main className="landing-page overlay-landing">
      <header className="landing-header landing-shell">
        <BrandIdentity className="landing-brand" />
        <nav aria-label="Навигация по странице">
          <a className="landing-header-home" href="/">← LXST</a>
          <a href="#how-it-works">Как работает</a>
          <a href="#features">Возможности</a>
        </nav>
        <PublicAuthControls compact />
      </header>

      <section className="landing-hero landing-shell" aria-labelledby="landing-title">
        <div className="landing-hero-copy">
          <h1 id="landing-title">
            Твой эфир.
            <br />
            <em>Твои правила.</em>
          </h1>
          <p className="landing-hero-lead">
            Управляйте оверлеем в OBS вместе с модераторами. Изображения, видео, смайлы и текст
            появляются на трансляции тогда, когда это нужно.
          </p>
          <div className="landing-hero-actions">
            <PublicAuthControls />
          </div>
          <a className="landing-scroll-link" href="#how-it-works">
            <ArrowDown size={15} aria-hidden="true" /> Узнать больше
          </a>
        </div>
        <div className="landing-hero-visual">
          <LandingEditorDemo />
        </div>
        <div className="landing-hero-halo" aria-hidden="true" />
      </section>

      <section className="landing-intro" id="how-it-works" aria-labelledby="how-title">
        <div className="landing-shell">
          <SectionHeading
            id="how-title"
            title="От входа до эфира — несколько шагов."
          >
            Стример подключает канал, а команда получает удобное пространство для работы с оверлеем.
          </SectionHeading>
          <div className="landing-steps">
            <article>
              <h3>Подключите Twitch</h3>
              <p>Войдите как стример и подключите свой канал.</p>
            </article>
            <article>
              <h3>Добавьте источник в OBS</h3>
              <p>Скопируйте адрес оверлея в Browser Source.</p>
            </article>
            <article>
              <h3>Дайте доступ команде</h3>
              <p>Управляйте доступом модераторов в панели стримера.</p>
            </article>
          </div>
        </div>
      </section>

      <section
        className="landing-features landing-shell"
        id="features"
        aria-labelledby="features-title"
      >
        <SectionHeading
          id="features-title"
          title="Эфир становится живее."
        >
          Всё необходимое для совместной работы с контентом на трансляции.
        </SectionHeading>
        <div className="landing-feature-grid">
          <FeatureCard icon={<Image size={23} />} title="Медиа на холсте">
            Модераторы размещают изображения, GIF, видео и текст прямо на полотне оверлея.
          </FeatureCard>
          <FeatureCard icon={<Smile size={23} />} title="Смайлы канала">
            Смайлы Twitch и 7TV можно добавить в область подготовки и расположить на холсте.
          </FeatureCard>
          <FeatureCard icon={<LockKeyhole size={23} />} title="Контроль доступа">
            Стример подключает канал и управляет тем, кому из модераторов доступен оверлей.
          </FeatureCard>
          <FeatureCard icon={<AudioLines size={23} />} title="Twitch TTS">
            Подключайте озвучивание сообщений из чата через команду или награду за баллы канала.
          </FeatureCard>
        </div>
      </section>

      <section className="landing-cta">
        <div className="landing-shell landing-cta-inner">
          <div className="landing-cta-copy">
            <h2>
              Дайте эфиру
              <br />
              <em>больше жизни.</em>
            </h2>
            <p>Подключите Twitch и настройте свой оверлей для OBS.</p>
          </div>
          <div className="landing-cta-actions">
            <PublicAuthControls />
            <LandingOverlayReload />
          </div>
        </div>
      </section>
      <PublicFooter product="LXST Overlay" description="Оверлей для OBS и вашей команды." />
    </main>
  );
}

export function TwitchDashboardPage() {
  const [me, setMe] = useState<TwitchMe | null>(null);
  const [initialError, setInitialError] = useState("");
  const [sessionRetry, setSessionRetry] = useState(0);
  const [channels, setChannels] = useState<TwitchChannelView[]>([]);
  const [mode, setMode] = useState(() => dashboardMode(window.location));
  const ownProfile = me ? ownTwitchChannel(channels, me.user.id) : null;
  const loadRevision = useRef(0);
  const [moderators, setModerators] = useState<TwitchModeratorView[]>([]);
  const [obs, setObs] = useState<ObsSetupView | null>(null);
  const [canvas, setCanvas] = useState<StreamerView | null>(null);
  const canvasRevisionRef = useRef("");
  const [width, setWidth] = useState("1920");
  const [height, setHeight] = useState("1080");
  const [savingCanvas, setSavingCanvas] = useState(false);
  const [presence, setPresence] = useState<PresenceState | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [changingModerators, setChangingModerators] = useState<string[]>([]);
  const pendingModeratorIds = useRef(new Set<string>());
  const [moderatorsRefreshing, setModeratorsRefreshing] = useState(false);
  const [moderatorsError, setModeratorsError] = useState("");
  const moderatorRequestId = useRef(0);
  const moderatorMutationRevision = useRef(0);
  const refreshModeratorsInFlight = useRef(false);
  const [connecting, setConnecting] = useState(false);
  const [tts, setTts] = useState<TtsSetupView | null>(null);
  const [ttsCost, setTtsCost] = useState(1000);
  const [ttsBusy, setTtsBusy] = useState(false);
  const [regeneratingObs, setRegeneratingObs] = useState(false);
  const regenerateInFlight = useRef(false);
  const [obsLinkMessage, setObsLinkMessage] = useState("");
  const [obsLinkError, setObsLinkError] = useState(false);

  async function load(userId = me?.user.id) {
    const revision = ++loadRevision.current;
    const moderatorRevision = ++moderatorRequestId.current;
    const mutationRevision = moderatorMutationRevision.current;
    let loadedChannels: TwitchChannelView[] | null = null;
    setLoading(true);
    setError("");
    try {
      const result = await api<{ channels: TwitchChannelView[] }>("/api/auth/twitch/channels");
      if (revision !== loadRevision.current) return;
      loadedChannels = result.channels;
      setChannels((current) => keepUnchangedChannels(current, result.channels));
      const own = userId ? ownTwitchChannel(result.channels, userId) : null;
      if (own?.status === "connected" && own.id) {
        const id = own.id;
        const obsView = await api<ObsSetupView>("/api/obs", { headers: { "X-Channel-Id": id } });
        const current = await api<{ streamer: StreamerView }>("/api/auth/me", { headers: { "X-Channel-Id": id } });
        const list = await api<{ moderators: TwitchModeratorView[] }>(
          `/api/auth/twitch/channels/${encodeURIComponent(id)}/moderators`
        );
        const ttsView = await api<TtsSetupView>(`/api/tts/channels/${encodeURIComponent(id)}`);
        if (revision !== loadRevision.current) return;
        setObs(obsView);
        setCanvas(current.streamer);
        canvasRevisionRef.current = current.streamer.canvasRevision;
        setWidth(String(current.streamer.canvasWidth));
        setHeight(String(current.streamer.canvasHeight));
        if (moderatorRevision === moderatorRequestId.current && mutationRevision === moderatorMutationRevision.current) {
          setModerators(list.moderators);
        }
        setTts(ttsView);
        setTtsCost(ttsView.rewardCost);
      } else {
        setObs(null);
        setCanvas(null);
        canvasRevisionRef.current = "";
        setPresence(null);
        setModerators([]);
        setTts(null);
      }
    } catch (loadError) {
      if (revision !== loadRevision.current) return;
      if (loadedChannels) {
        setChannels(loadedChannels.map((channel) => channel.role === "owner" && channel.twitchId === userId
          ? { ...channel, status: "error" as const } : channel));
      }
      setError(
        loadError instanceof Error ? loadError.message : "Не удалось проверить доступ через Twitch"
      );
    } finally {
      if (revision === loadRevision.current) setLoading(false);
    }
  }

  useEffect(() => {
    setInitialError("");
    void api<TwitchMe>("/api/auth/twitch/me")
      .then((value) => {
        setMe(value);
        void load(value.user.id);
      })
      .catch((cause: unknown) => {
        if (cause instanceof ApiError && cause.status === 401) {
          window.location.replace("/overlay");
        } else {
          setInitialError(cause instanceof Error ? cause.message : "Не удалось проверить вход через Twitch.");
        }
      });
  }, [sessionRetry]);

  useEffect(() => {
    const onPopState = () => setMode(dashboardMode(window.location));
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const ownChannel =
    ownProfile?.status === "connected" && ownProfile.id ? ownProfile : null;
  const ownChannelIdRef = useRef<string | null>(null);
  ownChannelIdRef.current = ownChannel?.id ?? null;
  const overlayReload = useOverlayReload(ownChannel?.id ?? null);
  useEffect(() => {
    if (!me) return;
    let mounted = true;
    const refresh = () => {
      if (document.visibilityState === "hidden") return;
      void api<{ channels: TwitchChannelView[] }>("/api/auth/twitch/channels")
        .then((result) => {
          if (!mounted) return;
          setChannels((current) => keepUnchangedChannels(current, result.channels));
          const updatedOwn = ownTwitchChannel(result.channels, me.user.id);
          if (updatedOwn?.id !== ownChannel?.id || updatedOwn?.status !== ownProfile?.status) {
            void load();
          }
          setError("");
        })
        .catch((refreshError: unknown) => {
          if (!mounted) return;
          if (refreshError instanceof ApiError && refreshError.status === 401) {
            window.location.replace("/");
            return;
          }
          setError(refreshError instanceof Error ? refreshError.message : "Не удалось обновить список каналов");
        });
    };
    const timer = window.setInterval(refresh, 30_000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      mounted = false;
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [me?.user.id, ownChannel?.id, ownProfile?.status]);
  useEffect(() => {
    if (!ownChannel?.id || !tts?.available) return;
    const channelId = ownChannel.id;
    let mounted = true;
    const timer = window.setInterval(() => {
      void api<TtsSetupView>(`/api/tts/channels/${encodeURIComponent(channelId)}`)
        .then((view) => { if (mounted) setTts(view); })
        .catch(() => { if (mounted) setTts((current) => current && { ...current, ready: false }); });
    }, 5000);
    return () => { mounted = false; window.clearInterval(timer); };
  }, [ownChannel?.id, tts?.available]);
  useEffect(() => {
    if (!ownChannel?.id) return;
    const socket = io({ path: "/socket.io", query: { channelId: ownChannel.id } });
    socket.on("presence:update", (value: PresenceState) => setPresence(value));
    socket.on("canvas:state", (value: StreamerView) => {
      setCanvas(value);
      setObs((current) => current && { ...current, canvasWidth: value.canvasWidth, canvasHeight: value.canvasHeight });
      if (canvasRevisionRef.current !== value.canvasRevision) {
        canvasRevisionRef.current = value.canvasRevision;
        setWidth(String(value.canvasWidth));
        setHeight(String(value.canvasHeight));
      }
    });
    socket.on("disconnect", () => setPresence(null));
    return () => {
      socket.disconnect();
      setPresence(null);
    };
  }, [ownChannel?.id]);

  async function regenerateObs(): Promise<boolean> {
    if (!ownChannel?.id || regenerateInFlight.current) return false;
    regenerateInFlight.current = true;
    setRegeneratingObs(true);
    setObsLinkMessage("");
    try {
      const updated = await api<ObsSetupView>("/api/obs/regenerate", {
        method: "POST", headers: { "X-Channel-Id": ownChannel.id }
      });
      if (ownChannelIdRef.current !== ownChannel.id) return false;
      setObs(updated);
      overlayReload.reset();
      setObsLinkError(false);
      setObsLinkMessage("Новая ссылка создана. Замените URL источника Browser Source в OBS.");
      return true;
    } catch (cause) {
      setObsLinkError(true);
      setObsLinkMessage(cause instanceof Error ? cause.message : "Не удалось создать новую ссылку OBS.");
      return false;
    } finally {
      regenerateInFlight.current = false;
      setRegeneratingObs(false);
    }
  }

  async function refreshModerators() {
    if (!ownChannel?.id || refreshModeratorsInFlight.current) return;
    const channelId = ownChannel.id;
    const requestId = ++moderatorRequestId.current;
    const mutationRevision = moderatorMutationRevision.current;
    refreshModeratorsInFlight.current = true;
    setModeratorsRefreshing(true);
    setModeratorsError("");
    try {
      const list = await api<{ moderators: TwitchModeratorView[] }>(
        `/api/auth/twitch/channels/${encodeURIComponent(channelId)}/moderators`
      );
      if (ownChannelIdRef.current === channelId && moderatorRequestId.current === requestId &&
          moderatorMutationRevision.current === mutationRevision) {
        setModerators(list.moderators);
      }
    } catch (cause) {
      if (ownChannelIdRef.current === channelId) {
        setModeratorsError(cause instanceof Error ? cause.message : "Не удалось обновить список модераторов.");
      }
    } finally {
      refreshModeratorsInFlight.current = false;
      setModeratorsRefreshing(false);
    }
  }

  async function saveCanvas(mode: CanvasChangeMode) {
    if (!ownChannel?.id || !canvas || savingCanvas) return;
    setSavingCanvas(true);
    setError("");
    try {
      const result = await api<{ streamer: StreamerView }>(
        `/api/channels/${encodeURIComponent(ownChannel.id)}/canvas`,
        { method: "PUT", headers: { "X-Channel-Id": ownChannel.id }, body: JSON.stringify({
          width: Number(width), height: Number(height), mode, expectedRevision: canvas.canvasRevision
        }) }
      );
      setCanvas(result.streamer);
      canvasRevisionRef.current = result.streamer.canvasRevision;
      setObs((current) => current && { ...current, canvasWidth: result.streamer.canvasWidth, canvasHeight: result.streamer.canvasHeight });
    } catch (changeError) {
      setError(changeError instanceof Error ? changeError.message : "Не удалось изменить холст");
    } finally {
      setSavingCanvas(false);
    }
  }

  const dimensionsValid = /^\d+$/.test(width) && /^\d+$/.test(height) &&
    Number(width) >= 320 && Number(width) <= 7680 && Number(height) >= 320 && Number(height) <= 7680 &&
    Number(width) / Number(height) >= 0.25 && Number(width) / Number(height) <= 4;
  const ratio = dimensionsValid ? reduceRatio(Number(width), Number(height)) : null;
  const changed = canvas && (canvas.canvasWidth !== Number(width) || canvas.canvasHeight !== Number(height));

  async function toggle(moderator: TwitchModeratorView) {
    if (!ownChannel?.id || pendingModeratorIds.current.has(moderator.id)) return;
    const channelId = ownChannel.id;
    pendingModeratorIds.current.add(moderator.id);
    setChangingModerators([...pendingModeratorIds.current]);
    setModeratorsError("");
    try {
      await api(
        `/api/auth/twitch/channels/${encodeURIComponent(channelId)}/bans/${encodeURIComponent(moderator.id)}`,
        { method: moderator.banned ? "DELETE" : "PUT" }
      );
      if (ownChannelIdRef.current === channelId) {
        moderatorMutationRevision.current++;
        setModerators((items) =>
          items.map((item) => (item.id === moderator.id ? { ...item, banned: !moderator.banned } : item))
        );
      }
    } catch (changeError) {
      if (ownChannelIdRef.current === channelId) {
        setModeratorsError(changeError instanceof ApiError && changeError.status === 403
          ? "Не удалось подтвердить доступ к этому модератору. Обновите список."
          : changeError instanceof ApiError && changeError.status === 503
            ? "Twitch сейчас недоступен. Повторите попытку позже."
            : changeError instanceof Error ? changeError.message : "Не удалось изменить доступ");
      }
    } finally {
      pendingModeratorIds.current.delete(moderator.id);
      setChangingModerators([...pendingModeratorIds.current]);
    }
  }

  async function logout() {
    await api("/api/auth/logout", { method: "POST" });
    window.location.replace("/");
  }

  async function toggleTts() {
    if (!ownChannel?.id || !tts || ttsBusy) return;
    setTtsBusy(true);
    setError("");
    try {
      const view = await api<TtsSetupView>(`/api/tts/channels/${encodeURIComponent(ownChannel.id)}/enabled`, {
        method: "PUT", body: JSON.stringify({ enabled: !tts.enabled })
      });
      setTts(view);
    } catch (changeError) {
      setError(changeError instanceof Error ? changeError.message : "Не удалось изменить TTS");
    } finally { setTtsBusy(false); }
  }

  async function saveTtsReward() {
    if (!ownChannel?.id || !tts || ttsBusy || !Number.isInteger(ttsCost) || ttsCost < 1 || ttsCost > 1_000_000) return;
    setTtsBusy(true);
    setError("");
    try {
      await api(`/api/tts/channels/${encodeURIComponent(ownChannel.id)}/reward`, {
        method: tts.rewardId ? "PATCH" : "POST", body: JSON.stringify({ cost: ttsCost })
      });
      setTts(await api<TtsSetupView>(`/api/tts/channels/${encodeURIComponent(ownChannel.id)}`));
    } catch (changeError) {
      setError(changeError instanceof Error ? changeError.message : "Не удалось сохранить награду TTS");
    } finally { setTtsBusy(false); }
  }

  async function connectChannel() {
    if (connecting || ownProfile?.role !== "owner" || ownProfile.status !== "unconnected" || ownProfile.id !== null) return;
    setConnecting(true);
    setError("");
    try {
      await api("/api/auth/twitch/channels", { method: "POST" });
      await load();
    } catch (connectError) {
      setError(connectError instanceof Error ? connectError.message : "Не удалось подключить канал");
    } finally {
      setConnecting(false);
    }
  }

  if (!me) {
    if (!initialError) return <LoadingScreen message="Проверяем вход через Twitch…" />;
    return <main className="lxst-loading-screen">
      <p role="alert">{initialError}</p>
      <button type="button" onClick={() => setSessionRetry((value) => value + 1)}>Повторить проверку</button>
    </main>;
  }

  return <TwitchDashboardView
    mode={mode} me={me?.user ?? null} channels={channels} moderators={moderators}
    obs={obs} canvas={canvas} presence={presence} tts={tts}
    reloadStatus={overlayReload.status} reloadMessage={overlayReload.message} reloadBusy={overlayReload.busy}
    onReloadOverlay={() => void overlayReload.reload()}
    onRegenerateObs={regenerateObs} regeneratingObs={regeneratingObs}
    obsLinkMessage={obsLinkMessage} obsLinkError={obsLinkError}
    width={width} height={height}
    ttsCost={ttsCost} ratio={ratio} changed={Boolean(changed)} dimensionsValid={dimensionsValid}
    loading={loading} connecting={connecting} savingCanvas={savingCanvas} ttsBusy={ttsBusy}
    changingModerators={changingModerators} moderatorsRefreshing={moderatorsRefreshing}
    moderatorsError={moderatorsError} error={error}
    onSelectMode={(nextMode) => {
      if (nextMode === mode) return;
      window.history.pushState(null, "", dashboardUrl(nextMode));
      setMode(nextMode);
    }}
    onRefresh={() => void load()} onLogout={() => void logout()}
    onConnectChannel={() => void connectChannel()} onToggleModerator={(item) => void toggle(item)}
    onRefreshModerators={() => void refreshModerators()}
    onToggleTts={() => void toggleTts()} onSaveTtsReward={() => void saveTtsReward()}
    onSaveCanvas={(changeMode) => void saveCanvas(changeMode)}
    setWidth={setWidth} setHeight={setHeight} setTtsCost={setTtsCost}
  />;
}

function reduceRatio(width: number, height: number): [number, number] {
  const gcd = (a: number, b: number): number => b === 0 ? a : gcd(b, a % b);
  const divisor = gcd(width, height);
  return [width / divisor, height / divisor];
}
