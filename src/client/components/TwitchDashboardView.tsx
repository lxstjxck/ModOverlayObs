import { ArrowUpRight, Check, Copy, Eye, EyeOff, Info, LockKeyhole, LogOut, RefreshCw, RotateCw, ShieldCheck } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type {
  CanvasChangeMode,
  ObsSetupView,
  OverlayReloadStatus,
  PresenceState,
  StreamerView,
  TwitchChannelView,
  TwitchMode,
  TwitchModeratorView,
  TwitchProfileView,
  TtsSetupView
} from "../../shared/types";
import { moderatedTwitchChannels, ownTwitchChannel } from "../dashboardNavigation";
import { BrandIdentity } from "./BrandIdentity";
import { ChannelAvatar, DashboardSection, StatusPill } from "./ui/DashboardUi";
import { LoadingSpinner } from "./ui/LoadingSpinner";
import { OverlayReloadFeedback } from "./OverlayReloadFeedback";

type DashboardProps = {
  mode: TwitchMode;
  me: TwitchProfileView | null;
  channels: TwitchChannelView[];
  onSelectMode: (mode: TwitchMode) => void;
  moderators: TwitchModeratorView[];
  obs: ObsSetupView | null;
  canvas: StreamerView | null;
  presence: PresenceState | null;
  tts: TtsSetupView | null;
  reloadStatus: OverlayReloadStatus | null;
  reloadMessage: string;
  reloadBusy: boolean;
  onReloadOverlay: () => void;
  onRegenerateObs: () => Promise<boolean>;
  regeneratingObs: boolean;
  obsLinkMessage: string;
  obsLinkError: boolean;
  width: string;
  height: string;
  ttsCost: number;
  ratio: [number, number] | null;
  changed: boolean;
  dimensionsValid: boolean;
  loading: boolean;
  connecting: boolean;
  savingCanvas: boolean;
  ttsBusy: boolean;
  changingModerators: string[];
  moderatorsRefreshing: boolean;
  moderatorsError: string;
  error: string;
  onRefresh: () => void;
  onLogout: () => void;
  onConnectChannel: () => void;
  onToggleModerator: (moderator: TwitchModeratorView) => void;
  onRefreshModerators: () => void;
  onToggleTts: () => void;
  onSaveTtsReward: () => void;
  onSaveCanvas: (mode: CanvasChangeMode) => void;
  setWidth: (value: string) => void;
  setHeight: (value: string) => void;
  setTtsCost: (value: number) => void;
};

const statusText = {
  connected: "Подключён",
  unconnected: "Не подключён",
  denied: "Доступ запрещён",
  error: "Ошибка проверки"
};
const presets = new Set([
  "1280x720",
  "1920x1080",
  "2560x1440",
  "3840x2160",
  "1080x1920",
  "720x1280"
]);

function presetValue(width: string, height: string) {
  const value = `${width}x${height}`;
  return presets.has(value) ? value : "custom";
}

