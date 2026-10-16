import * as React from "react";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getPlaybackDisplayState,
  getPlaybackProblem,
  getPlaybackStatusLabel,
  PlaybackStatusRow,
  PropertiesPanel
} from "../src/client/components/PropertiesPanel";
import type { MediaStatus } from "../src/shared/mediaStatus";
import type { OverlayElement } from "../src/shared/types";

const status: MediaStatus = {
  elementId: "video",
  connectionId: "obs-connection",
  position: 42,
  duration: 90,
  playing: true,
  commandId: "play-1",
  observedAt: Date.now()
};

const video: OverlayElement = {
  id: "video", type: "VIDEO", name: "Video", src: "https://example.com/video.mp4",
  x: 0, y: 0, width: 320, height: 180, rotation: 0, opacity: 1, zIndex: 1,
  visible: true, animationIn: "none", animationOut: "none", liveVolume: 1,
  muted: false, loop: true, startTime: 0, props: { playbackCommand: "play", playbackCommandId: "play-1" }
};

afterEach(() => vi.unstubAllGlobals());

describe("video control status", () => {
  it("shows the actual OBS state during the grace period, then WAITING, then the acknowledged state", () => {
    const pending = { playbackCommand: "pause", playbackCommandId: "pause-2" };
    expect(getPlaybackDisplayState(status, pending, false)).toBe("PLAYING");
    expect(getPlaybackDisplayState(status, pending, true)).toBe("WAITING");
    expect(getPlaybackDisplayState({ ...status, playing: false, commandId: "pause-2" }, pending, false)).toBe("PAUSED");
    expect(getPlaybackDisplayState({ ...status, position: 0, playing: false, commandId: "stop-3" },
      { playbackCommand: "stop", playbackCommandId: "stop-3" }, false)).toBe("STOPPED");
    expect(getPlaybackDisplayState(undefined, pending, false)).toBe("OFFLINE");
    expect(getPlaybackDisplayState({ ...status, state: "BUFFERING" }, pending, false)).toBe("BUFFERING");
    expect(getPlaybackDisplayState({ ...status, state: "ERROR", errorCode: 153 }, pending, true)).toBe("ERROR");
    expect(getPlaybackDisplayState({ ...status, state: "UNKNOWN" }, pending, false)).toBe("UNKNOWN");
  });

  it("uses short Russian labels and user facing playback errors", () => {
    expect(getPlaybackStatusLabel("PLAYING")).toBe("Воспроизводится");
    expect(getPlaybackStatusLabel("WAITING")).toBe("Ожидание ответа");
    expect(getPlaybackStatusLabel("OFFLINE")).toBe("OBS не подключён");
    expect(getPlaybackStatusLabel("ERROR")).toBe("Ошибка воспроизведения");
    expect(getPlaybackProblem({ ...status, state: "ERROR", errorCode: 153 })).toBe("Видео недоступно");
    expect(getPlaybackProblem({ ...status, issue: "AUTOPLAY_BLOCKED" })).toBe("Воспроизведение заблокировано");
    expect(getPlaybackProblem({ ...status, issue: "COMMAND_TIMEOUT" })).toBe("OBS не отвечает");
  });

  it("shows source selection only when needed and keeps technical data in details", () => {
    vi.stubGlobal("React", React);
    vi.stubGlobal("HTMLIFrameElement", class {});
    const row = (state: "PLAYING" | "PAUSED" | "WAITING" | "OFFLINE", sources = [status],
      selectedConnectionId = status.connectionId) => renderToStaticMarkup(React.createElement(PlaybackStatusRow, {
      state, sources, selectedConnectionId, onSourceChange: () => {}
    }));
    expect(row("PLAYING")).not.toContain("media-sources-button");
    expect(row("PLAYING", [status, { ...status, connectionId: "second" }]))
      .toContain("Источники (2)");
    expect(row("OFFLINE", [status], "obs-disconnected")).toContain("Источники (1)");
    expect(row("OFFLINE", [], "obs-disconnected")).not.toContain("media-sources-button");
    expect(row("PLAYING").split("<details")[0]).not.toContain(status.connectionId);
    expect(row("PLAYING")).toContain(`OBS: ${status.connectionId}`);
    for (const state of ["PLAYING", "PAUSED", "WAITING", "OFFLINE"] as const) {
      expect(row(state)).toContain('class="media-playback-status"');
    }
  });

  it("keeps the transport and timeline mounted across status changes", () => {
    vi.stubGlobal("React", React);
    vi.stubGlobal("HTMLIFrameElement", class {});
    const renderPanel = (mediaStatuses: MediaStatus[]) => renderToStaticMarkup(
      React.createElement(PropertiesPanel, {
        selected: video, mediaStatuses, onUpdate: () => {}, onDuplicate: () => {}, onRemove: () => {}
      })
    );
    for (const html of [renderPanel([status]), renderPanel([])]) {
      expect(html).toContain('class="media-playback-status"');
      expect(html).toContain('class="mini-toolbar media-transport"');
      expect(html).toContain('class="media-timeline"');
      expect(html).toContain('class="media-position-row"');
      expect(html.indexOf('class="mini-toolbar media-transport"')).toBeLessThan(html.indexOf('class="media-timeline"'));
      expect(html.indexOf('class="media-timeline"')).toBeLessThan(html.indexOf('class="media-position-row"'));
    }
    expect(renderPanel([{ ...status, player: "youtube", duration: 0 }])).toContain("--:--");
    expect(renderPanel([{ ...status, player: "youtube", duration: 0 }]))
      .toMatch(/aria-label="Перемотка по таймкоду"[^>]*disabled=""/);
    const offline = renderToStaticMarkup(React.createElement(PropertiesPanel, {
      selected: video, mediaStatuses: [], selectedConnectionId: "obs-disconnected",
      onUpdate: () => {}, onDuplicate: () => {}, onRemove: () => {}
    }));
    expect(offline).toContain("OBS не подключён");
    expect(offline).toContain("obs-disconnected");
    expect(offline).toContain("Выбранный источник недоступен");
    expect(offline).not.toContain("media-sources-button");
    expect(offline).toMatch(/aria-label="Перемотка по таймкоду"[^>]*disabled=""/);
    const readOnly = renderToStaticMarkup(React.createElement(PropertiesPanel, {
      selected: video, mediaStatuses: [status], canControlPlayback: false,
      onUpdate: () => {}, onDuplicate: () => {}, onRemove: () => {}
    }));
    expect(readOnly).toMatch(/aria-label="Перемотка по таймкоду"[^>]*disabled=""/);
    const playbackError = renderPanel([{ ...status, state: "ERROR", errorCode: 153 }]);
    expect(playbackError).toContain("Ошибка воспроизведения");
    expect(playbackError).toContain("Видео недоступно");
    expect(playbackError).toContain("Код ошибки YouTube: 153");
    const css = readFileSync(new URL("../src/client/broadcastConsole.css", import.meta.url), "utf8");
    expect(css).toMatch(/\.moderator-app \.media-playback-status\s*\{[^}]*height:\s*36px/s);
    expect(css).toMatch(/\.moderator-app \.media-playback-status-label\s*\{[^}]*line-height:\s*1\.3/s);
  });
});
