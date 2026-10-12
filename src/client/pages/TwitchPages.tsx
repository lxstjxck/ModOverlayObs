import { useEffect, useState } from "react";
import { api } from "../api";
import { BrandMark } from "../components/BrandMark";

type Mode = "streamer" | "moderator";
type TwitchMe = {
  user: { id: string; login: string; displayName: string; avatarUrl: string | null };
  mode: Mode;
  csrfToken: string;
};

const errors: Record<string, string> = {
  invalid_state: "Сессия входа истекла или ссылка уже использована. Попробуйте снова.",
  denied: "Вход через Twitch отменён.",
  legacy_session: "Выйдите из старой учётной записи перед входом через Twitch.",
  invalid_response: "Twitch вернул некорректный ответ. Попробуйте снова.",
  twitch_unavailable: "Не удалось завершить вход через Twitch. Попробуйте позже."
};

export function TwitchLandingPage() {
  const error = new URLSearchParams(window.location.search).get("oauth_error");
  return (
    <main className="login-page">
      <div className="login-form">
        <div className="brand-mark">
          <BrandMark />
        </div>
        <p className="login-eyebrow">BROADCAST CONTROL / ACCESS</p>
        <h1>ModOverlayObs</h1>
        <p>Выберите роль для входа через Twitch.</p>
        {error && <div className="error-box">{errors[error] ?? "Ошибка авторизации."}</div>}
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

export function TwitchPlaceholderPage({ mode }: { mode: Mode }) {
  const [me, setMe] = useState<TwitchMe | null>(null);
  useEffect(() => {
    void api<TwitchMe>("/api/auth/twitch/me")
      .then((value) => {
        if (value.mode !== mode) {
          window.location.replace(value.mode === "streamer" ? "/streamer" : "/channels");
        } else {
          setMe(value);
        }
      })
      .catch(() => {
        window.location.replace("/login");
      });
  }, [mode]);

  async function logout() {
    await api("/api/auth/logout", { method: "POST" });
    window.location.replace("/login");
  }

  return (
    <main className="login-page">
      <div className="login-form">
        <div className="brand-mark">
          <BrandMark />
        </div>
        <h1>{mode === "streamer" ? "Панель стримера" : "Выбор каналов"}</h1>
        {me ? (
          <>
            <p>
              Вы вошли как {me.user.displayName} (@{me.user.login}).
            </p>
            <p>
              {mode === "streamer"
                ? "Панель стримера появится на следующем этапе."
                : "Список каналов появится на следующем этапе."}
            </p>
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
