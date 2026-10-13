import { ArrowLeft, ArrowUpRight, LockKeyhole, Radio, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { BrandIdentity } from "../components/BrandIdentity";
import { api } from "../api";

const oauthErrors: Record<string, string> = {
  invalid_state: "Сессия входа истекла. Попробуйте снова.",
  denied: "Вход через Twitch отменён. Разрешите доступ и попробуйте снова.",
  insufficient_scope: "Twitch не выдал все необходимые разрешения. Разрешите оба доступа и попробуйте снова.",
  legacy_session: "Выйдите из старой учётной записи перед входом через Twitch.",
  invalid_response: "Twitch вернул некорректный ответ. Попробуйте снова.",
  twitch_unavailable: "Не удалось завершить вход через Twitch. Попробуйте позже."
};

export function TwitchLoginPage() {
  const error = new URLSearchParams(window.location.search).get("oauth_error");
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (error) return;
    void api("/api/auth/twitch/me")
      .then(() => window.location.replace("/channels"))
      .catch(() => undefined);
  }, [error]);

  return (
    <main className="lxst-auth-page">
      <header className="lxst-auth-header lxst-shell">
        <BrandIdentity />
        <a href="/" className="lxst-back-link">
          <ArrowLeft size={16} aria-hidden="true" /> На главную
        </a>
      </header>
      <div className="lxst-auth-content lxst-shell">
        <div className="lxst-auth-intro">
          <p className="landing-eyebrow">
            <span className="landing-eyebrow-line" /> ДОСТУП К ПАНЕЛИ
          </p>
          <h1>
            Эфир начинается <em>здесь.</em>
          </h1>
          <p>Войдите через Twitch, чтобы открыть свой канал и каналы, где вы модератор.</p>
          <div className="lxst-auth-aside">
            <ShieldCheck size={20} aria-hidden="true" />
            <span>Доступ к каналам и действиям определяется вашей ролью в Twitch.</span>
          </div>
        </div>
        <section
          className="lxst-auth-card"
          aria-labelledby="auth-title"
          aria-busy={loading}
        >
          <div className="lxst-auth-card-top">
            <Radio size={22} aria-hidden="true" />
            <span>01 / ВХОД</span>
          </div>
          <h2 id="auth-title">Войти через Twitch</h2>
          <p>Один вход откроет все доступные каналы. Twitch запросит права на проверку вашего канала и модерации.</p>
          {error && (
            <div className="lxst-alert" role="alert">
              {oauthErrors[error] ?? "Ошибка авторизации. Попробуйте снова."}
            </div>
          )}
          <a
            className="lxst-button lxst-button-primary"
            href="/api/auth/twitch/start/unified"
            onClick={() => setLoading(true)}
          >
            <span>
              {loading ? "Перенаправляем в Twitch…" : "Продолжить через Twitch"}
            </span>
            <ArrowUpRight size={18} aria-hidden="true" />
          </a>
          <div className="lxst-auth-legacy">
            <LockKeyhole size={14} aria-hidden="true" />
            <a href="/legacy-login">Вход по паролю для существующего OWNER</a>
          </div>
        </section>
      </div>
      <footer className="lxst-auth-footer lxst-shell">
        LXST Overlay{" "}
        <span>
          by{" "}
          <a href="https://github.com/lxstjxck" target="_blank" rel="noopener noreferrer">
            lxstjxck
          </a>
        </span>
      </footer>
    </main>
  );
}
