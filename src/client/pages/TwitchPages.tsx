import { useEffect, useState } from "react";
import { io } from "socket.io-client";
import type {
  ObsSetupView,
  PresenceState,
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
  const [presence, setPresence] = useState<PresenceState | null>(null);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [changingModerator, setChangingModerator] = useState<string | null>(null);

  async function load(currentMode: TwitchMode) {
    setLoading(true);
    setError("");
    setChannels([]);
    setObs(null);
    setPresence(null);
    setModerators([]);
    try {
      const result = await api<{ channels: TwitchChannelView[] }>("/api/auth/twitch/channels");
      setChannels(result.channels);
      const own = result.channels.find((channel) => channel.status === "connected" && channel.id);
      if (currentMode === "streamer" && own?.id) {
        const id = own.id;
        setObs(await api<ObsSetupView>("/api/obs", { headers: { "X-Channel-Id": id } }));
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
    const socket = io({ path: "/socket.io", query: { channelId: ownChannel.id } });
    socket.on("presence:update", (value: PresenceState) => setPresence(value));
    socket.on("disconnect", () => setPresence(null));
    return () => {
      socket.disconnect();
      setPresence(null);
    };
  }, [ownChannel?.id]);

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
                {!streamerChannel && !loading && !error && (
                  <p>
                    Для привязки существующего канала выйдите из Twitch, войдите в{" "}
                    <a href="/legacy-login">legacy OWNER</a> и запустите привязку Twitch из этого
                    сеанса.
                  </p>
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
