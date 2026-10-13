import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TwitchLandingPage } from "../src/client/pages/TwitchPages";
import { TwitchLoginPage } from "../src/client/pages/TwitchLoginPage";

afterEach(() => vi.unstubAllGlobals());

function renderLanding(search = "") {
  vi.stubGlobal("React", React);
  vi.stubGlobal("window", { location: { search } });
  return renderToStaticMarkup(React.createElement(TwitchLandingPage));
}

describe("public landing page", () => {
  it("routes public calls to action through the Twitch login screen", () => {
    const html = renderLanding();
    expect(html).toContain('href="#how-it-works"');
    expect(html).toContain('href="#features"');
    expect(html).toContain('href="/login"');
    expect(html).toContain("Войти через Twitch");
    expect(html).toContain("LXST Overlay");
    expect(html).toContain('href="https://github.com/lxstjxck"');
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

  it("keeps both OAuth role routes, legacy login and accessible errors", () => {
    vi.stubGlobal("React", React);
    vi.stubGlobal("window", { location: { search: "?oauth_error=denied" } });
    const html = renderToStaticMarkup(React.createElement(TwitchLoginPage));
    expect(html).toContain('href="/api/auth/twitch/start/streamer"');
    expect(html).toContain('href="/api/auth/twitch/start/moderator"');
    expect(html).toContain('href="/legacy-login"');
    expect(html).toContain('role="alert"');
    expect(html).toContain("Вход через Twitch отменён.");
  });
});
