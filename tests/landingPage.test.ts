import * as React from "react";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TwitchLandingPage } from "../src/client/pages/TwitchPages";
import { TwitchLoginPage } from "../src/client/pages/TwitchLoginPage";
import { App } from "../src/client/App";
import { setPublicPageMetadata } from "../src/client/publicPageMetadata";

vi.mock("../src/client/appVersion", () => ({ appVersion: "test" }));

afterEach(() => vi.unstubAllGlobals());

function renderLanding(search = "") {
  vi.stubGlobal("React", React);
  vi.stubGlobal("window", { location: { search } });
  return renderToStaticMarkup(React.createElement(TwitchLandingPage));
}

describe("public landing page", () => {
  it("shows both services at / and links Overlay to its landing page", () => {
    vi.stubGlobal("React", React);
    vi.stubGlobal("window", { location: { pathname: "/", search: "" } });
    const html = renderToStaticMarkup(React.createElement(App));
    expect(html).toContain("LXST ECOSYSTEM");
    expect(html).toContain("LXST Overlay");
    expect(html).toContain("LXST Chat");
    expect(html).toContain('href="/overlay"');
    expect(html).toContain('href="#services"');
    expect(html).toContain('href="/" aria-label="LXST — главная"');
    expect(html).toContain("Скоро появится");
    expect(html).not.toContain('href="/chat"');
    expect(html).not.toContain('href="/app"');
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

  it("routes public calls to action through the Twitch login screen", () => {
    const html = renderLanding();
    expect(html).toContain('href="/"');
    expect(html).toContain('href="#how-it-works"');
    expect(html).toContain('href="#features"');
    expect(html).toContain('href="/login"');
    expect(html).toContain("Войти через Twitch");
    expect(html).toContain("LXST Overlay");
    expect(html).toContain('href="https://github.com/lxstjxck"');
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
