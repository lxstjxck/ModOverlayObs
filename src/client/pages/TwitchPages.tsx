import { ArrowDown, AudioLines, Image, LockKeyhole, MonitorPlay, Smile, Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";
import type {
  ObsSetupView,
  OverlayReloadStatus,
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
import { PublicFooter } from "../components/PublicFooter";
import { PublicAuthControls } from "../components/PublicAuthControls";
import { PublicAuthProvider } from "../publicTwitchAuth";
import { TwitchDashboardView } from "../components/TwitchDashboardView";
import { FeatureCard, SectionHeading } from "../components/ui/LandingUi";

type TwitchMe = { user: TwitchProfileView; csrfToken: string };
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
          <p className="landing-eyebrow">
            <span className="landing-eyebrow-line" /> ИНСТРУМЕНТ ДЛЯ ЖИВОГО ЭФИРА
          </p>
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
            <a className="landing-text-link" href="/login">
              Я модератор <span aria-hidden="true">↗</span>
            </a>
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
            eyebrow="01 / ПРОСТОЕ ПОДКЛЮЧЕНИЕ"
            title="От входа до эфира — несколько шагов."
          >
            Стример подключает канал, а команда получает удобное пространство для работы с оверлеем.
          </SectionHeading>
          <div className="landing-steps">
            <article>
              <span>01</span>
              <h3>Подключите Twitch</h3>
              <p>Войдите как стример и подключите свой канал.</p>
            </article>
            <article>
              <span>02</span>
              <h3>Добавьте источник в OBS</h3>
              <p>Скопируйте адрес оверлея в Browser Source.</p>
            </article>
            <article>
              <span>03</span>
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
          eyebrow="02 / ВОЗМОЖНОСТИ"
          title="Эфир становится живее."
        >
          Всё необходимое для совместной работы с контентом на трансляции.
        </SectionHeading>
        <div className="landing-feature-grid">
          <FeatureCard icon={<Image size={23} />} number="01" title="Медиа на холсте">
            Модераторы размещают изображения, GIF, видео и текст прямо на полотне оверлея.
          </FeatureCard>
          <FeatureCard icon={<Smile size={23} />} number="02" title="Смайлы канала">
            Смайлы Twitch и 7TV можно добавить в область подготовки и расположить на холсте.
          </FeatureCard>
          <FeatureCard icon={<LockKeyhole size={23} />} number="03" title="Контроль доступа">
            Стример подключает канал и управляет тем, кому из модераторов доступен оверлей.
          </FeatureCard>
          <FeatureCard icon={<AudioLines size={23} />} number="04" title="Twitch TTS">
            Подключайте озвучивание сообщений из чата через команду или награду за баллы канала.
          </FeatureCard>
        </div>
        <div className="landing-note">
          <MonitorPlay size={18} aria-hidden="true" />
          <span>
            Предпросмотр помогает подготовить сцену. OBS показывает живое состояние оверлея.
          </span>
        </div>
      </section>

      <section className="landing-cta">
        <div className="landing-shell landing-cta-inner">
          <div>
            <p className="landing-eyebrow">
              <Sparkles size={16} aria-hidden="true" /> ГОТОВЫ НАЧАТЬ?
            </p>
            <h2>
              Дайте эфиру
              <br />
              <em>больше жизни.</em>
            </h2>
            <p>Подключите Twitch и настройте свой оверлей для OBS.</p>
          </div>
          <div className="landing-cta-actions">
            <PublicAuthControls />
            <a href="/login">Вход для модератора ↗</a>
          </div>
        </div>
      </section>
      <PublicFooter product="LXST Overlay" description="Оверлей для OBS и вашей команды." />
    </main>
  );
}

