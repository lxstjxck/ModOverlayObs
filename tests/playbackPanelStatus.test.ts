import * as React from "react";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getPlaybackDisplayState,
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
  });

  it("keeps one status row and the timeline mounted across WAITING and OFFLINE", () => {
    vi.stubGlobal("React", React);
    vi.stubGlobal("HTMLIFrameElement", class {});
    const row = (label: string) => renderToStaticMarkup(React.createElement(PlaybackStatusRow, {
      label, sources: [status], selectedConnectionId: status.connectionId, onSourceChange: () => {}
    }));
    const normalize = (html: string) => html.replace(
      /(<span class="media-playback-status-label">).*?(<\/span>)/, "$1STATUS$2"
    );
    for (const state of ["PLAYING", "PAUSED", "STOPPED", "WAITING", "OFFLINE"]) {
      expect(normalize(row(`OBS obs-conn · ${state}`))).toBe(normalize(row("OBS obs-conn · PLAYING")));
    }
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
    const css = readFileSync(new URL("../src/client/broadcastConsole.css", import.meta.url), "utf8");
    expect(css).toMatch(/\.moderator-app \.media-playback-status\s*\{[^}]*height:\s*32px/s);
    expect(css).toMatch(/\.moderator-app \.media-playback-status-label\s*\{[^}]*white-space:\s*nowrap/s);
  });
});