export function TwitchDashboardView(props: DashboardProps) {
  const {
    mode,
    me,
    channels,
    onSelectMode,
    moderators,
    obs,
    canvas,
    presence,
    tts,
    reloadStatus,
    reloadMessage,
    reloadBusy,
    onReloadOverlay,
    onRegenerateObs,
    regeneratingObs,
    obsLinkMessage,
    obsLinkError,
    width,
    height,
    ttsCost,
    ratio,
    changed,
    dimensionsValid,
    loading,
    connecting,
    savingCanvas,
    ttsBusy,
    changingModerators,
    moderatorsRefreshing,
    moderatorsError,
    error,
    onRefresh,
    onLogout,
    onConnectChannel,
    onToggleModerator,
    onRefreshModerators,
    onToggleTts,
    onSaveTtsReward,
    onSaveCanvas,
    setWidth,
    setHeight,
    setTtsCost
  } = props;
  const [moderatorQuery, setModeratorQuery] = useState("");
  const [channelQuery, setChannelQuery] = useState("");
  const [showObsUrl, setShowObsUrl] = useState(false);
  const [copyStatus, setCopyStatus] = useState("");
  const [showRegenerateDialog, setShowRegenerateDialog] = useState(false);
  const [showReloadHint, setShowReloadHint] = useState(false);
  const regenerateButtonRef = useRef<HTMLButtonElement>(null);
  const cancelRegenerateRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    setShowObsUrl(false);
    setCopyStatus("");
  }, [obs?.overlayUrl]);
  useEffect(() => {
    if (showRegenerateDialog) cancelRegenerateRef.current?.focus();
  }, [showRegenerateDialog]);
  function closeRegenerateDialog() {
    if (regeneratingObs) return;
    setShowRegenerateDialog(false);
    regenerateButtonRef.current?.focus();
  }
  async function confirmRegenerate() {
    if (regeneratingObs) return;
    if (await onRegenerateObs()) {
      setShowRegenerateDialog(false);
      regenerateButtonRef.current?.focus();
    }
  }
  const streamerChannel = me ? ownTwitchChannel(channels, me.id) : null;
  const ownChannel = mode === "streamer" && streamerChannel?.status === "connected" && streamerChannel.id
    ? streamerChannel : null;
  const filteredModerators = moderators.filter((item) =>
    item.displayName.toLocaleLowerCase().includes(moderatorQuery.toLocaleLowerCase())
  );
  const filteredChannels = moderatedTwitchChannels(channels, me?.id ?? "").filter((item) =>
    item.displayName.toLocaleLowerCase().includes(channelQuery.toLocaleLowerCase())
  );

  async function copyObsUrl() {
    if (!obs) return;
    try {
      await navigator.clipboard.writeText(obs.overlayUrl);
      setCopyStatus("URL скопирован");
    } catch {
      setCopyStatus("Не удалось скопировать URL. Разрешите доступ к буферу обмена.");
    }
  }

  return (
    <main className="lxst-dashboard">
      <header className="lxst-dashboard-header">
        <div className="lxst-shell lxst-dashboard-header-inner">
          <BrandIdentity product={null} />
          {me && (
            <div className="lxst-dashboard-account">
              <ChannelAvatar name={me.displayName} src={me.avatarUrl} />
              <span>
                <strong>{me.displayName}</strong>
                <small>@{me.login}</small>
              </span>
            </div>
          )}
          {me && (
            <button className="lxst-header-logout" type="button" onClick={onLogout}>
              <LogOut size={16} aria-hidden="true" />
              <span>Выйти</span>
            </button>
          )}
        </div>
      </header>
      <div className="lxst-shell lxst-dashboard-content">
        <div className="lxst-dashboard-intro">
          <div className="lxst-dashboard-title-row">
            <div>
              <h1>{mode === "streamer" ? "Панель управления" : "Ваши каналы."}</h1>
              <p className="lxst-dashboard-lead">
                {mode === "streamer"
                  ? "Канал, команда и настройки оверлея в одном месте."
                  : "Выберите доступный канал и откройте его редактор."}
              </p>
            </div>
          </div>
          {me && (
            <div className="lxst-dashboard-toolbar">
              <nav className="lxst-mode-switch" aria-label="Режим кабинета">
                <button type="button" aria-current={mode === "streamer" ? "page" : undefined}
                  onClick={() => onSelectMode("streamer")}>Стример</button>
                <button type="button" aria-current={mode === "moderator" ? "page" : undefined}
                  onClick={() => onSelectMode("moderator")}>Модератор</button>
              </nav>
              <button
                type="button"
                className="lxst-quiet-button"
                onClick={onRefresh}
                disabled={loading}
              >
                {loading ? <LoadingSpinner /> : <RefreshCw size={15} aria-hidden="true" />}
                {loading ? "Обновляем данные…" : "Обновить данные"}
              </button>
            </div>
          )}
        </div>
        {error && (
          <div className="lxst-alert" role="alert">
            {error}
          </div>
        )}
        {!me ? (
          <div className="lxst-panel lxst-loading" role="status">
            <LoadingSpinner /> Проверяем вход через Twitch…
          </div>
        ) : mode === "streamer" ? (
          <div className="lxst-dashboard-grid" aria-busy={loading}>
            <DashboardSection
              id="overview"
              title="Обзор"
              className="lxst-overview"
            >
              {loading && channels.length === 0 ? (
                <p className="lxst-muted" role="status">
                  Загружаем данные канала…
                </p>
              ) : (
                <div className="lxst-overview-grid">
                  <div className="lxst-overview-channel">
                    <ChannelAvatar
                      name={streamerChannel?.displayName ?? me.displayName}
                      src={streamerChannel?.avatarUrl ?? me.avatarUrl}
                    />
                    <div>
                      <small>TWITCH-КАНАЛ</small>
                      <strong>{streamerChannel?.displayName ?? me.displayName}</strong>
                      <StatusPill
                        tone={
                          streamerChannel?.status === "connected"
                            ? "good"
                            : streamerChannel?.status === "denied" ||
                                streamerChannel?.status === "error"
                              ? "danger"
                              : "warning"
                        }
                      >
                        {streamerChannel ? statusText[streamerChannel.status] : "Не привязан"}
                      </StatusPill>
                    </div>
                  </div>
                  <div className="lxst-overview-stat">
                    <small>OBS OVERLAY</small>
                    <StatusPill
                      tone={presence?.overlayConnected ? "good" : presence ? "warning" : "neutral"}
                    >
                      {presence
                        ? presence.overlayConnected
                          ? "OBS подключён"
                          : "OBS не подключён"
                        : "Проверяется"}
                    </StatusPill>
                    <span>Статус соединения OBS Browser Source; видимость в эфире проверяется отдельно.</span>
                  </div>
                  <div className="lxst-overview-action">
                    {ownChannel?.id ? (
                      <a
                        className="lxst-button lxst-button-primary"
                        href={`/channel/${encodeURIComponent(ownChannel.id)}`}
                      >
                        Открыть редактор <ArrowUpRight size={18} aria-hidden="true" />
                      </a>
                    ) : streamerChannel?.role === "owner" &&
                      streamerChannel.status === "unconnected" &&
                      streamerChannel.id === null ? (
                      <button
                        className="lxst-button lxst-button-primary"
                        type="button"
                        disabled={connecting}
                        onClick={onConnectChannel}
                      >
                        {connecting && <LoadingSpinner />}{connecting ? "Подключаем…" : "Подключить канал"}
                      </button>
                    ) : (
                      <p className="lxst-muted">
                        {streamerChannel?.status === "denied"
                          ? "Доступ к каналу Twitch запрещён."
                          : streamerChannel?.status === "error"
                            ? "Не удалось проверить доступ к каналу Twitch."
                            : "Проверьте доступ к каналу Twitch."}
                      </p>
                    )}
                  </div>
                  {streamerChannel?.role === "owner" && streamerChannel.status === "unconnected" && streamerChannel.id === null &&
                    <p className="lxst-muted lxst-connect-hint">Ваш Twitch-канал ещё не подключён к LXST Overlay. Подключите его, чтобы настроить OBS и пригласить модераторов.</p>}
                </div>
              )}
            </DashboardSection>
            {ownChannel?.id && (
              <>
                <DashboardSection
                  id="obs"
                  title="OBS Browser Source"
                  className="lxst-obs"
                >
                  {obs ? (
                    <>
                      <p className="lxst-muted">
                        Секретный URL источника. Не публикуйте его и не добавляйте в скриншоты.
                      </p>
                      <label className="lxst-field">
                        URL оверлея
                        <div className="lxst-secret-row">
                          <input
                            aria-label="OBS Overlay URL"
                            type={showObsUrl ? "text" : "password"}
                            value={obs.overlayUrl}
                            readOnly
                            autoComplete="off"
                          />
                          <button
                            type="button"
                            className="lxst-icon-button"
                            aria-label={showObsUrl ? "Скрыть URL" : "Показать URL"}
                            onClick={() => setShowObsUrl((value) => !value)}
                          >
                            {showObsUrl ? <EyeOff size={17} /> : <Eye size={17} />}
                          </button>
                          <button
                            type="button"
                            className="lxst-icon-button"
                            aria-label="Копировать URL"
                            onClick={() => void copyObsUrl()}
                          >
                            <Copy size={17} />
                          </button>
                          <button
                            ref={regenerateButtonRef}
                            type="button"
                            className="lxst-icon-button"
                            aria-label="Создать новую ссылку OBS"
                            title="Создать новую ссылку OBS"
                            onClick={() => setShowRegenerateDialog(true)}
                            disabled={regeneratingObs}
                          >
                            {regeneratingObs ? <LoadingSpinner /> : <RotateCw size={17} aria-hidden="true" />}
                          </button>
                        </div>
                      </label>
                      {obsLinkMessage && <p className="lxst-obs-link-message" role={obsLinkError ? "alert" : "status"}>{obsLinkMessage}</p>}
                      <span className="lxst-copy-status" role="status">
                        {copyStatus && (
                          <>
                            <Check size={14} aria-hidden="true" /> {copyStatus}
                          </>
                        )}
                      </span>
                      <ol className="lxst-obs-steps">
                        <li>Добавьте в OBS источник «Браузер».</li>
                        <li>Вставьте URL оверлея.</li>
                        <li>
                          Установите размер {obs.canvasWidth} × {obs.canvasHeight}.
                        </li>
                      </ol>
                      <div className="lxst-obs-reload-row">
                        <button className="lxst-button lxst-button-secondary lxst-obs-reload" type="button"
                          disabled={reloadBusy} onClick={onReloadOverlay}>
                          {reloadBusy ? <LoadingSpinner /> : <RefreshCw size={17} aria-hidden="true" />} Перезагрузить OBS Overlay
                        </button>
                        <button type="button" className="lxst-info-button" aria-label="Помощь при зависании Browser Source"
                          aria-expanded={showReloadHint} onClick={() => setShowReloadHint((value) => !value)}
                          onBlur={() => setShowReloadHint(false)}>
                          <Info size={16} aria-hidden="true" />
                        </button>
                        <span className={`lxst-info-tooltip ${showReloadHint ? "lxst-info-tooltip-open" : ""}`} role="tooltip">
                          Если Browser Source не отвечает, перезагрузите источник в OBS вручную.
                        </span>
                      </div>
                      <OverlayReloadFeedback status={reloadStatus} message={reloadMessage} />
                    </>
                  ) : (
                    <p className="lxst-muted" role="status">
                      {loading
                        ? "Загружаем настройки OBS…"
                        : "Настройки OBS недоступны. Обновите страницу или проверьте сообщение об ошибке выше."}
                    </p>
                  )}
                </DashboardSection>
                <DashboardSection
                  id="moderators"
                  title="Модераторы"
                  className="lxst-moderators"
                  action={<button type="button" className="lxst-quiet-button lxst-moderators-refresh"
                    onClick={onRefreshModerators} disabled={moderatorsRefreshing}>
                    {moderatorsRefreshing ? <LoadingSpinner /> : <RefreshCw size={15} aria-hidden="true" />}
                    {moderatorsRefreshing ? "Обновляем список…" : "Обновить список"}
                  </button>}
                >
                  {moderatorsError && <p className="lxst-alert" role="alert">{moderatorsError}</p>}
                  <span className="lxst-sr-only" role="status">{moderatorsRefreshing ? "Обновляем список модераторов…" : ""}</span>
                  <label className="lxst-field lxst-search-field">
                    Поиск модератора
                    <input
                      type="search"
                      value={moderatorQuery}
                      onChange={(event) => setModeratorQuery(event.target.value)}
                      placeholder="Имя модератора"
                    />
                  </label>
                  <div className="lxst-list">
                    {filteredModerators.map((item) => (
                      <div className={`lxst-list-row lxst-moderator-card ${item.banned ? "lxst-moderator-denied" : "lxst-moderator-allowed"}`} key={item.id}>
                        <div className="lxst-list-person">
                          <ChannelAvatar name={item.displayName} src={item.twitchAvatarUrl} />
                          <strong>{item.displayName}</strong>
                        </div>
                        <button type="button" className="lxst-access-toggle" aria-pressed={!item.banned}
                          aria-label={`${item.banned ? "Разрешить" : "Запретить"} доступ модератору ${item.displayName}`}
                          disabled={changingModerators.includes(item.id)} onClick={() => onToggleModerator(item)}>
                          {changingModerators.includes(item.id) ? <LoadingSpinner /> : item.banned
                            ? <LockKeyhole size={17} aria-hidden="true" />
                            : <ShieldCheck size={17} aria-hidden="true" />}
                          <span>{item.banned ? "Доступ запрещён" : "Доступ разрешён"}</span>
                        </button>
                      </div>
                    ))}
                    {filteredModerators.length === 0 && (
                      <p className="lxst-empty">
                        {moderatorQuery
                          ? "По этому запросу модераторы не найдены."
                          : "Список модераторов пока пуст."}
                      </p>
                    )}
                  </div>
                </DashboardSection>
                <DashboardSection
                  id="canvas"
                  title="Холст"
                  className="lxst-canvas"
                >
                  {canvas ? (
                    <>
                      <label className="lxst-field">
                        Пресет разрешения
                        <select
                          value={presetValue(width, height)}
                          onChange={(event) => {
                            if (event.target.value === "custom") return;
                            const [nextWidth, nextHeight] = event.target.value.split("x");
                            setWidth(nextWidth);
                            setHeight(nextHeight);
                          }}
                        >
                          {[...presets].map((value) => (
                            <option value={value} key={value}>
                              {value.replace("x", " × ")}
                            </option>
                          ))}
                          <option value="custom">Пользовательский размер</option>
                        </select>
                      </label>
                      <div className="lxst-field-pair">
                        <label className="lxst-field">
                          Ширина
                          <input
                            type="number"
                            min="320"
                            max="7680"
                            step="1"
                            value={width}
                            onChange={(event) => setWidth(event.target.value)}
                          />
                        </label>
                        <label className="lxst-field">
                          Высота
                          <input
                            type="number"
                            min="320"
                            max="7680"
                            step="1"
                            value={height}
                            onChange={(event) => setHeight(event.target.value)}
                          />
                        </label>
                      </div>
                      <p className="lxst-muted">
                        Соотношение: {ratio ? `${ratio[0]}:${ratio[1]}` : "некорректный размер"}.
                        Допустимо 320–7680 px на ось, от 1:4 до 4:1.
                      </p>
                      <p className="lxst-muted">
                        Размер существующего Browser Source задаётся отдельно в OBS. Установите там
                        те же Width и Height.
                      </p>
                      {ratio && (
                        <div
                          className="lxst-canvas-preview"
                          aria-label={`Пропорции холста ${width} на ${height}`}
                        >
                          <svg
                            viewBox={`0 0 ${width} ${height}`}
                            preserveAspectRatio="xMidYMid meet"
                            aria-hidden="true"
                          >
                            <rect
                              x="2"
                              y="2"
                              width={Number(width) - 4}
                              height={Number(height) - 4}
                              fill="#252137"
                              stroke="#a76d80"
                              strokeWidth="4"
                            />
                          </svg>
                        </div>
                      )}
                      {changed && (
                        <div className="lxst-save-options">
                          <p>
                            Сохранить расположение оставит координаты и размеры без изменений.
                            Элементы за рамкой останутся в SPAWN.
                          </p>
                          <p>
                            Масштабировать композицию пересчитает X и Y независимо. При смене
                            пропорций форма элементов изменится; crop пересчитается по осям, угол
                            поворота сохранится.
                          </p>
                          <div>
                            <button
                              type="button"
                              className="lxst-button lxst-button-secondary"
                              disabled={!dimensionsValid || savingCanvas}
                              onClick={() => onSaveCanvas("keep")}
                            >
                              Сохранить расположение
                            </button>
                            <button
                              type="button"
                              className="lxst-button lxst-button-secondary"
                              disabled={!dimensionsValid || savingCanvas}
                              onClick={() => onSaveCanvas("scale")}
                            >
                              Масштабировать композицию
                            </button>
                          </div>
                        </div>
                      )}
                    </>
                  ) : (
                    <p className="lxst-muted" role="status">
                      {loading
                        ? "Загружаем настройки холста…"
                        : "Настройки холста недоступны. Обновите страницу или проверьте сообщение об ошибке выше."}
                    </p>
                  )}
                </DashboardSection>
                <DashboardSection
                  id="tts"
                  title="Twitch TTS"
                  className="lxst-tts"
                >
                  {tts && !tts.available ? (
                    <div className="lxst-tts-coming-soon" role="status">
                      <StatusPill tone="neutral">Скоро появится</StatusPill>
                      <p className="lxst-muted">
                        Озвучивание сообщений зрителей за баллы канала Twitch. Функция находится в разработке и станет доступна позже.
                      </p>
                    </div>
                  ) : tts ? (
                    <>
                      <p className="lxst-muted">
                        Модераторы используют <strong>!tts текст</strong> в чате. Для зрителей
                        доступна награда за баллы канала.
                      </p>
                      {!tts.configured && (
                        <div className="lxst-alert" role="alert">
                          На сервере не настроены Twitch OAuth или Python TTS.
                        </div>
                      )}
                      <div className="lxst-tts-status">
                        <span>
                          Подключение{" "}
                          <StatusPill
                            tone={
                              tts.connected
                                ? tts.ready && tts.enabled
                                  ? "good"
                                  : "warning"
                                : "neutral"
                            }
                          >
                            {tts.connected
                              ? `${tts.broadcasterLogin} · ${tts.enabled ? (tts.ready ? "онлайн" : "подключается") : "выключено"}`
                              : "Не подключено"}
                          </StatusPill>
                        </span>
                        <span>
                          Очередь <strong>{tts.queueLength} / 10</strong>
                        </span>
                      </div>
                      {tts.error && (
                        <div className="lxst-alert" role="alert">
                          {tts.error}
                        </div>
                      )}
                      {new URLSearchParams(window.location.search).get("tts") === "connected" && (
                        <p className="lxst-success" role="status">
                          Авторизация TTS обновлена.
                        </p>
                      )}
                      {tts.configured && (
                        <a
                          className="lxst-button lxst-button-secondary"
                          href={`/api/tts/channels/${encodeURIComponent(ownChannel.id)}/connect`}
                        >
                          {tts.connected ? "Переподключить Twitch TTS" : "Подключить Twitch TTS"}
                          <ArrowUpRight size={17} aria-hidden="true" />
                        </a>
                      )}
                      {tts.connected && (
                        <div className="lxst-tts-controls">
                          <button
                            className="lxst-button lxst-button-secondary"
                            type="button"
                            disabled={ttsBusy}
                            onClick={onToggleTts}
                          >
                            {tts.enabled ? "Выключить TTS" : "Включить TTS"}
                          </button>
                          <label className="lxst-field">
                            Стоимость награды
                            <input
                              type="number"
                              min="1"
                              max="1000000"
                              value={ttsCost}
                              onChange={(event) => setTtsCost(Number(event.target.value))}
                            />
                          </label>
                          <button
                            className="lxst-button lxst-button-primary"
                            type="button"
                            disabled={
                              ttsBusy ||
                              !Number.isInteger(ttsCost) ||
                              ttsCost < 1 ||
                              ttsCost > 1_000_000
                            }
                            onClick={onSaveTtsReward}
                          >
                            {ttsBusy
                              ? "Сохраняем…"
                              : tts.rewardId
                                ? "Сохранить стоимость"
                                : "Создать награду TTS"}
                          </button>
                        </div>
                      )}
                    </>
                  ) : (
                    <p className="lxst-muted" role="status">
                      {loading
                        ? "Загружаем настройки TTS…"
                        : "Настройки TTS недоступны. Обновите страницу или проверьте сообщение об ошибке выше."}
                    </p>
                  )}
                </DashboardSection>
              </>
            )}
          </div>
        ) : (
          <DashboardSection
            id="channels"
            title="Каналы модератора"
            className="lxst-channels"
          >
            <label className="lxst-field lxst-search-field">
              Поиск канала
              <input
                type="search"
                value={channelQuery}
                onChange={(event) => setChannelQuery(event.target.value)}
                placeholder="Название канала"
              />
            </label>
            {loading && channels.length === 0 ? (
              <p className="lxst-muted" role="status">
                Загружаем каналы…
              </p>
            ) : (
              <div className="lxst-channel-grid">
                {filteredChannels.map((channel) => (
                  <article className={`lxst-channel-card ${channel.status === "unconnected" ? "lxst-channel-card-compact" : ""}`} key={channel.twitchId}>
                    <div className="lxst-channel-card-top">
                      <ChannelAvatar name={channel.displayName} src={channel.avatarUrl} />
                      <StatusPill
                        tone={
                          channel.status === "connected"
                            ? "good"
                            : channel.status === "denied" || channel.status === "error"
                              ? "danger"
                              : "warning"
                        }
                      >
                        {statusText[channel.status]}
                      </StatusPill>
                    </div>
                    <h3>{channel.displayName}</h3>
                    <p>
                      {channel.status === "connected"
                        ? "Редактор доступен"
                        : channel.status === "denied"
                          ? "Доступ к редактору отозван"
                          : channel.status === "unconnected"
                            ? "Стример ещё не подключил LXST Overlay."
                            : "Не удалось проверить доступ к редактору."}
                    </p>
                    {channel.status === "connected" && channel.id && (
                      <a
                        className="lxst-button lxst-button-secondary"
                        href={`/channel/${encodeURIComponent(channel.id)}`}
                      >
                        Открыть редактор <ArrowUpRight size={17} aria-hidden="true" />
                      </a>
                    )}
                  </article>
                ))}
                {filteredChannels.length === 0 && (
                  <p className="lxst-empty">
                    {channelQuery
                      ? "По этому запросу каналы не найдены."
                      : "Доступных каналов пока нет. Проверьте роль модератора в Twitch и обновите список."}
                  </p>
                )}
              </div>
            )}
          </DashboardSection>
        )}
      </div>
      {showRegenerateDialog && <div className="lxst-dialog-backdrop">
        <div className="lxst-dialog" role="dialog" aria-modal="true" aria-labelledby="lxst-regenerate-title"
          aria-describedby="lxst-regenerate-description" onKeyDown={(event) => {
            if (event.key === "Escape") closeRegenerateDialog();
            if (event.key === "Tab") {
              const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"));
              if (event.shiftKey && document.activeElement === buttons[0]) {
                event.preventDefault(); buttons.at(-1)?.focus();
              } else if (!event.shiftKey && document.activeElement === buttons.at(-1)) {
                event.preventDefault(); buttons[0]?.focus();
              }
            }
          }}>
          <h2 id="lxst-regenerate-title">Создать новую ссылку OBS?</h2>
          <p id="lxst-regenerate-description">Старая ссылка сразу перестанет работать. После подтверждения необходимо заменить URL источника Browser Source в OBS.</p>
          {obsLinkError && obsLinkMessage && <p className="lxst-alert" role="alert">{obsLinkMessage}</p>}
          <div className="lxst-dialog-actions">
            <button ref={cancelRegenerateRef} type="button" className="lxst-button lxst-button-secondary"
              onClick={closeRegenerateDialog} disabled={regeneratingObs}>Отмена</button>
            <button type="button" className="lxst-button lxst-button-primary" onClick={() => void confirmRegenerate()}
              disabled={regeneratingObs}>{regeneratingObs && <LoadingSpinner />}Создать новую ссылку</button>
          </div>
        </div>
      </div>}
    </main>
  );
}