export function TwitchDashboardPage() {
  const [me, setMe] = useState<TwitchMe | null>(null);
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
  const [sourceWidth, setSourceWidth] = useState("");
  const [sourceHeight, setSourceHeight] = useState("");
  const [savingCanvas, setSavingCanvas] = useState(false);
  const [presence, setPresence] = useState<PresenceState | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [changingModerator, setChangingModerator] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [tts, setTts] = useState<TtsSetupView | null>(null);
  const [ttsCost, setTtsCost] = useState(1000);
  const [ttsBusy, setTtsBusy] = useState(false);
  const [reloadStatus, setReloadStatus] = useState<OverlayReloadStatus | null>(null);
  const [reloadMessage, setReloadMessage] = useState("");
  const [reloadStarting, setReloadStarting] = useState(false);

  async function load(userId = me?.user.id) {
    const revision = ++loadRevision.current;
    let loadedChannels: TwitchChannelView[] | null = null;
    setLoading(true);
    setError("");
    setChannels([]);
    setObs(null);
    setCanvas(null);
    canvasRevisionRef.current = "";
    setPresence(null);
    setModerators([]);
    setTts(null);
    setReloadStatus(null);
    try {
      const result = await api<{ channels: TwitchChannelView[] }>("/api/auth/twitch/channels");
      if (revision !== loadRevision.current) return;
      loadedChannels = result.channels;
      setChannels(result.channels);
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
        setModerators(list.moderators);
        setTts(ttsView);
        setTtsCost(ttsView.rewardCost);
      }
    } catch (loadError) {
      if (revision !== loadRevision.current) return;
      setChannels(loadedChannels?.map((channel) => channel.role === "owner" && channel.twitchId === userId
        ? { ...channel, status: "error" as const } : channel) ?? []);
      setObs(null);
      setCanvas(null);
      setModerators([]);
      setTts(null);
      setError(
        loadError instanceof Error ? loadError.message : "Не удалось проверить доступ через Twitch"
      );
    } finally {
      if (revision === loadRevision.current) setLoading(false);
    }
  }

  useEffect(() => {
    void api<TwitchMe>("/api/auth/twitch/me")
      .then((value) => {
        setMe(value);
        void load(value.user.id);
      })
      .catch(() => window.location.replace("/login"));
  }, []);

  useEffect(() => {
    const onPopState = () => setMode(dashboardMode(window.location));
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const ownChannel =
    ownProfile?.status === "connected" && ownProfile.id ? ownProfile : null;
  useEffect(() => {
    if (!me) return;
    let mounted = true;
    const refresh = () => {
      if (document.visibilityState === "hidden") return;
      void api<{ channels: TwitchChannelView[] }>("/api/auth/twitch/channels")
        .then((result) => {
          if (!mounted) return;
          setChannels(result.channels);
          const updatedOwn = ownTwitchChannel(result.channels, me.user.id);
          if (updatedOwn?.id !== ownChannel?.id || updatedOwn?.status !== ownProfile?.status) {
            void load();
          }
          setError("");
        })
        .catch((refreshError: unknown) => {
          if (!mounted) return;
          if (refreshError instanceof ApiError && refreshError.status === 401) {
            window.location.replace("/login");
            return;
          }
          setChannels([]);
          setObs(null);
          setCanvas(null);
          setModerators([]);
          setTts(null);
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
    if (!ownChannel?.id) return;
    setSourceWidth(window.localStorage.getItem(`obs-width:${ownChannel.id}`) ?? "");
    setSourceHeight(window.localStorage.getItem(`obs-height:${ownChannel.id}`) ?? "");
  }, [ownChannel?.id]);
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

  useEffect(() => {
    if (!ownChannel?.id || reloadStatus?.state !== "waiting") return;
    const channelId = ownChannel.id;
    const operationId = reloadStatus.id;
    let active = true;
    const timer = window.setInterval(() => {
      void api<OverlayReloadStatus>(`/api/auth/twitch/channels/${encodeURIComponent(channelId)}/overlay-reload/${encodeURIComponent(operationId)}`)
        .then((status) => { if (active) { setReloadStatus(status); setReloadMessage(""); } })
        .catch(() => { if (active) setReloadMessage("Не удалось получить статус перезагрузки. Проверьте подключение OBS."); });
    }, 1000);
    return () => { active = false; window.clearInterval(timer); };
  }, [ownChannel?.id, reloadStatus?.id, reloadStatus?.state]);

  async function reloadOverlay() {
    if (!ownChannel?.id || reloadStarting || reloadStatus?.state === "waiting") return;
    setReloadStarting(true);
    setReloadMessage("");
    try {
      const status = await api<OverlayReloadStatus>(
        `/api/auth/twitch/channels/${encodeURIComponent(ownChannel.id)}/overlay-reload`,
        { method: "POST" }
      );
      setReloadStatus(status);
    } catch (reloadError) {
      setReloadMessage(reloadError instanceof ApiError && reloadError.status === 503
        ? "OBS Overlay сейчас не подключён. Откройте Browser Source в OBS и повторите попытку."
        : reloadError instanceof ApiError && reloadError.status === 409
          ? "Перезагрузка уже выполняется или команда была отправлена недавно. Подождите и повторите попытку."
          : reloadError instanceof Error ? reloadError.message : "Не удалось отправить команду OBS");
    } finally {
      setReloadStarting(false);
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
    if (!ownChannel?.id || changingModerator) return;
    setChangingModerator(moderator.id);
    try {
      await api(
        `/api/auth/twitch/channels/${encodeURIComponent(ownChannel.id)}/bans/${encodeURIComponent(moderator.id)}`,
        { method: moderator.banned ? "DELETE" : "PUT" }
      );
      setModerators((items) =>
        items.map((item) => (item.id === moderator.id ? { ...item, banned: !item.banned } : item))
      );
    } catch (changeError) {
      setError(changeError instanceof Error ? changeError.message : "Не удалось изменить доступ");
    } finally {
      setChangingModerator(null);
    }
  }

  async function logout() {
    await api("/api/auth/logout", { method: "POST" });
    window.location.replace("/login");
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

  return <TwitchDashboardView
    mode={mode} me={me?.user ?? null} channels={channels} moderators={moderators}
    obs={obs} canvas={canvas} presence={presence} tts={tts}
    reloadStatus={reloadStatus} reloadMessage={reloadMessage} reloadBusy={reloadStarting || reloadStatus?.state === "waiting"}
    onReloadOverlay={() => void reloadOverlay()}
    width={width} height={height} sourceWidth={sourceWidth} sourceHeight={sourceHeight}
    ttsCost={ttsCost} ratio={ratio} changed={Boolean(changed)} dimensionsValid={dimensionsValid}
    loading={loading} connecting={connecting} savingCanvas={savingCanvas} ttsBusy={ttsBusy}
    changingModerator={changingModerator} error={error}
    onSelectMode={(nextMode) => {
      if (nextMode === mode) return;
      window.history.pushState(null, "", dashboardUrl(nextMode));
      setMode(nextMode);
    }}
    onRefresh={() => void load()} onLogout={() => void logout()}
    onConnectChannel={() => void connectChannel()} onToggleModerator={(item) => void toggle(item)}
    onToggleTts={() => void toggleTts()} onSaveTtsReward={() => void saveTtsReward()}
    onSaveCanvas={(changeMode) => void saveCanvas(changeMode)}
    setWidth={setWidth} setHeight={setHeight} setTtsCost={setTtsCost}
    setSourceWidth={(value) => { setSourceWidth(value); if (ownChannel?.id) window.localStorage.setItem(`obs-width:${ownChannel.id}`, value); }}
    setSourceHeight={(value) => { setSourceHeight(value); if (ownChannel?.id) window.localStorage.setItem(`obs-height:${ownChannel.id}`, value); }}
  />;
}

function reduceRatio(width: number, height: number): [number, number] {
  const gcd = (a: number, b: number): number => b === 0 ? a : gcd(b, a % b);
  const divisor = gcd(width, height);
  return [width / divisor, height / divisor];
}
