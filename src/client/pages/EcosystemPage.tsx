import { ArrowDown, ArrowUpRight } from "lucide-react";
import { BrandIdentity } from "../components/BrandIdentity";

function OverlayIcon() {
  return (
    <svg viewBox="0 0 64 64" fill="none" aria-hidden="true" focusable="false">
      <rect x="8" y="12" width="48" height="34" rx="5" stroke="currentColor" strokeWidth="2" />
      <path
        d="M8 22h48M16 17h2M22 17h2M28 17h2M19 52h26M32 46v6"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <rect x="17" y="28" width="15" height="11" rx="2" stroke="currentColor" strokeWidth="2" />
      <path d="m39 29 8 5-8 5V29Z" fill="currentColor" />
    </svg>
  );
}

function ChatIcon() {
  return (
    <svg viewBox="0 0 64 64" fill="none" aria-hidden="true" focusable="false">
      <path
        d="M12 14h40a4 4 0 0 1 4 4v24a4 4 0 0 1-4 4H29L18 54v-8h-6a4 4 0 0 1-4-4V18a4 4 0 0 1 4-4Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path d="M18 26h28M18 33h20" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path
        d="m44 34 4 4-4 4"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function EcosystemPage() {
  return (
    <main className="landing-page ecosystem-page">
      <header className="landing-header landing-shell ecosystem-header">
        <BrandIdentity className="landing-brand" product={null} />
        <nav aria-label="Навигация по странице">
          <a href="#services">Сервисы</a>
        </nav>
        <a
          className="ecosystem-github"
          href="https://github.com/lxstjxck"
          target="_blank"
          rel="noopener noreferrer"
        >
          GitHub <ArrowUpRight size={15} aria-hidden="true" />
        </a>
      </header>

      <section className="ecosystem-hero landing-shell" aria-labelledby="ecosystem-title">
        <div className="ecosystem-hero-glow" aria-hidden="true" />
        <div className="ecosystem-hero-content">
          <p className="landing-eyebrow">
            <span className="landing-eyebrow-line" /> LXST ECOSYSTEM
          </p>
          <h1 id="ecosystem-title">
            Всё для твоего <em>стрима.</em>
          </h1>
          <p className="ecosystem-hero-lead">
            Инструменты для стримеров и модераторов в одной экосистеме.
          </p>
          <a className="ecosystem-scroll-link" href="#services">
            <ArrowDown size={16} aria-hidden="true" /> Смотреть сервисы
          </a>
        </div>
        <div className="ecosystem-hero-art" aria-hidden="true">
          <span className="ecosystem-art-ring ecosystem-art-ring-one" />
          <span className="ecosystem-art-ring ecosystem-art-ring-two" />
          <span className="ecosystem-art-mark">LXST</span>
        </div>
      </section>

      <section
        className="ecosystem-services landing-shell"
        id="services"
        aria-labelledby="services-title"
      >
        <div className="ecosystem-section-heading">
          <div>
            <p className="landing-eyebrow">01 / СЕРВИСЫ</p>
            <h2 id="services-title">Твои инструменты для эфира.</h2>
          </div>
          <p>Начни с оверлея. Новые возможности уже в планах.</p>
        </div>

        <div className="ecosystem-service-grid">
          <article className="ecosystem-service-card ecosystem-service-overlay">
            <div className="ecosystem-card-top">
              <span className="ecosystem-service-icon">
                <OverlayIcon />
              </span>
              <span className="ecosystem-status ecosystem-status-live">Доступен</span>
            </div>
            <div>
              <p className="ecosystem-card-kicker">01 / ПРЯМОЙ ЭФИР</p>
              <h3>LXST Overlay</h3>
              <p className="ecosystem-card-description">
                Управляй изображениями, видео, текстом и смайлами на трансляции вместе с командой
                модераторов.
              </p>
            </div>
            <a className="ecosystem-card-link" href="/overlay">
              Подробнее <ArrowUpRight size={18} aria-hidden="true" />
            </a>
          </article>

          <article className="ecosystem-service-card ecosystem-service-chat">
            <div className="ecosystem-card-top">
              <span className="ecosystem-service-icon">
                <ChatIcon />
              </span>
              <span className="ecosystem-status">Скоро появится</span>
            </div>
            <div>
              <p className="ecosystem-card-kicker">02 / ОБЩЕНИЕ</p>
              <h3>LXST Chat</h3>
              <p className="ecosystem-card-description">
                Кастомный Twitch-чат для OBS с поддержкой смайлов, значков пользователей и гибкого
                оформления.
              </p>
            </div>
            <span className="ecosystem-card-coming">Скоро появится</span>
          </article>
        </div>
      </section>

      <footer className="landing-footer landing-shell ecosystem-footer">
        <span>LXST</span>
        <span>Инструменты для твоего эфира.</span>
        <span>
          Created by{" "}
          <a href="https://github.com/lxstjxck" target="_blank" rel="noopener noreferrer">
            lxstjxck
          </a>
        </span>
      </footer>
    </main>
  );
}
