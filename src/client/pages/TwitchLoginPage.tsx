import { ArrowLeft, ArrowUpRight, LockKeyhole, Radio, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { BrandIdentity } from "../components/BrandIdentity";

const oauthErrors: Record<string, string> = {
  invalid_state: "Сессия входа истекла. Попробуйте снова.",
  denied: "Вход через Twitch отменён. Вы можете выбрать роль и попробовать снова.",
  legacy_session: "Выйдите из старой учётной записи перед входом через Twitch.",
  invalid_response: "Twitch вернул некорректный ответ. Попробуйте снова.",
  twitch_unavailable: "Не удалось завершить вход через Twitch. Попробуйте позже."
};

export function TwitchLoginPage() {
  const error = new URLSearchParams(window.location.search).get("oauth_error");
  const [loadingMode, setLoadingMode] = useState<"streamer" | "moderator" | null>(null);

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
          <p>Войдите через Twitch и выберите, как будете работать с оверлеем.</p>
          <div className="lxst-auth-aside">
            <ShieldCheck size={20} aria-hidden="true" />
            <span>Доступ к каналам и действиям определяется вашей ролью в Twitch.</span>
          </div>
        </div>
        <section
          className="lxst-auth-card"
          aria-labelledby="auth-title"
          aria-busy={loadingMode !== null}
        >
          <div className="lxst-auth-card-top">
            <Radio size={22} aria-hidden="true" />
            <span>01 / ВХОД</span>
          </div>
          <h2 id="auth-title">Войти через Twitch</h2>
          <p>Подключите канал как стример или откройте доступные каналы как модератор.</p>
          {error && (
            <div className="lxst-alert" role="alert">
              {oauthErrors[error] ?? "Ошибка авторизации. Попробуйте снова."}
            </div>
          )}
          <a
            className="lxst-button lxst-button-primary"
            href="/api/auth/twitch/start/streamer"
            onClick={() => setLoadingMode("streamer")}
          >
            <span>
              {loadingMode === "streamer" ? "Перенаправляем в Twitch…" : "Продолжить как стример"}
            </span>
            <ArrowUpRight size={18} aria-hidden="true" />
          </a>
          <a
            className="lxst-button lxst-button-secondary"
            href="/api/auth/twitch/start/moderator"
            onClick={() => setLoadingMode("moderator")}
          >
            <span>
              {loadingMode === "moderator"
                ? "Перенаправляем в Twitch…"
                : "Продолжить как модератор"}
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
