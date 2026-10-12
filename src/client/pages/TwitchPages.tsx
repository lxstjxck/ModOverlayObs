import { useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";
import type {
  ObsSetupView,
  PresenceState,
  CanvasChangeMode,
  StreamerView,
  TwitchChannelView,
  TwitchMode,
  TwitchModeratorView,
  TwitchProfileView
} from "../../shared/types";
import { api } from "../api";
import { BrandMark } from "../components/BrandMark";

type TwitchMe = { user: TwitchProfileView; mode: TwitchMode; csrfToken: string };
const statusText = {
  connected: "Подключён",
  unconnected: "Не подключён",
  denied: "Доступ запрещён",
  error: "Ошибка проверки"
};
const oauthErrors: Record<string, string> = {
  invalid_state: "Сессия входа истекла. Попробуйте снова.",
  denied: "Вход через Twitch отменён.",
  legacy_session: "Выйдите из старой учётной записи перед входом через Twitch.",
  invalid_response: "Некорректный ответ Twitch.",
  twitch_unavailable: "Не удалось завершить вход через Twitch."
};

export function TwitchLandingPage() {
  const error = new URLSearchParams(window.location.search).get("oauth_error");
  return (
    <main className="login-page">
      <div className="login-form">
        <div className="brand-mark">
          <BrandMark />
        </div>
        <h1>ModOverlayObs</h1>
        <p>Выберите способ входа через Twitch.</p>
        {error && <div className="error-box">{oauthErrors[error] ?? "Ошибка авторизации."}</div>}
        <a className="primary" href="/api/auth/twitch/start/streamer">
          Стример
        </a>
        <a className="primary" href="/api/auth/twitch/start/moderator">
          Модератор
        </a>
        <p>
          <a href="/legacy-login">Вход по паролю для существующей панели</a>
        </p>
      </div>
    </main>
  );
}

export function TwitchDashboardPage({ mode }: { mode: TwitchMode }) {
  const [me, setMe] = useState<TwitchMe | null>(null);
  const [channels, setChannels] = useState<TwitchChannelView[]>([]);
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
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [changingModerator, setChangingModerator] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);

  async function load(currentMode: TwitchMode) {
    setLoading(true);
    setError("");
    setChannels([]);
    setObs(null);
    setCanvas(null);
    canvasRevisionRef.current = "";
    setPresence(null);
    setModerators([]);
    try {
      const result = await api<{ channels: TwitchChannelView[] }>("/api/auth/twitch/channels");
      setChannels(result.channels);
      const own = result.channels.find((channel) => channel.status === "connected" && channel.id);
      if (currentMode === "streamer" && own?.id) {
        const id = own.id;
        setObs(await api<ObsSetupView>("/api/obs", { headers: { "X-Channel-Id": id } }));
        const current = await api<{ streamer: StreamerView }>("/api/auth/me", { headers: { "X-Channel-Id": id } });
        setCanvas(current.streamer);
        canvasRevisionRef.current = current.streamer.canvasRevision;
        setWidth(String(current.streamer.canvasWidth));
        setHeight(String(current.streamer.canvasHeight));
        const list = await api<{ moderators: TwitchModeratorView[] }>(
          `/api/auth/twitch/channels/${encodeURIComponent(id)}/moderators`
        );
        setModerators(list.moderators);
      } else {
        setObs(null);
        setModerators([]);
      }
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : "Не удалось проверить доступ через Twitch"
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void api<TwitchMe>("/api/auth/twitch/me")
      .then((value) => {
        if (value.mode !== mode)
          window.location.replace(value.mode === "streamer" ? "/streamer" : "/channels");
        else {
          setMe(value);
          void load(mode);
        }
      })
      .catch(() => window.location.replace("/login"));
  }, [mode]);

  const ownChannel =
    mode === "streamer"
      ? channels.find((channel) => channel.status === "connected" && channel.id)
      : null;
  const streamerChannel = mode === "streamer" ? channels[0] : null;
  useEffect(() => {
    if (!ownChannel?.id) return;
    setSourceWidth(window.localStorage.getItem(`obs-width:${ownChannel.id}`) ?? "");
    setSourceHeight(window.localStorage.getItem(`obs-height:${ownChannel.id}`) ?? "");
  }, [ownChannel?.id]);
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

  async function connectChannel() {
    if (connecting) return;
    setConnecting(true);
    setError("");
    try {
      await api("/api/auth/twitch/channels", { method: "POST" });
      await load("streamer");
    } catch (connectError) {
      setError(connectError instanceof Error ? connectError.message : "Не удалось подключить канал");
    } finally {
      setConnecting(false);
    }
  }

  return (
    <main className="login-page">
      <div className="login-form twitch-dashboard">
        <div className="brand-mark">
          <BrandMark />
        </div>
        <h1>{mode === "streamer" ? "Панель стримера" : "Каналы модератора"}</h1>
        {me ? (
          <>
            <div className="twitch-profile">
              {me.user.avatarUrl && <img src={me.user.avatarUrl} alt="" />}
              <span>
                {me.user.displayName} (@{me.user.login})
              </span>
            </div>
            <button type="button" onClick={() => void load(mode)} disabled={loading}>
              {loading ? "Обновляем…" : "Обновить список"}
            </button>
            {error && (
              <div className="error-box" role="alert">
                {error}
              </div>
            )}
            {mode === "streamer" && (
              <>
                <p>
                  Канал:{" "}
                  {streamerChannel
                    ? statusText[streamerChannel.status]
                    : loading
                      ? "проверяется"
                      : "не привязан"}
                </p>
                {!streamerChannel && !loading && (
                  <button className="primary" type="button" disabled={connecting} onClick={() => void connectChannel()}>
                    {connecting ? "Подключаем…" : "Подключить канал"}
                  </button>
                )}
                {ownChannel?.id && (
                  <>
                    <p>
                      <a href={`/channel/${encodeURIComponent(ownChannel.id)}`}>Открыть редактор</a>
                    </p>
                    {obs && (
                      <section>
                        <h2>OBS Browser Source</h2>
                        <div className="copy-row">
                          <input aria-label="OBS Overlay URL" value={obs.overlayUrl} readOnly />
                          <button
                            type="button"
                            onClick={() => void navigator.clipboard.writeText(obs.overlayUrl)}
                          >
                            Копировать
                          </button>
                        </div>
                        <p>
                          Добавьте Browser Source в OBS, вставьте URL и задайте размер{" "}
                          {obs.canvasWidth} × {obs.canvasHeight}. Храните URL как секрет.
                        </p>
                        <p>
                          Соединение overlay:{" "}
                          {presence
                            ? presence.overlayConnected
                              ? "подключено"
                              : "не подключено"
                            : "проверяется"}
                          . Это статус браузерного клиента, а не подтверждение показа сцены в OBS.
                        </p>
                      </section>
                    )}
                    <p>TTS для новых Twitch-каналов пока недоступен. Для существующего legacy-канала настройте TTS через старую панель OBS Setup.</p>
                    {canvas && <section className="canvas-settings">
                      <h2>Настройки холста</h2>
                      <label className="field">Разрешение
                        <select value={presetValue(width, height)} onChange={(event) => {
                          if (event.target.value === "custom") return;
                          const [nextWidth, nextHeight] = event.target.value.split("x");
                          setWidth(nextWidth); setHeight(nextHeight);
                        }}>
                          {["1280x720", "1920x1080", "2560x1440", "3840x2160", "1080x1920", "720x1280"].map((value) =>
                            <option value={value} key={value}>{value.replace("x", " × ")}</option>
                          )}
                          <option value="custom">Пользовательское разрешение</option>
                        </select>
                      </label>
                      <div className="canvas-size-fields">
                        <label className="field">Width<input type="number" min="320" max="7680" step="1" value={width} onChange={(event) => setWidth(event.target.value)} /></label>
                        <label className="field">Height<input type="number" min="320" max="7680" step="1" value={height} onChange={(event) => setHeight(event.target.value)} /></label>
                      </div>
                      <p>Соотношение сторон: {ratio ? `${ratio[0]}:${ratio[1]}` : "некорректный размер"}</p>
                      {ratio && <div className="canvas-proportion" aria-label={`Пропорции холста ${width} на ${height}`}>
                        <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid meet" aria-hidden="true">
                          <rect x="2" y="2" width={Number(width) - 4} height={Number(height) - 4} fill="#273038" stroke="#d45454" strokeWidth="4" />
                        </svg>
                      </div>}
                      <p>Допустимо 320–7680 пикселей на ось, соотношение от 1:4 до 4:1.</p>
                      {changed && <>
                        <p>Сохранить расположение оставит координаты и размеры без изменений. Элементы за рамкой останутся в SPAWN.</p>
                        <p>Масштабировать композицию пересчитает X и Y независимо. При смене пропорций форма элементов изменится; crop пересчитается по осям, угол поворота сохранится.</p>
                        <div className="canvas-save-actions">
                          <button type="button" disabled={!dimensionsValid || savingCanvas} onClick={() => void saveCanvas("keep")}>Сохранить расположение</button>
                          <button type="button" disabled={!dimensionsValid || savingCanvas} onClick={() => void saveCanvas("scale")}>Масштабировать композицию</button>
                        </div>
                      </>}
                      <h3>Размер Browser Source в OBS</h3>
                      <p>Введите текущие Width и Height источника вручную. Сайт не меняет размер Browser Source в OBS.</p>
                      <div className="canvas-size-fields">
                        <label className="field">OBS Width<input type="number" min="1" step="1" value={sourceWidth} onChange={(event) => {
                          setSourceWidth(event.target.value);
                          window.localStorage.setItem(`obs-width:${ownChannel.id}`, event.target.value);
                        }} /></label>
                        <label className="field">OBS Height<input type="number" min="1" step="1" value={sourceHeight} onChange={(event) => {
                          setSourceHeight(event.target.value);
                          window.localStorage.setItem(`obs-height:${ownChannel.id}`, event.target.value);
                        }} /></label>
                      </div>
                      {sourceWidth && sourceHeight ?
                        (Number(sourceWidth) !== canvas.canvasWidth || Number(sourceHeight) !== canvas.canvasHeight) &&
                          <p className="canvas-warning" role="alert">Размер Browser Source не совпадает с холстом {canvas.canvasWidth} × {canvas.canvasHeight}. Измените Width и Height в OBS вручную.</p>
                        : <p className="canvas-warning">Укажите размер Browser Source, чтобы проверить совпадение с холстом.</p>}
                    </section>}
                    <section>
                      <h2>Действующие Twitch-модераторы</h2>
                      <input
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                        placeholder="Поиск модератора"
                        aria-label="Поиск модератора"
                      />
                      {moderators
                        .filter((item) =>
                          item.displayName.toLocaleLowerCase().includes(query.toLocaleLowerCase())
                        )
                        .map((item) => (
                          <div className="twitch-person" key={item.id}>
                            {item.twitchAvatarUrl && <img src={item.twitchAvatarUrl} alt="" />}
                            <span>{item.displayName}</span>
                            <label>
                              <input
                                type="checkbox"
                                checked={!item.banned}
                                disabled={changingModerator !== null}
                                onChange={() => void toggle(item)}
                              />{" "}
                              Доступ к полотну
                            </label>
                          </div>
                        ))}
                    </section>
                  </>
                )}
              </>
            )}
            {mode === "moderator" && (
              <section>
                <h2>Ваши каналы</h2>
                {channels.length === 0 && !loading && <p>Каналы не найдены.</p>}
                {channels.map((channel) => (
                  <div className="twitch-person" key={channel.twitchId}>
                    {channel.avatarUrl && <img src={channel.avatarUrl} alt="" />}
                    <span>{channel.displayName}</span>
                    <span>{statusText[channel.status]}</span>
                    {channel.status === "connected" && channel.id && (
                      <a href={`/channel/${encodeURIComponent(channel.id)}`}>Открыть редактор</a>
                    )}
                  </div>
                ))}
              </section>
            )}
            <button className="primary" type="button" onClick={() => void logout()}>
              Выйти
            </button>
          </>
        ) : (
          <p>Проверяем вход…</p>
        )}
      </div>
    </main>
  );
}

const presets = new Set(["1280x720", "1920x1080", "2560x1440", "3840x2160", "1080x1920", "720x1280"]);
function presetValue(width: string, height: string): string {
  const value = `${width}x${height}`;
  return presets.has(value) ? value : "custom";
}
function reduceRatio(width: number, height: number): [number, number] {
  const gcd = (a: number, b: number): number => b === 0 ? a : gcd(b, a % b);
  const divisor = gcd(width, height);
  return [width / divisor, height / divisor];
}
