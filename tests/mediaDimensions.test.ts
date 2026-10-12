import { describe, expect, it } from "vitest";
import { fitInitialMediaDimensions } from "../src/client/mediaDimensions";

describe("initial media size", () => {
  it("keeps small media at its native aspect and size", () => {
    expect(fitInitialMediaDimensions({ width: 320, height: 180 }, 1920, 1080)).toEqual({
      width: 320,
      height: 180
    });
  });

  it("fits oversized landscape and portrait media inside the staging size", () => {
    expect(fitInitialMediaDimensions({ width: 4000, height: 2000 }, 1920, 1080)).toEqual({
      width: 512,
      height: 256
    });
    expect(fitInitialMediaDimensions({ width: 2000, height: 4000 }, 1920, 1080)).toEqual({
      width: 259,
      height: 518
    });
  });

  it("uses the current channel canvas dimensions", () => {
    expect(fitInitialMediaDimensions({ width: 3840, height: 2160 }, 1280, 720)).toEqual({
      width: 320,
      height: 180
    });
  });

  it("fits inside the visible SPAWN area with the server placement offset", () => {
    for (const canvasWidth of [640, 1280, 1920]) {
      const fitted = fitInitialMediaDimensions({ width: 6000, height: 1000 }, canvasWidth, 1080);
      const serverX = -fitted.width - 56;
      expect(serverX).toBeGreaterThan(-canvasWidth * 0.3);
      expect(serverX + fitted.width).toBe(-56);
    }
  });
});
