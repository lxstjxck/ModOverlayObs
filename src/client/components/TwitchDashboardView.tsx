import { ArrowUpRight, Check, Copy, Eye, EyeOff, LogOut, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
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
import { BrandIdentity } from "./BrandIdentity";
import { ChannelAvatar, DashboardSection, StatusPill } from "./ui/DashboardUi";

type DashboardProps = {
  mode: TwitchMode;
  me: TwitchProfileView | null;
  channels: TwitchChannelView[];
  selectedId: string | null;
  onSelectChannel: (id: string) => void;
  moderators: TwitchModeratorView[];
  obs: ObsSetupView | null;
  canvas: StreamerView | null;
  presence: PresenceState | null;
  tts: TtsSetupView | null;
  reloadStatus: OverlayReloadStatus | null;
  reloadMessage: string;
  reloadBusy: boolean;
  onReloadOverlay: () => void;
  width: string;
  height: string;
  sourceWidth: string;
  sourceHeight: string;
  ttsCost: number;
  ratio: [number, number] | null;
  changed: boolean;
  dimensionsValid: boolean;
  loading: boolean;
  connecting: boolean;
  savingCanvas: boolean;
  ttsBusy: boolean;
  changingModerator: string | null;
  error: string;
  onRefresh: () => void;
  onLogout: () => void;
  onConnectChannel: () => void;
  onToggleModerator: (moderator: TwitchModeratorView) => void;
  onToggleTts: () => void;
  onSaveTtsReward: () => void;
  onSaveCanvas: (mode: CanvasChangeMode) => void;
  setWidth: (value: string) => void;
  setHeight: (value: string) => void;
  setSourceWidth: (value: string) => void;
  setSourceHeight: (value: string) => void;
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
    selectedId,
    onSelectChannel,
    moderators,
    obs,
    canvas,
    presence,
    tts,
    reloadStatus,
    reloadMessage,
    reloadBusy,
    onReloadOverlay,
    width,
    height,
    sourceWidth,
    sourceHeight,
    ttsCost,
    ratio,
    changed,
    dimensionsValid,
    loading,
    connecting,
    savingCanvas,
    ttsBusy,
    changingModerator,
    error,
    onRefresh,
    onLogout,
    onConnectChannel,
    onToggleModerator,
    onToggleTts,
    onSaveTtsReward,
    onSaveCanvas,
    setWidth,
    setHeight,
    setSourceWidth,
    setSourceHeight,
    setTtsCost
  } = props;
  const [query, setQuery] = useState("");
  const [showObsUrl, setShowObsUrl] = useState(false);
  const [copyStatus, setCopyStatus] = useState("");
  useEffect(() => {
    setShowObsUrl(false);
    setCopyStatus("");
  }, [obs?.overlayUrl]);
  const ownChannel =
    mode === "streamer"
      ? channels.find((channel) => channel.twitchId === selectedId && channel.status === "connected" && channel.id)
      : null;
  const streamerChannel = mode === "streamer" ? channels.find((channel) => channel.twitchId === selectedId) : null;
  const filteredModerators = moderators.filter((item) =>
    item.displayName.toLocaleLowerCase().includes(query.toLocaleLowerCase())
  );
  const filteredChannels = channels.filter((item) =>
    item.displayName.toLocaleLowerCase().includes(query.toLocaleLowerCase())
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
          <BrandIdentity />
          {me && (
            <nav
              className="lxst-dashboard-nav"
              aria-label={mode === "streamer" ? "Разделы панели управления" : "Разделы кабинета"}
            >
              {mode === "streamer" ? (
                <>
                  <a href="#overview">Обзор</a>
                  <a href="#obs">OBS</a>
                  <a href="#moderators">Модераторы</a>
                  <a href="#canvas">Холст</a>
                  <a href="#tts">TTS</a>
                </>
              ) : (
                <a href="#channels">Каналы</a>
              )}
            </nav>
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
        <div className="lxst-dashboard-title-row">
          <div>
              {mode === "moderator" && (
                <p className="landing-eyebrow">
                  <span className="landing-eyebrow-line" />{" "}
                  КАБИНЕТ МОДЕРАТОРА
                </p>
              )}
            <h1>{mode === "streamer" ? "Панель управления" : "Ваши каналы."}</h1>
            <p className="lxst-dashboard-lead">
              {mode === "streamer"
                ? "Канал, команда и настройки оверлея в одном месте."
                : "Выберите доступный канал и откройте его редактор."}
            </p>
          </div>
          {me && (
            <div className="lxst-dashboard-account">
              <ChannelAvatar name={me.displayName} src={me.avatarUrl} />
              <span>
                <strong>{me.displayName}</strong>
                <small>@{me.login}</small>
              </span>
            </div>
          )}
        </div>
        {me && (
          <div className="lxst-dashboard-toolbar">
            <label className="lxst-field">
              Канал
              <select value={selectedId ?? ""} onChange={(event) => onSelectChannel(event.target.value)}>
                {channels.map((channel) => (
                  <option key={channel.twitchId} value={channel.twitchId}>
                    {channel.displayName} ({channel.role === "owner" ? "владелец" : "модератор"})
                  </option>
                ))}
              </select>
            </label>
            <span>
              {mode === "streamer"
                ? "Панель управления"
                : "Каналы Twitch, которые вы модерируете"}
            </span>
            <button
              type="button"
              className="lxst-quiet-button"
              onClick={onRefresh}
              disabled={loading}
            >
              <RefreshCw size={15} className={loading ? "spin" : ""} aria-hidden="true" />
              {loading ? "Обновляем…" : "Обновить"}
            </button>
          </div>
        )}
        {error && (
          <div className="lxst-alert" role="alert">
            {error}
          </div>
        )}
        {!me ? (
          <div className="lxst-panel lxst-loading" role="status">
            <RefreshCw className="spin" size={22} aria-hidden="true" /> Проверяем вход через Twitch…
          </div>
        ) : mode === "streamer" ? (
          <div className="lxst-dashboard-grid" aria-busy={loading}>
            <DashboardSection
              id="overview"
              eyebrow="01 / КАНАЛ"
              title="Обзор"
              className="lxst-overview"
            >
              {loading ? (
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
                          ? "Клиент подключён"
                          : "Клиент не подключён"
                        : "Проверяется"}
                    </StatusPill>
                    <span>Статус браузерного клиента; показ сцены в OBS проверяется отдельно.</span>
                  </div>
                  <div className="lxst-overview-action">
                    {ownChannel?.id ? (
                      <a
                        className="lxst-button lxst-button-primary"
                        href={`/channel/${encodeURIComponent(ownChannel.id)}`}
                      >
                        Открыть редактор <ArrowUpRight size={18} aria-hidden="true" />
                      </a>
                    ) : !streamerChannel ? (
                      <button
                        className="lxst-button lxst-button-primary"
                        type="button"
                        disabled={connecting}
                        onClick={onConnectChannel}
                      >
                        {connecting ? "Подключаем…" : "Подключить канал"}
                      </button>
                    ) : (
                      <p className="lxst-muted">Проверьте доступ к каналу Twitch.</p>
                    )}
                  </div>
                </div>
              )}
            </DashboardSection>
            {ownChannel?.id && (
              <>
                <DashboardSection
                  id="obs"
                  eyebrow="02 / ТРАНСЛЯЦИЯ"
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
                        </div>
                      </label>
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
                      <button className="lxst-button lxst-button-secondary" type="button"
                        disabled={reloadBusy} onClick={onReloadOverlay}>
                        <RefreshCw size={17} aria-hidden="true" /> Перезагрузить OBS Overlay
                      </button>
                      <p className="lxst-muted" role="status">
                        {reloadMessage || (reloadStatus?.state === "waiting"
                          ? `Команда получена: ${reloadStatus.received} из ${reloadStatus.total}. Переподключились и получили состояние: ${reloadStatus.reconnected} из ${reloadStatus.total}.`
                          : reloadStatus?.state === "completed"
                            ? `OBS Overlay переподключён и синхронизирован: ${reloadStatus.reconnected} из ${reloadStatus.total}.`
                            : reloadStatus?.state === "timed_out"
                              ? `Время ожидания истекло. Команду получили ${reloadStatus.received} из ${reloadStatus.total}, переподключились ${reloadStatus.reconnected}. Если Browser Source завис, удалённая команда не поможет: перезагрузите источник в OBS вручную.`
                              : "Если Browser Source не отвечает, перезагрузите источник в OBS вручную.")}
                      </p>
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
                  eyebrow="03 / КОМАНДА"
                  title="Модераторы"
                  className="lxst-moderators"
                >
                  <p className="lxst-muted">
                    Список действующих Twitch-модераторов. Доступ можно отозвать или вернуть.
                  </p>
                  <label className="lxst-field lxst-search-field">
                    Поиск модератора
                    <input
                      type="search"
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      placeholder="Имя модератора"
                    />
                  </label>
                  <div className="lxst-list">
                    {filteredModerators.map((item) => (
                      <div className="lxst-list-row" key={item.id}>
                        <div className="lxst-list-person">
                          <ChannelAvatar name={item.displayName} src={item.twitchAvatarUrl} />
                          <strong>{item.displayName}</strong>
                        </div>
                        <label className="lxst-access-toggle">
                          <input
                            type="checkbox"
                            checked={!item.banned}
                            disabled={changingModerator !== null}
                            onChange={() => onToggleModerator(item)}
                          />
                          <span>
                            {changingModerator === item.id
                              ? "Обновляем…"
                              : item.banned
                                ? "Доступ запрещён"
                                : "Доступ разрешён"}
                          </span>
                        </label>
                      </div>
                    ))}
                    {filteredModerators.length === 0 && (
                      <p className="lxst-empty">
                        {query
                          ? "По этому запросу модераторы не найдены."
                          : "Список модераторов пока пуст."}
                      </p>
                    )}
                  </div>
                </DashboardSection>
                <DashboardSection
                  id="canvas"
                  eyebrow="04 / КОМПОЗИЦИЯ"
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
                      <div className="lxst-source-size">
                        <h3>Размер Browser Source в OBS</h3>
                        <p className="lxst-muted">
                          Введите текущий размер источника вручную. Сайт не меняет его в OBS.
                        </p>
                        <div className="lxst-field-pair">
                          <label className="lxst-field">
                            OBS Width
                            <input
                              type="number"
                              min="1"
                              step="1"
                              value={sourceWidth}
                              onChange={(event) => setSourceWidth(event.target.value)}
                            />
                          </label>
                          <label className="lxst-field">
                            OBS Height
                            <input
                              type="number"
                              min="1"
                              step="1"
                              value={sourceHeight}
                              onChange={(event) => setSourceHeight(event.target.value)}
                            />
                          </label>
                        </div>
                        {sourceWidth && sourceHeight ? (
                          (Number(sourceWidth) !== canvas.canvasWidth ||
                            Number(sourceHeight) !== canvas.canvasHeight) && (
                            <p className="lxst-warning" role="alert">
                              Размер Browser Source не совпадает с холстом {canvas.canvasWidth} ×{" "}
                              {canvas.canvasHeight}. Измените Width и Height в OBS вручную.
                            </p>
                          )
                        ) : (
                          <p className="lxst-muted">
                            Укажите размер Browser Source, чтобы проверить совпадение с холстом.
                          </p>
                        )}
                      </div>
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
                  eyebrow="05 / ОЗВУЧКА"
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
            eyebrow="01 / ДОСТУПНЫЕ КАНАЛЫ"
            title="Каналы модератора"
            className="lxst-channels"
          >
            <label className="lxst-field lxst-search-field">
              Поиск канала
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Название канала"
              />
            </label>
            {loading ? (
              <p className="lxst-muted" role="status">
                Загружаем каналы…
              </p>
            ) : (
              <div className="lxst-channel-grid">
                {filteredChannels.map((channel) => (
                  <article className="lxst-channel-card" key={channel.twitchId}>
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
                          : "Редактор сейчас недоступен"}
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
                    {query
                      ? "По этому запросу каналы не найдены."
                      : "Доступных каналов пока нет. Проверьте роль модератора в Twitch и обновите список."}
                  </p>
                )}
              </div>
            )}
          </DashboardSection>
        )}
      </div>
    </main>
  );
}
