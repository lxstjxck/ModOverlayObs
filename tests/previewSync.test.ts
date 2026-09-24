import { describe, expect, it } from "vitest";
import { reconcilePreview } from "../src/client/previewSync";
import type { OverlayElement } from "../src/shared/types";

const item: OverlayElement = {
  id: "image",
  type: "IMAGE",
  name: "Image",
  x: 0,
  y: 0,
  width: 100,
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

describe("preview reconciliation with delayed server updates", () => {
  it.each(["IMAGE", "GIF", "VIDEO", "AUDIO", "TEXT"] as const)(
    "keeps %s rendering properties when a batched drag contains undefined props",
    (type) => {
      const original = { ...item, type, props: { cropLeft: 0.1, fontSize: 46 } };
      const [result] = reconcilePreview(
        [original],
        new Map([[item.id, { x: 40, props: undefined }]]),
        new Map([[item.id, { x: 90, props: undefined }]])
      );
      expect(result.props).toEqual(original.props);
      expect(result.x).toBe(90);
    }
  );
  it("keeps the newest drag position while an older update is in flight", () => {
    const result = reconcilePreview(
      [item],
      new Map([[item.id, { x: 40, y: 20 }]]),
      new Map([[item.id, { x: 90, y: 50 }]])
    );
    expect(result[0]).toMatchObject({ x: 90, y: 50 });
    expect(item.x).toBe(0);
  });

  it("retains a pending style edit during subsequent movement and accepts explicit style clearing", () => {
    const sent = new Map([[item.id, { props: { cropLeft: 0.2 } }]]);
    const [moving] = reconcilePreview([item], sent, new Map([[item.id, { x: 90, props: undefined }]]));
    expect(moving.props).toEqual({ cropLeft: 0.2 });
    const [cleared] = reconcilePreview([item], sent, new Map([[item.id, { props: {} }]]));
    expect(cleared.props).toEqual({});
  });

  it("protects the last mouse position after the pending update has been sent", () => {
    const result = reconcilePreview(
      [{ ...item, x: 40 }],
      new Map([[item.id, { x: 90 }]]),
      new Map()
    );
    expect(result[0].x).toBe(90);
  });

  it("accepts server changes after acknowledgement and does not restore removed objects", () => {
    expect(reconcilePreview([{ ...item, x: 120 }], new Map(), new Map())[0].x).toBe(120);
    expect(reconcilePreview([], new Map([[item.id, { x: 90 }]]), new Map())).toEqual([]);
  });

  it("preserves unrelated changes from other moderators", () => {
    const result = reconcilePreview(
      [{ ...item, visible: false, name: "Renamed" }],
      new Map([[item.id, { x: 90 }]]),
      new Map()
    );
    expect(result[0]).toMatchObject({ x: 90, visible: false, name: "Renamed" });
  });
});
