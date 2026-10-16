import { afterEach, describe, expect, it, vi } from "vitest";
import { observeYouTubeTime, playMediaNode, restartMediaNode, seekMediaNode } from "../src/client/mediaPlayback";
import { YouTubePlayerController } from "../src/client/youtubePlayer";
import { applyPlaybackCommand } from "../src/client/pages/OverlayPage";
import type { OverlayElement } from "../src/shared/types";

class Media {
  currentTime = 0;
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("media seeking", () => {
  it("keeps loop playing through reconnect and does not replay a persisted restart", () => {
    class LoopingMedia extends Media {
      loop = true;
      paused = false;
      play = vi.fn(async () => undefined);
      pause = vi.fn(() => { this.paused = true; });
    }
    vi.stubGlobal("HTMLMediaElement", LoopingMedia);
    const node = new LoopingMedia();
    const element = { id: "video", props: { playbackCommand: "restart", playbackCommandId: "restart-1" } } as OverlayElement;
    const applied = new Map<string, string>();
    applyPlaybackCommand(element, node as HTMLMediaElement, applied);
    node.currentTime = 37;
    applyPlaybackCommand(element, node as HTMLMediaElement, applied);
    expect(node.currentTime).toBe(37);
    expect(node.loop).toBe(true);
    expect(node.play).toHaveBeenCalledTimes(1);
    applyPlaybackCommand({ ...element, props: { playbackCommand: "pause", playbackCommandId: "pause-2" } }, node as HTMLMediaElement, applied);
    expect(node.pause).toHaveBeenCalledTimes(1);
    applyPlaybackCommand({ ...element, props: { playbackCommand: "seek", playbackCommandId: "seek-3", seekSeconds: 52 } }, node as HTMLMediaElement, applied);
    expect(node.currentTime).toBe(52);
  });
  it("handles rejected browser play promises without exposing media URLs", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    class RejectingMedia extends Media {
      play() { return Promise.reject(new Error("https://example.test/secret?overlayToken=private")); }
    }
    vi.stubGlobal("HTMLMediaElement", RejectingMedia);
    const node = new RejectingMedia() as HTMLMediaElement;
    playMediaNode(node);
    restartMediaNode(node);
    await Promise.resolve();
    expect(warning).toHaveBeenCalledTimes(2);
    expect(warning).toHaveBeenCalledWith("Media playback failed");
    warning.mockRestore();
  });

  it("seeks files and ignores invalid times", () => {
    vi.stubGlobal("HTMLMediaElement", Media);
    const node = new Media();
    seekMediaNode(node as HTMLMediaElement, 42);
    expect(node.currentTime).toBe(42);
    seekMediaNode(node as HTMLMediaElement, NaN);
    expect(node.currentTime).toBe(42);
    seekMediaNode(node as HTMLMediaElement, -5);
    expect(node.currentTime).toBe(0);
  });

  it("confirms YouTube commands from the Player API and ignores repeated snapshots", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("HTMLMediaElement", Media);
    class Frame extends EventTarget {}
    vi.stubGlobal("HTMLIFrameElement", Frame);
    let state = -1;
    let time = 0;
    let duration = 90;
    let handlers!: { onReady: () => void; onStateChange: (event: { data: number }) => void; onError: (event: { data: number }) => void; onAutoplayBlocked: () => void };
    const play = vi.fn();
    const pause = vi.fn();
    const seek = vi.fn((seconds: number) => { time = seconds; });
    const setLoop = vi.fn();
    const destroy = vi.fn();
    class Player {
      constructor(_frame: Frame, options: { events: typeof handlers }) { handlers = options.events; }
      playVideo = play;
      pauseVideo = pause;
      stopVideo = vi.fn();
      seekTo = seek;
      mute = vi.fn();
      unMute = vi.fn();
      setVolume = vi.fn();
      setLoop = setLoop;
      getCurrentTime = () => time;
      getDuration = () => duration;
      getPlayerState = () => state;
      destroy = destroy;
    }
    vi.stubGlobal("window", { YT: { Player }, setInterval, clearInterval });
    const frame = new Frame() as HTMLIFrameElement;
    const onChange = vi.fn();
    const controller = new YouTubePlayerController(frame, onChange);
    await Promise.resolve();
    controller.configure(0.5, false, true);
    handlers.onReady();
    expect(setLoop).toHaveBeenCalledWith(true);
    controller.configure(0.5, false, false);
    expect(setLoop).toHaveBeenLastCalledWith(false);
    const onTime = vi.fn();
    const stop = observeYouTubeTime(frame, onTime);
    const element = { id: "video", props: { playbackCommand: "restart", playbackCommandId: "restart-1" } } as OverlayElement;
    const applied = new Map<string, string>();
    applyPlaybackCommand(element, frame, applied);
    expect(play).toHaveBeenCalledTimes(1);
    expect(controller.status().commandId).toBeNull();
    state = 1;
    handlers.onStateChange({ data: state });
    expect(controller.status()).toMatchObject({ state: "PLAYING", commandId: "restart-1" });
    time = 42;
    applyPlaybackCommand(element, frame, applied);
    expect(play).toHaveBeenCalledTimes(1);
    expect(time).toBe(42);
    expect(onTime).toHaveBeenCalledWith({ current: 0, duration: 0 });
    vi.advanceTimersByTime(1000);
    expect(onTime).toHaveBeenCalledWith({ current: 42, duration: 90 });
    duration = 91;
    vi.advanceTimersByTime(1000);
    expect(controller.status().duration).toBe(0);
    state = 2;
    applyPlaybackCommand({ ...element, props: { playbackCommand: "pause", playbackCommandId: "pause-2" } }, frame, applied);
    handlers.onStateChange({ data: state });
    expect(pause).toHaveBeenCalled();
    expect(controller.status().commandId).toBe("pause-2");
    applyPlaybackCommand({ ...element, props: { playbackCommand: "seek", playbackCommandId: "seek-3", seekSeconds: 75 } }, frame, applied);
    expect(controller.status()).toMatchObject({ position: 75, commandId: "seek-3" });
    applyPlaybackCommand({ ...element, props: { playbackCommand: "stop", playbackCommandId: "stop-4" } }, frame, applied);
    expect(controller.status()).toMatchObject({ position: 0, commandId: "stop-4" });
    handlers.onError({ data: 153 });
    expect(controller.status()).toMatchObject({ state: "ERROR", errorCode: 153 });
    handlers.onAutoplayBlocked();
    expect(controller.status()).toMatchObject({ state: "ERROR", issue: "AUTOPLAY_BLOCKED" });
    stop();
    controller.dispose();
    expect(destroy).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("reports an unavailable YouTube API after a bounded wait and cleans up its script", async () => {
    vi.useFakeTimers();
    vi.resetModules();
    const script = { src: "", async: false, dataset: {} as Record<string, string>, remove: vi.fn(), onerror: null };
    const append = vi.fn();
    vi.stubGlobal("window", { setTimeout, clearTimeout });
    vi.stubGlobal("document", {
      querySelector: vi.fn().mockReturnValueOnce(null).mockReturnValue(script),
      createElement: () => script,
      head: { append }
    });
    const { YouTubePlayerController: FreshController } = await import("../src/client/youtubePlayer");
    const onChange = vi.fn();
    const controller = new FreshController({} as HTMLIFrameElement, onChange);
    expect(append).toHaveBeenCalledWith(script);
    vi.advanceTimersByTime(12_000);
    await Promise.resolve();
    await Promise.resolve();
    expect(controller.status()).toMatchObject({ state: "ERROR", issue: "API_UNAVAILABLE" });
    expect(script.remove).toHaveBeenCalledTimes(1);
    controller.dispose();
  });
});
