import { afterEach, describe, expect, it, vi } from "vitest";
import { previewSyncActions, previewTargetPosition } from "../src/client/previewPlaybackSync";
import { YouTubePlayerController } from "../src/client/youtubePlayer";
import type { MediaStatus } from "../src/shared/mediaStatus";

const status = (changes: Partial<MediaStatus> = {}): MediaStatus => ({
  elementId: "video", connectionId: "obs-a", position: 42, duration: 90,
  playing: true, state: "PLAYING", player: "youtube", commandId: "play-1",
  observedAt: 10_000, ...changes
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("OBS to YouTube preview synchronization", () => {
  it("restores once, ignores delivery drift, and corrects significant drift", () => {
    const obs = status();
    expect(previewTargetPosition(obs, 10_500)).toBe(42.5);
    expect(previewSyncActions(obs, { position: 0, state: "UNSTARTED" }, false, 10_500))
      .toEqual(["seek", "play"]);
    expect(previewSyncActions(obs, { position: 42, state: "PLAYING" }, true, 10_500))
      .toEqual([]);
    expect(previewSyncActions(obs, { position: 38, state: "PLAYING" }, true, 10_500))
      .toEqual(["seek"]);
    expect(previewSyncActions(obs, { position: 0, state: "PAUSED" }, true, 10_500))
      .toEqual(["play"]);
    expect(previewSyncActions(obs, { position: 0, state: "PAUSED" }, false, 15_000))
      .toEqual([]);
  });

  it("restores a paused frame but never seeks an unknown live range", () => {
    expect(previewSyncActions(status({ state: "PAUSED", playing: false }),
      { position: 0, state: "UNSTARTED" }, false, 10_000)).toEqual(["seek", "pause"]);
    expect(previewSyncActions(status({ duration: 0 }),
      { position: 0, state: "UNSTARTED" }, false, 10_000)).toEqual(["play"]);
    expect(previewSyncActions(status({ player: "html5" }),
      { position: 0, state: "UNSTARTED" }, false, 10_000)).toEqual([]);
  });

  it("mutes automatic playback, respects source changes, and leaves command IDs untouched", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    class Frame extends EventTarget {}
    vi.stubGlobal("HTMLIFrameElement", Frame);
    let state = -1;
    let position = 0;
    let handlers!: { onReady: () => void; onAutoplayBlocked: () => void };
    const play = vi.fn();
    const pause = vi.fn(() => { state = 2; });
    const seek = vi.fn((time: number) => { position = time; });
    const mute = vi.fn();
    const unMute = vi.fn();
    const destroy = vi.fn();
    class Player {
      constructor(_frame: Frame, options: { events: typeof handlers }) { handlers = options.events; }
      playVideo = play;
      pauseVideo = pause;
      seekTo = seek;
      mute = mute;
      unMute = unMute;
      setVolume = vi.fn();
      setLoop = vi.fn();
      getCurrentTime = () => position;
      getDuration = () => 90;
      getPlayerState = () => state;
      destroy = destroy;
    }
    vi.stubGlobal("window", { YT: { Player }, setInterval, clearInterval });
    const frame = new Frame() as HTMLIFrameElement;
    const controller = new YouTubePlayerController(frame, () => undefined);
    await Promise.resolve();
    controller.syncPreview(status());
    expect(seek).not.toHaveBeenCalled();
    handlers.onReady();
    controller.syncPreview(status());
    expect(seek).toHaveBeenCalledWith(42, true);
    expect(play).toHaveBeenCalledTimes(1);
    expect(mute).toHaveBeenCalledTimes(1);
    expect(controller.status().commandId).toBeNull();
    controller.syncPreview(status({ observedAt: 10_001 }));
    expect(seek).toHaveBeenCalledTimes(1);
    vi.setSystemTime(13_000);
    controller.syncPreview(status({ observedAt: 13_000, position: 43 }));
    expect(seek).toHaveBeenCalledTimes(1);
    expect(play).toHaveBeenCalledTimes(1);
    controller.syncPreview(status({ connectionId: "obs-b", observedAt: 13_000, position: 60 }));
    expect(seek).toHaveBeenCalledWith(60, true);
    expect(play).toHaveBeenCalledTimes(2);
    vi.setSystemTime(16_000);
    controller.syncPreview(status({ connectionId: "obs-b", observedAt: 16_000,
      position: 60, state: "PAUSED", playing: false }));
    expect(pause).toHaveBeenCalledTimes(1);
    handlers.onAutoplayBlocked();
    controller.syncPreview(status({ connectionId: "obs-b", observedAt: 16_000 }));
    expect(play).toHaveBeenCalledTimes(2);
    controller.run("play");
    expect(unMute).toHaveBeenCalledTimes(1);
    vi.setSystemTime(19_000);
    controller.syncPreview(status({ connectionId: "obs-b", observedAt: 19_000 }));
    expect(mute).toHaveBeenCalledTimes(1);
    controller.dispose();
    expect(destroy).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});
