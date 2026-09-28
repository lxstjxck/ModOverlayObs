import { describe, expect, it } from "vitest";
import type { OverlayElement } from "../src/shared/types";
import {
  calculateFitScale,
  calculateOverlayGeometry,
  resizeElement,
  snapMoveToCanvasEdges,
  snapResizeToCanvasEdges
} from "../src/client/components/CanvasStage";

const element: OverlayElement = {
  id: "element",
  mediaId: "media",
  type: "IMAGE",
  name: "image",
  src: "/uploads/image.png",
  text: null,
  x: 100,
  y: 80,
  width: 200,
  height: 100,
  rotation: 0,
  opacity: 1,
  zIndex: 1,
  visible: true,
  durationMs: null,
  animationIn: "none",
  animationOut: "none",
  previewVolume: 1,
  liveVolume: 1,
  muted: false,
  loop: false,
  startTime: 0,
  props: {}
};

const pointer = { altKey: false, ctrlKey: false, metaKey: false, shiftKey: false };

describe("canvas geometry", () => {
  it("fits the OBS frame and staging area within the viewport", () => {
    expect(calculateFitScale(1300, 790, 1920, 1080)).toBeCloseTo(742 / 1640);
    expect(calculateFitScale(3000, 2000, 1920, 1080)).toBe(1);
  });

  it("keeps OBS text and coordinates in a uniform 1920x1080 frame", () => {
    expect(calculateOverlayGeometry(1920, 1080, 1920, 1080)).toEqual({
      scale: 1,
      left: 0,
      top: 0
    });
    expect(calculateOverlayGeometry(1280, 800, 1920, 1080)).toEqual({
      scale: 2 / 3,
      left: 0,
      top: 40
    });
  });

  it("stretches width and height independently by default", () => {
    expect(resizeElement(element, "se", 80.5, 20.25, pointer)).toMatchObject({
      x: 100,
      y: 80,
      width: 280.5,
      height: 120.25
    });
  });

  it("keeps aspect ratio when Shift is held on a corner", () => {
    expect(resizeElement(element, "se", 80, 20, { ...pointer, shiftKey: true })).toMatchObject({
      x: 100,
      y: 80,
      width: 280,
      height: 140
    });
  });

  it("resizes only one axis using a side handle", () => {
    expect(resizeElement(element, "e", 50, 0, pointer)).toMatchObject({
      x: 100,
      y: 80,
      width: 250,
      height: 100
    });
  });

  it("snaps media to all four OBS edges, including entry from staging", () => {
    expect(
      snapMoveToCanvasEdges({ x: 7, y: 6, width: 200, height: 100 }, 1920, 1080, 10, 10)
    ).toEqual({
      x: 0,
      y: 0
    });
    expect(
      snapMoveToCanvasEdges({ x: 1712, y: 974, width: 200, height: 100 }, 1920, 1080, 10, 10)
    ).toEqual({
      x: 1720,
      y: 980
    });
    expect(
      snapMoveToCanvasEdges({ x: -205, y: 80, width: 200, height: 100 }, 1920, 1080, 10, 10)
    ).toEqual({
      x: -200,
      y: 80
    });
    expect(
      snapMoveToCanvasEdges({ x: 25, y: 80, width: 200, height: 100 }, 1920, 1080, 10, 10)
    ).toEqual({
      x: 25,
      y: 80
    });
  });

  it("snaps only the active resize edges while keeping the opposite sides fixed", () => {
    expect(
      snapResizeToCanvasEdges({ x: 7, y: 6, width: 200, height: 100 }, "nw", 1920, 1080, 10, 10)
    ).toEqual({
      x: 0,
      y: 0,
      width: 207,
      height: 106
    });
    expect(
      snapResizeToCanvasEdges(
        { x: 100, y: 100, width: 1814, height: 975 },
        "se",
        1920,
        1080,
        10,
        10
      )
    ).toEqual({
      x: 100,
      y: 100,
      width: 1820,
      height: 980
    });
  });
});
