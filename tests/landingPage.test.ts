import * as React from "react";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TwitchLandingPage } from "../src/client/pages/TwitchPages";
import { TwitchLoginPage } from "../src/client/pages/TwitchLoginPage";
import { App } from "../src/client/App";
import { setPublicPageMetadata } from "../src/client/publicPageMetadata";
import { isTrustedPopupMessage } from "../src/client/publicTwitchAuth";
import { OverlayServiceCard } from "../src/client/pages/EcosystemPage";

vi.mock("../src/client/appVersion", () => ({ appVersion: "test" }));

afterEach(() => vi.unstubAllGlobals());

function renderLanding(search = "") {
  vi.stubGlobal("React", React);
  vi.stubGlobal("window", { location: { search } });
  return renderToStaticMarkup(React.createElement(TwitchLandingPage));
}

describe("public landing page", () => {
  it("shows both services at / without routing the Overlay card before the session check", () => {
    vi.stubGlobal("React", React);
    vi.stubGlobal("window", { location: { pathname: "/", search: "" } });
    const html = renderToStaticMarkup(React.createElement(App));
    expect(html).toContain("LXST ECOSYSTEM");
    expect(html).toContain("LXST Overlay");
    expect(html).toContain("LXST Chat");
    expect(html).not.toContain('href="/overlay"');
    expect(html).toContain('href="#services"');
    expect(html).toContain('href="/" aria-label="LXST — главная"');
    expect(html).toContain("Скоро появится");
    expect(html).not.toContain('href="/chat"');
    expect(html).not.toContain('href="/app"');
    expect(html).toMatch(/<a class="ecosystem-service-card ecosystem-service-overlay" aria-disabled="true" aria-busy="true" tabindex="-1">/);
    expect(html).toContain("Проверяем доступ…");
    expect(html).toMatch(/<article class="ecosystem-service-card ecosystem-service-chat">/);
    expect(html).not.toMatch(/<a\s[^>]*ecosystem-service-chat/);
    const overlayCard = html.match(/<a class="ecosystem-service-card ecosystem-service-overlay"[\s\S]*?<\/a>/)?.[0];
    expect(overlayCard?.match(/<a\s/g)).toHaveLength(1);
  });

  it("routes the full Overlay card from the verified session state", () => {
    vi.stubGlobal("React", React);
    const renderCard = (status: "authenticated" | "guest" | "loading" | "unavailable") =>
      renderToStaticMarkup(React.createElement(OverlayServiceCard, { status }));
    const authenticated = renderCard("authenticated");
    expect(authenticated).toContain('href="/channels"');
    expect(authenticated).toContain("Мои каналы");
    expect(authenticated).not.toContain('aria-disabled="true"');
    expect(authenticated.match(/<a\s/g)).toHaveLength(1);

    const guest = renderCard("guest");
    expect(guest).toContain('href="/overlay"');
    expect(guest).toContain("Подробнее");
    expect(guest).not.toContain('aria-disabled="true"');
    expect(guest.match(/<a\s/g)).toHaveLength(1);

    const loading = renderCard("loading");
    expect(loading).not.toContain("href=");
    expect(loading).toContain('aria-busy="true"');
    expect(loading).toContain('aria-disabled="true"');
    expect(loading).toContain('tabindex="-1"');
    expect(loading).toContain("Проверяем доступ…");

    const unavailable = renderCard("unavailable");
    expect(unavailable).not.toContain("href=");
    expect(unavailable).toContain("Не удалось проверить вход");
    expect(renderCard("guest")).toContain('href="/overlay"');
  });

  it("keeps the complete Overlay landing at /overlay with a route home", () => {
    vi.stubGlobal("React", React);
    vi.stubGlobal("window", { location: { pathname: "/overlay", search: "" } });
    const html = renderToStaticMarkup(React.createElement(App));
    expect(html).toContain("Browser Source");
    expect(html).toContain('id="how-it-works"');
    expect(html).toContain('id="features"');
    expect(html).toContain('href="/"');
    expect(html).toContain('href="/login"');
  });

  it("preserves the existing dashboard, editor, login and OBS routes", () => {
    vi.stubGlobal("React", React);
    for (const [path, pageName] of [
      ["/login", "TwitchLoginPage"],
      ["/oauth/popup", "TwitchPopupPage"],
      ["/legacy-login", "LoginPage"],
      ["/streamer", "TwitchDashboardPage"],
      ["/channels", "TwitchDashboardPage"],
      ["/obs-setup", "ObsSetupPage"],
      ["/app", "ModeratorApp"],
      ["/channel/example", "ModeratorApp"],
      ["/overlay/example-token", "OverlayPage"]
    ]) {
      vi.stubGlobal("window", { location: { pathname: path } });
      const page = App() as React.ReactElement;
      expect((page.type as { name: string }).name).toBe(pageName);
      if (path === "/overlay/example-token") {
        expect(page.props).toEqual({ token: "example-token" });
      }
    }
  });

  it("keeps smooth anchor scrolling and honors reduced motion", () => {
    const baseCss = readFileSync(new URL("../src/client/styles.css", import.meta.url), "utf8");
    const landingCss = readFileSync(
      new URL("../src/client/styles/landing.css", import.meta.url),
      "utf8"
    );
    const ecosystemCss = readFileSync(
      new URL("../src/client/styles/ecosystem.css", import.meta.url),
      "utf8"
    );
    expect(baseCss).toContain("scroll-behavior: smooth");
    expect(baseCss).toContain("@media (prefers-reduced-motion: reduce)");
    expect(ecosystemCss).toContain("scroll-margin-top: 108px");
    expect(ecosystemCss).toContain("@media (prefers-reduced-motion: reduce)");
    expect(landingCss).toContain("@media (prefers-reduced-motion: reduce)");
  });

  it("shows a neutral session check and keeps the fallback login screen", () => {
    const html = renderLanding();
    expect(html).toContain('href="/"');
    expect(html).toContain('href="#how-it-works"');
    expect(html).toContain('href="#features"');
    expect(html).toContain('href="/login"');
    expect(html).toContain("Проверяем вход…");
    expect(html).toContain("LXST Overlay");
    expect(html).toContain('href="https://github.com/lxstjxck"');
    expect(html).toContain('href="mailto:svjack69@gmail.com"');
  });

  it("accepts popup messages only from the opened same-origin window", () => {
    const popup = {} as Window;
    vi.stubGlobal("window", { location: { origin: "https://overlay.example" } });
    const message = { type: "lxst:twitch-oauth", success: true };
    const event = (origin: string, source: Window, data: unknown) => ({ origin, source, data }) as MessageEvent;
    expect(isTrustedPopupMessage(event("https://overlay.example", popup, message), popup)).toBe(true);
    expect(isTrustedPopupMessage(event("https://overlay.example", popup, message), null)).toBe(false);
    expect(isTrustedPopupMessage(event("https://other.example", popup, message), popup)).toBe(false);
    expect(isTrustedPopupMessage(event("https://overlay.example", {} as Window, message), popup)).toBe(false);
    expect(isTrustedPopupMessage(event("https://overlay.example", popup, { type: "other", success: true }), popup)).toBe(false);
    expect(isTrustedPopupMessage(event("https://overlay.example", popup, { type: "lxst:twitch-oauth", success: "true" }), popup)).toBe(false);
  });

  it("keeps GitHub and contact together in both landing footers", () => {
    vi.stubGlobal("React", React);
    vi.stubGlobal("window", { location: { pathname: "/", search: "" } });
    const ecosystem = renderToStaticMarkup(React.createElement(App));
    for (const html of [ecosystem, renderLanding()]) {
      const footer = html.match(/<footer[^>]*>[\s\S]*?<\/footer>/)?.[0];
      expect(footer).toContain('href="https://github.com/lxstjxck" target="_blank"');
      expect(footer).toContain('href="mailto:svjack69@gmail.com"');
      expect(footer).toContain("Связаться");
    }
    expect(ecosystem.match(/href="https:\/\/github.com\/lxstjxck"/g)).toHaveLength(1);
    expect(ecosystem.match(/<header[^>]*>[\s\S]*?<\/header>/)?.[0]).not.toContain("GitHub");
  });

  it("uses one LX mark and the 0.1.7 package version", () => {
    const mark = readFileSync(new URL("../src/client/components/BrandMark.tsx", import.meta.url), "utf8");
    const favicon = readFileSync(new URL("../public/favicon.svg", import.meta.url), "utf8");
    const identity = readFileSync(new URL("../src/client/components/BrandIdentity.tsx", import.meta.url), "utf8");
    const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    const lock = JSON.parse(readFileSync(new URL("../package-lock.json", import.meta.url), "utf8"));
    expect(packageJson.version).toBe("0.1.7");
    expect(lock.version).toBe("0.1.7");
    expect(lock.packages[""].version).toBe("0.1.7");
    expect(mark).toContain('d="M11 8v31h13M30 9l12 30M42 9 30 39"');
    expect(favicon).toContain('d="M11 8v31h13M30 9l12 30M42 9 30 39"');
    expect(identity).toContain("<BrandMark />");
    for (const path of [
      "../src/client/pages/EcosystemPage.tsx",
      "../src/client/pages/TwitchPages.tsx"
    ]) {
      expect(readFileSync(new URL(path, import.meta.url), "utf8")).toContain("<BrandIdentity");
    }
    for (const path of [
      "../src/client/pages/ModeratorApp.tsx",
      "../src/client/pages/ObsSetupPage.tsx"
    ]) {
      expect(readFileSync(new URL(path, import.meta.url), "utf8")).toContain("<BrandMark />");
    }
    expect(readFileSync(new URL("../src/client/appVersion.ts", import.meta.url), "utf8"))
      .toContain("__APP_VERSION__");
  });

  it("keeps UI spacing on the shared scale", () => {
    const tokens = readFileSync(new URL("../src/client/styles/tokens.css", import.meta.url), "utf8");
    for (const [index, amount] of [4, 8, 12, 16, 24, 40, 56, 88, 128].entries()) {
      expect(tokens).toContain(`--space-${index + 1}: ${amount}px;`);
    }
    expect(() => execFileSync(process.execPath, ["scripts/check-spacing.mjs"], {
      cwd: new URL("../", import.meta.url), stdio: "pipe"
    })).not.toThrow();
  });

  it("sets route-specific SPA metadata without changing other routes", () => {
    let description = "";
    const page = {
      title: "Initial title",
      querySelector: () => ({
        setAttribute: (_name: string, value: string) => {
          description = value;
        }
      })
    } as unknown as Document;
    setPublicPageMetadata("/", page);
    expect(page.title).toBe("LXST — инструменты для стримеров");
    expect(description).toBe("Экосистема инструментов LXST для стримеров и модераторов.");
    setPublicPageMetadata("/overlay", page);
    expect(page.title).toBe("LXST Overlay — оверлей для OBS");
    expect(description).toBe(
      "Управление медиа и интерактивным OBS-оверлеем с доступом для модераторов."
    );
    setPublicPageMetadata("/streamer", page);
    expect(page.title).toBe("LXST Overlay — оверлей для OBS");
  });

  it("explains the supported workflow and distinguishes preview from OBS", () => {
    const html = renderLanding();
    for (const item of [
      "Browser Source",
      "модераторов",
      "Twitch TTS",
      "Смайлы Twitch и 7TV",
      "Предпросмотр",
      "OBS"
    ]) {
      expect(html).toContain(item);
    }
    expect(html).toContain('aria-labelledby="how-title"');
    expect(html).toContain('id="how-title"');
  });

  it("keeps unified OAuth login, legacy login and accessible errors", () => {
    vi.stubGlobal("React", React);
    vi.stubGlobal("window", { location: { search: "?oauth_error=denied" } });
    const html = renderToStaticMarkup(React.createElement(TwitchLoginPage));
    expect(html).toContain('href="/api/auth/twitch/start/unified"');
    expect(html).toContain('href="/legacy-login"');
    expect(html).toContain('role="alert"');
    expect(html).toContain("Вход через Twitch отменён.");
  });
});
