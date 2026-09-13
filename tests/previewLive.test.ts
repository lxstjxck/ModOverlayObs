import { describe, expect, it } from "vitest";
import { clonePreviewElementToLive } from "../src/shared/previewLive";
import type { OverlayElement } from "../src/shared/types";

describe("preview to live clone", () => {
  it("creates a distinct live instance and keeps preview identity separate", () => {
    const preview: OverlayElement = {
      id: "preview_1",
      mediaId: "media_1",
      type: "VIDEO",
      name: "clip.mp4",
      src: "/uploads/clip.mp4",
      x: 1450,
      y: 100,
      width: 350,
      height: 350,
      rotation: 0,
      opacity: 1,
      zIndex: 3,
      visible: true,
      durationMs: 10_000,
      animationIn: "fade",
      animationOut: "fade",
      previewVolume: 0.3,
      liveVolume: 0.8,
      muted: false,
      loop: false,
      startTime: 0,
      props: {}
    };

    const live = clonePreviewElementToLive(preview, "live_1", new Date("2026-09-11T12:00:00.000Z"));

    expect(live.id).toBe("live_1");
    expect(live.previewElementId).toBe("preview_1");
    expect(live.x).toBe(preview.x);
    expect(live.width).toBe(preview.width);
    expect(live.liveVolume).toBe(0.8);
    expect(live.endsAt).toBe("2026-09-11T12:00:10.000Z");
  });
});
