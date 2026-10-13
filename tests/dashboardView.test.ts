import * as React from "react";
import type { ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TwitchDashboardView } from "../src/client/components/TwitchDashboardView";

afterEach(() => vi.unstubAllGlobals());

const profile = { id: "user-1", login: "creator", displayName: "Creator", avatarUrl: null };
const channel = {
  id: "channel-1",
  twitchId: "twitch-1",
  displayName: "Creator",
  avatarUrl: null,
  status: "connected" as const,
  role: "owner" as const
};

function render(overrides: Partial<ComponentProps<typeof TwitchDashboardView>> = {}) {
  vi.stubGlobal("React", React);
  vi.stubGlobal("window", { location: { search: "" } });
  const props: ComponentProps<typeof TwitchDashboardView> = {
    mode: "streamer",
    me: profile,
    channels: [channel],
    selectedId: channel.twitchId,
    onSelectChannel: () => {},
    moderators: [],
    obs: {
      overlayUrl: "https://example.invalid/overlay/private-value",
      canvasWidth: 1920,
      canvasHeight: 1080
    },
    canvas: {
      id: "channel-1",
      displayName: "Creator",
      canvasWidth: 1920,
      canvasHeight: 1080,
      canvasRevision: "r1"
    },
    presence: { overlayConnected: true, overlayCount: 1, moderators: [] },
    tts: null,
    width: "1920",
    height: "1080",
    sourceWidth: "1920",
    sourceHeight: "1080",
    ttsCost: 1000,
    ratio: [16, 9],
    changed: false,
    dimensionsValid: true,
    loading: false,
    connecting: false,
    savingCanvas: false,
    ttsBusy: false,
    changingModerator: null,
    error: "",
    onRefresh: () => {},
    onLogout: () => {},
    onConnectChannel: () => {},
    onToggleModerator: () => {},
    onToggleTts: () => {},
    onSaveTtsReward: () => {},
    onSaveCanvas: () => {},
    setWidth: () => {},
    setHeight: () => {},
    setSourceWidth: () => {},
    setSourceHeight: () => {},
    setTtsCost: () => {},
    ...overrides
  };
  return renderToStaticMarkup(React.createElement(TwitchDashboardView, props));
}

describe("Twitch dashboard presentation", () => {
  it("hides the OBS URL by default while keeping copy controls and real editor route", () => {
    const html = render();
    expect(html).toContain("<h1>Панель управления</h1>");
    expect(html).toContain('href="#overview"');
    expect(html).toContain('id="overview"');
    expect(html).toContain('type="password"');
    expect(html).toContain('aria-label="Копировать URL"');
    expect(html).toContain('href="/channel/channel-1"');
    expect(html).toContain('id="obs"');
    expect(html).toContain('id="canvas"');
    expect(html).not.toContain("Подключить канал");
    expect(html).toContain("Статус браузерного клиента");
  });

  it("offers connection for a selected owner whose Twitch channel is not connected", () => {
    const html = render({ channels: [{ ...channel, id: null, status: "unconnected" }] });
    expect(html).toContain("Подключить канал");
    expect(html).not.toContain("Проверьте доступ к каналу Twitch.");
    expect(html).not.toContain('href="/channel/channel-1"');
    expect(html).not.toContain('id="obs"');
    expect(html).not.toContain('id="canvas"');
    expect(render({ channels: [{ ...channel, id: null, status: "unconnected" }], connecting: true }))
      .toContain("Подключаем…");
  });

  it("does not offer channel creation or owner controls to an unconnected moderator", () => {
    const html = render({ mode: "moderator", channels: [{ ...channel, id: null, role: "moderator", status: "unconnected" }] });
    expect(html).not.toContain("Подключить канал");
    expect(html).not.toContain('id="obs"');
    expect(html).not.toContain('id="canvas"');
    expect(html).not.toContain('href="/channel/channel-1"');
  });

  it.each([
    ["denied", "Доступ к каналу Twitch запрещён."],
    ["error", "Не удалось проверить доступ к каналу Twitch."]
  ] as const)("shows the %s owner access error without a connection button", (status, message) => {
    const html = render({ channels: [{ ...channel, id: null, status }] });
    expect(html).toContain(message);
    expect(html).not.toContain("Подключить канал");
    expect(html).not.toContain('id="obs"');
  });

  it("does not offer the editor when moderator access is denied", () => {
    const html = render({ mode: "moderator", channels: [{ ...channel, status: "denied" }] });
    expect(html).toContain("<h1>Ваши каналы.</h1>");
    expect(html).toContain("Доступ к редактору отозван");
    expect(html).not.toContain('href="/channel/channel-1"');
  });

  it("shows loading, empty and error states without fabricated channels", () => {
    const html = render({ mode: "moderator", channels: [], error: "Ошибка доступа" });
    expect(html).toContain("Доступных каналов пока нет");
    expect(html).toContain('role="alert"');
    expect(html).toContain("Ошибка доступа");
  });

  it("shows Coming Soon instead of TTS settings when the server disables it", () => {
    const html = render({ tts: {
      available: false, configured: true, connected: true, enabled: true,
      error: null, queueLength: 0, broadcasterLogin: "creator",
      rewardId: "existing-reward", rewardCost: 1000, ready: false
    } });
    expect(html).toContain("Twitch TTS");
    expect(html).toContain("Скоро появится");
    expect(html).toContain("Озвучивание сообщений зрителей за баллы канала Twitch. Функция находится в разработке и станет доступна позже.");
    expect(html).not.toContain("Подключить Twitch TTS");
    expect(html).not.toContain("Создать награду TTS");
    expect(html).not.toContain("Сохранить стоимость");
    expect(html).not.toContain("Включить TTS");
    expect(html).not.toContain("Стоимость награды");
  });
});
