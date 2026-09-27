import { describe, expect, it } from "vitest";
import { elementTransformSchema } from "../src/shared/validation";

describe("transient transform validation", () => {
  it("accepts a small geometry patch", () => {
    expect(elementTransformSchema.parse({ id: "element", x: 123, y: 456 })).toEqual({
      id: "element",
      x: 123,
      y: 456
    });
  });

  it.each([
    { id: "element" },
    { id: "element", x: Number.NaN },
    { id: "element", width: 0 },
    { id: "element", crop: { left: -1, right: 0, top: 0, bottom: 0 } },
    { id: "element", x: 1, props: { playbackCommand: "play" } },
    { id: "", x: 1 }
  ])("rejects invalid or non-geometric fields", (payload) => {
    expect(elementTransformSchema.safeParse(payload).success).toBe(false);
  });
});
