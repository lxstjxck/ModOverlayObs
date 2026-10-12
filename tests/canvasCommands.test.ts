import { describe, expect, it } from "vitest";
import type { OverlayElement, StreamerView } from "../src/shared/types";
import { layerOrderPatches, reversePatch, transformCommand } from "../src/client/canvasCommands";

const streamer: StreamerView = {
  id: "streamer",
  displayName: "Test",
  canvasWidth: 1920,
  canvasHeight: 1080
};
const element: OverlayElement = {
  id: "a",
  type: "IMAGE",
  name: "Image",
  x: 50,
  y: 70,
  width: 400,
  height: 200,
  rotation: 25,
  opacity: 1,
  zIndex: 1,
  visible: true,
  animationIn: "none",
  animationOut: "none",
  liveVolume: 1,
  muted: false,
  loop: false,
  startTime: 0,
  props: { cropLeft: 100, cropRight: 0, cropTop: 20, cropBottom: 0 }
};

describe("OBS transform commands", () => {
  it("fits, stretches, and centers a cropped element without revealing its source", () => {
    const fit = transformCommand(element, streamer, "fit");
    expect(fit).toMatchObject({
      x: 0,
      y: 60,
      width: 1920,
      height: 960,
      props: { cropLeft: 480, cropTop: 96 }
    });
    const stretch = transformCommand(element, streamer, "stretch");
    expect(stretch).toMatchObject({
      x: 0,
      y: 0,
      width: 1920,
      height: 1080,
      props: { cropLeft: 480, cropTop: 108 }
    });
    expect(transformCommand(element, streamer, "center")).toEqual({ x: 760, y: 440 });
  });

  it("resets geometry, rotation, and crop while preserving other properties", () => {
    expect(transformCommand(element, streamer, "reset", { width: 640, height: 360 })).toMatchObject(
      {
        x: 0,
        y: 0,
        width: 640,
        height: 360,
        rotation: 0,
        props: { cropLeft: 0, cropTop: 0 }
      }
    );
  });

  it("moves a layer by one position or to an extreme", () => {
    const layers = [
      element,
      { ...element, id: "b", zIndex: 2 },
      { ...element, id: "c", zIndex: 3 }
    ];
    expect(layerOrderPatches(layers, "a", "up")).toEqual([
      { id: "b", zIndex: 1 },
      { id: "a", zIndex: 2 },
      { id: "c", zIndex: 3 }
    ]);
    expect(layerOrderPatches(layers, "a", "top").map((item) => item.id)).toEqual(["b", "c", "a"]);
    expect(layerOrderPatches(layers, "a", "bottom")).toEqual([]);
  });

  it("captures only edited fields for undo and redo", () => {
    expect(reversePatch(element, { x: 200, props: { cropLeft: 0 } })).toEqual({
      x: 50,
      props: element.props
    });
  });
});
