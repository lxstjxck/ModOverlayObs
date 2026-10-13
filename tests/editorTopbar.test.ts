import * as React from "react";
import type { ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MediaLibrary } from "../src/client/components/MediaLibrary";
import { EditorTopbar } from "../src/client/pages/ModeratorApp";

vi.mock("../src/client/appVersion", () => ({ appVersion: "test" }));

afterEach(() => vi.unstubAllGlobals());

function renderHeader(overrides: Partial<ComponentProps<typeof EditorTopbar>> = {}) {
  vi.stubGlobal("React", React);
  return renderToStaticMarkup(
    React.createElement(EditorTopbar, {
      streamer: {
        id: "channel-1",
        displayName: "Default Streamer",
        twitchLogin: "channel_one",
        canvasWidth: 1920,
        canvasHeight: 1080,
        canvasRevision: "r1"
      },
      role: "MODERATOR",
      path: "/channel/channel-1",
      overlayConnected: false,
      connectionIssue: false,
      onLogout: () => {},
      ...overrides
    })
  );
}

describe("editor topbar", () => {
  it("shows the current channel login and the moderator channel list route", () => {
    const html = renderHeader();
    expect(html).toContain("twitch: channel_one");
    expect(html).toContain('href="/channels"');
    expect(html).toContain("Мои каналы");
    expect(html).toContain("OBS OFFLINE");
    expect(html).not.toContain("Default Streamer");
    expect(html).not.toContain("Добавить текст");
    expect(html).not.toContain("СЕРВЕР ОНЛАЙН");
  });

  it("updates the login and OBS status for another channel, with a neutral missing login", () => {
    const second = renderHeader({
      streamer: {
        id: "channel-2",
        displayName: "Another Streamer",
        twitchLogin: "channel_two",
        canvasWidth: 1920,
        canvasHeight: 1080,
        canvasRevision: "r2"
      },
      path: "/channel/channel-2",
      overlayConnected: true
    });
    expect(second).toContain("twitch: channel_two");
    expect(second).toContain("OBS ONLINE");
    expect(second).not.toContain("channel_one");
    expect(
      renderHeader({
        streamer: {
          id: "channel-3",
          displayName: "Third",
          twitchLogin: null,
          canvasWidth: 1920,
          canvasHeight: 1080,
          canvasRevision: "r3"
        }
      })
    ).toContain("twitch: не указан");
  });

  it("uses the owner dashboard or OBS setup route where appropriate", () => {
    expect(renderHeader({ role: "OWNER" })).toContain('href="/streamer"');
    expect(renderHeader({ role: "OWNER" })).toContain("Панель канала");
    expect(renderHeader({ path: "/app" })).toContain('href="/obs-setup"');
  });

  it("shows a warning only while the server connection has a problem", () => {
    expect(renderHeader()).not.toContain("Переподключение");
    const html = renderHeader({ connectionIssue: true });
    expect(html).toContain('role="alert"');
    expect(html).toContain("Нет соединения. Переподключение…");
  });
});

it("keeps the left Media Text tool available for preview placement", () => {
  vi.stubGlobal("React", React);
  const html = renderToStaticMarkup(
    React.createElement(MediaLibrary, {
      media: [],
      loading: false,
      uploadingCount: 0,
      error: "",
      canPlace: true,
      onUpload: () => {},
      onAdd: () => {},
      onAddUrl: async () => false,
      onDelete: () => {},
      onAddText: () => {},
      canDelete: false
    })
  );
  expect(html).toContain('class="text-tool"');
  expect(html).toContain("Text</button>");
  expect(html).not.toContain('class="text-tool" type="button" disabled');
});
