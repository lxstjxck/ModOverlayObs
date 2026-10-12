import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TwitchLandingPage } from "../src/client/pages/TwitchPages";

afterEach(() => vi.unstubAllGlobals());

function renderLanding(search = "") {
  vi.stubGlobal("React", React);
  vi.stubGlobal("window", { location: { search } });
  return renderToStaticMarkup(React.createElement(TwitchLandingPage));
}

describe("public landing page", () => {
  it("keeps both Twitch OAuth role routes and the legacy login route", () => {
    const html = renderLanding();
    expect(html).toContain('href="/api/auth/twitch/start/streamer"');
    expect(html).toContain('href="/api/auth/twitch/start/moderator"');
    expect(html).toContain('href="/legacy-login"');
    expect(html).toContain("Войти через Twitch");
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

  it("shows OAuth errors as an accessible alert", () => {
    const html = renderLanding("?oauth_error=denied");
    expect(html).toContain('role="alert"');
    expect(html).toContain("Вход через Twitch отменён.");
  });
});
