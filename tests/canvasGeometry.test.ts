import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import type { OverlayElement } from "../src/shared/types";
import {
  calculateFitScale,
  calculateOverlayGeometry,
  resizeElement,
  snappingEnabled,
  shouldStartPan,
  snapMoveToCanvasEdges,
  snapResizeToCanvasEdges,
  zoomAroundPointer
} from "../src/client/components/CanvasStage";
import { cropClipPath, getCrop, scaleCrop } from "../src/client/cropGeometry";

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
  it("disables text selection only in the interactive workspace viewport", () => {
    const css = readFileSync(new URL("../src/client/styles.css", import.meta.url), "utf8");
    const rule = css.match(/\.stage-workspace \.stage-scroll\s*\{([^}]+)\}/)?.[1];
    expect(rule).toMatch(/(?:^|\n)\s*user-select:\s*none;/);
    expect(rule).toMatch(/(?:^|\n)\s*-webkit-user-select:\s*none;/);
    expect(css).not.toMatch(/(?:^|\n)\s*(?:html|body|\.stage-overlay|\.moderator-app)\s*\{[^}]*user-select:\s*none;/);
  });

  it.each([-120, 120])("zooms with wheel delta %i without a Ctrl modifier", (deltaY) => {
    const current = 1;
    const result = zoomAroundPointer(current, deltaY, 300, 240, { x: 500, y: 400 }, 0.5, {
      x: -700,
      y: -500
    });
    expect(Math.sign(result.zoom - current)).toBe(-Math.sign(deltaY));
    const ratio = result.zoom / current;
    const scaleDelta = (result.zoom - current) * 0.5;
    const movedCenter = {
      x: 500 + result.panDelta.x - 700 * scaleDelta,
      y: 400 + result.panDelta.y - 500 * scaleDelta
    };
    expect(movedCenter.x + ratio * (300 - 500)).toBeCloseTo(300);
    expect(movedCenter.y + ratio * (240 - 400)).toBeCloseTo(240);
  });

  it("keeps wheel zoom within the existing 25% to 600% multiplier limits", () => {
    expect(zoomAroundPointer(1, -100000, 0, 0, { x: 0, y: 0 }, 1, { x: 0, y: 0 }).zoom).toBe(6);
    expect(zoomAroundPointer(1, 100000, 0, 0, { x: 0, y: 0 }, 1, { x: 0, y: 0 }).zoom).toBe(0.25);
  });
  it("keeps a legacy pixel crop fixed as a fraction of the source when resizing", () => {
    const cropped = { ...element, props: { cropLeft: 50 } };
    const patch = resizeElement(cropped, "e", 200, 0, pointer);
    const resized = { ...cropped, ...patch, props: patch.props ?? cropped.props };
    expect(resized.width).toBe(400);
    expect(getCrop(resized).left).toBe(100);
    expect(cropClipPath(getCrop(resized), resized.width, resized.height)).toBe(
      "inset(0% 0% 0% 25%)"
    );
  });

  it.each([
    ["cropRight", "e", 100, 0],
    ["cropTop", "s", 0, 100],
    ["cropBottom", "s", 0, 100]
  ] as const)("preserves %s on a later resize", (side, handle, dx, dy) => {
    const cropped = { ...element, props: { [side]: 25 } };
    const patch = resizeElement(cropped, handle, dx, dy, pointer);
    const resized = { ...cropped, ...patch, props: patch.props ?? cropped.props };
    const axis = side === "cropRight" ? "width" : "height";
    expect(Number(resized.props[side]) / resized[axis]).toBeCloseTo(25 / cropped[axis]);
  });

  it("preserves all sides through enlarge and shrink without rounding drift", () => {
    const cropped = {
      ...element,
      props: { cropLeft: 20.25, cropRight: 30.5, cropTop: 10.125, cropBottom: 15.75 }
    };
    let current: OverlayElement = cropped;
    for (let i = 0; i < 30; i += 1) {
      const up = resizeElement(current, "se", 73.3, 41.7, pointer);
      current = { ...current, ...up, props: up.props ?? current.props };
      const down = resizeElement(current, "se", -73.3, -41.7, pointer);
      current = { ...current, ...down, props: down.props ?? current.props };
    }
    expect(current.width).toBeCloseTo(cropped.width);
    expect(current.height).toBeCloseTo(cropped.height);
    for (const side of ["left", "right", "top", "bottom"] as const) {
      expect(getCrop(current)[side]).toBeCloseTo(getCrop(cropped)[side], 9);
    }
  });

  it("allows Alt crop to reveal media after resizing", () => {
    const cropped = { ...element, props: { cropLeft: 50 } };
    const enlarged = resizeElement(cropped, "e", 200, 0, pointer);
    const resized = { ...cropped, ...enlarged, props: enlarged.props ?? cropped.props };
    const reveal = resizeElement(resized, "w", -40, 0, { ...pointer, altKey: true });
    expect(getCrop({ ...resized, props: reveal.props ?? resized.props }).left).toBe(60);
    expect(resized.width).toBe(400);
  });

  it("scales crop with free Shift resize and ignores Ctrl for resize geometry", () => {
    const cropped = { ...element, rotation: 30, props: { cropLeft: 50, cropTop: 25 } };
    const shift = resizeElement(cropped, "se", 200, 0, { ...pointer, shiftKey: true });
    const ctrl = resizeElement(cropped, "e", 40, 0, { ...pointer, ctrlKey: true });
    expect(shift).toMatchObject({ width: 400, height: 100, props: { cropLeft: 100, cropTop: 25 } });
    expect(ctrl).toEqual(resizeElement(cropped, "e", 40, 0, pointer));
    expect(cropClipPath(getCrop(cropped), cropped.width, cropped.height)).toBe(
      "inset(25% 0% 0% 25%)"
    );
    expect(cropped.rotation).toBe(30);
  });
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

  it("keeps the aspect ratio for an ordinary corner resize", () => {
    expect(resizeElement(element, "se", 80.5, 20.25, pointer)).toMatchObject({
      x: 100,
      y: 80,
      width: 280.5,
      height: 140.25
    });
  });

  it("stretches freely when Shift is held on a corner", () => {
    expect(resizeElement(element, "se", 80, 20, { ...pointer, shiftKey: true })).toMatchObject({
      x: 100,
      y: 80,
      width: 280,
      height: 120
    });
  });

  it("keeps the aspect ratio at the minimum corner size", () => {
    const patch = resizeElement(element, "se", -1000, -1000, pointer);
    expect(patch.width).toBe(16);
    expect(patch.height).toBe(8);
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

  it.each([
    ["w", { x: 7, y: 100, width: 200, height: 100 }, { x: 0, y: 100, width: 207, height: 100 }],
    [
      "e",
      { x: 1700, y: 100, width: 213, height: 100 },
      { x: 1700, y: 100, width: 220, height: 100 }
    ],
    ["n", { x: 100, y: 8, width: 200, height: 100 }, { x: 100, y: 0, width: 200, height: 108 }],
    ["s", { x: 100, y: 950, width: 200, height: 123 }, { x: 100, y: 950, width: 200, height: 130 }]
  ] as const)("snaps active %s edge to the OBS boundary", (handle, bounds, expected) => {
    expect(snapResizeToCanvasEdges(bounds, handle, 1920, 1080, 10, 10)).toEqual(expected);
  });

  it("snaps two corner edges and releases when dragging beyond the threshold", () => {
    expect(
      snapResizeToCanvasEdges({ x: 7, y: 8, width: 200, height: 100 }, "nw", 1920, 1080, 10, 10)
    ).toEqual({
      x: 0,
      y: 0,
      width: 207,
      height: 108
    });
    const outside = { x: -20, y: 25, width: 227, height: 83 };
    expect(snapResizeToCanvasEdges(outside, "nw", 1920, 1080, 10, 10)).toEqual(outside);
  });

  it.each([0.25, 0.5, 1, calculateFitScale(1300, 790, 1920, 1080)])(
    "uses a ten screen pixel snap threshold at scale %f",
    (scale) => {
      const near = 8 / scale;
      const far = 12 / scale;
      expect(
        snapResizeToCanvasEdges(
          { x: near, y: 100, width: 200, height: 100 },
          "w",
          1920,
          1080,
          10 / scale,
          10 / scale
        ).x
      ).toBe(0);
      expect(
        snapResizeToCanvasEdges(
          { x: far, y: 100, width: 200, height: 100 },
          "w",
          1920,
          1080,
          10 / scale,
          10 / scale
        ).x
      ).toBe(far);
    }
  );

  it("preserves aspect ratio instead of forcing incompatible corner snaps", () => {
    const bounds = { x: 100, y: 100, width: 1815, height: 972 };
    const snapped = snapResizeToCanvasEdges(bounds, "se", 1920, 1080, 10, 10, { aspectRatio: 2 });
    expect(snapped.width / snapped.height).toBeCloseTo(2);
    expect(snapped.x).toBe(100);
    expect(snapped.y).toBe(100);
    expect(snapped.x + snapped.width === 1920 && snapped.y + snapped.height === 1080).toBe(false);
  });

  it("disables snapping while Ctrl is held", () => {
    expect(snappingEnabled(pointer)).toBe(true);
    expect(snappingEnabled({ ...pointer, ctrlKey: true })).toBe(false);
    expect(snappingEnabled({ ...pointer, metaKey: true })).toBe(false);
  });

  it("pans with Space or middle mouse while leaving controls alone", () => {
    expect(shouldStartPan(0, true, false)).toBe(true);
    expect(shouldStartPan(0, false, false)).toBe(false);
    expect(shouldStartPan(1, false, false)).toBe(true);
    expect(shouldStartPan(0, true, true)).toBe(false);
  });

  it("snaps the selected item to the canvas center and other item edges", () => {
    expect(
      snapMoveToCanvasEdges({ x: 857, y: 487, width: 200, height: 100 }, 1920, 1080, 10, 10)
    ).toEqual({ x: 860, y: 490 });
    const other = { ...element, id: "other", x: 400, y: 300, width: 150, height: 120 };
    expect(
      snapMoveToCanvasEdges({ x: 392, y: 292, width: 100, height: 100 }, 1920, 1080, 10, 10, [
        other
      ])
    ).toEqual({ x: 400, y: 300 });
    expect(
      snapResizeToCanvasEdges(
        { x: 100, y: 100, width: 293, height: 193 },
        "se",
        1920,
        1080,
        10,
        10,
        { targets: [other] }
      )
    ).toEqual({ x: 100, y: 100, width: 300, height: 200 });
  });

  it("keeps Alt crop separate and preserves crop fractions after a snapped resize", () => {
    const cropped = { ...element, x: 100, width: 200, props: { cropLeft: 50 } };
    const alt = resizeElement(cropped, "e", -20, 0, { ...pointer, altKey: true });
    expect(alt.width).toBeUndefined();
    expect(alt.props).toMatchObject({ cropRight: 20 });
    const resized = resizeElement(cropped, "e", 1615, 0, pointer);
    const snapped = snapResizeToCanvasEdges(
      { x: resized.x!, y: resized.y!, width: resized.width!, height: resized.height! },
      "e",
      1920,
      1080,
      10,
      10
    );
    const props = scaleCrop(cropped, snapped.width, snapped.height)!;
    expect(snapped.x + snapped.width).toBe(1920);
    expect(Number(props.cropLeft) / snapped.width).toBeCloseTo(0.25);
  });
});
