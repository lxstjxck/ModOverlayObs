import { afterEach, describe, expect, it, vi } from "vitest";
import { observeYouTubeTime, seekMediaNode } from "../src/client/mediaPlayback";

class Media {
  currentTime = 0;
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("media seeking", () => {
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

  it("sends YouTube seek commands only to the player origin", () => {
    vi.useFakeTimers();
    vi.stubGlobal("HTMLMediaElement", Media);
    vi.stubGlobal("window", { setTimeout });
    const postMessage = vi.fn();
    const frame = {
      src: "https://www.youtube.com/embed/abcdefghijk",
      contentWindow: { postMessage }
    };
    seekMediaNode(frame as unknown as HTMLIFrameElement, 75);
    vi.runAllTimers();
    expect(postMessage).toHaveBeenCalledWith(
      JSON.stringify({ event: "command", func: "seekTo", args: [75, true] }),
      "https://www.youtube.com"
    );
  });

  it("accepts time updates only from the selected YouTube frame and removes listeners", () => {
    vi.useFakeTimers();
    const events = new EventTarget();
    vi.stubGlobal("window", {
      addEventListener: events.addEventListener.bind(events),
      removeEventListener: events.removeEventListener.bind(events),
      setInterval,
      clearInterval
    });
    const frameEvents = new EventTarget();
    const frame = {
      contentWindow: { postMessage: vi.fn() },
      addEventListener: frameEvents.addEventListener.bind(frameEvents),
      removeEventListener: frameEvents.removeEventListener.bind(frameEvents)
    };
    const onTime = vi.fn();
    const stop = observeYouTubeTime(frame as unknown as HTMLIFrameElement, onTime);
    function dispatch(origin: string, source: unknown) {
      const event = new Event("message");
      Object.assign(event, {
        origin,
        source,
        data: JSON.stringify({ event: "infoDelivery", info: { currentTime: 12, duration: 90 } })
      });
      events.dispatchEvent(event);
    }
    dispatch("https://evil.example", frame.contentWindow);
    dispatch("https://www.youtube.com", {});
    expect(onTime).not.toHaveBeenCalled();
    dispatch("https://www.youtube.com", frame.contentWindow);
    expect(onTime).toHaveBeenCalledWith({ current: 12, duration: 90 });
    stop();
    onTime.mockClear();
    dispatch("https://www.youtube.com", frame.contentWindow);
    expect(onTime).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
