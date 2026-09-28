import { describe, expect, it } from "vitest";
import { previewAddSchema } from "../src/shared/validation";

describe("preview media dimensions", () => {
  it("accepts a complete intrinsic size", () => {
    expect(previewAddSchema.parse({ mediaId: "media-1", width: 1080, height: 1920 })).toMatchObject(
      {
        width: 1080,
        height: 1920
      }
    );
  });
  expect(previewAddSchema.safeParse({ mediaId: "media-1", width: 1, height: 1 }).success).toBe(
    true
  );

  it("rejects missing, invalid, or oversized dimensions", () => {
    for (const size of [
      { width: 1920 },
      { width: 0, height: 1080 },
      { width: 10001, height: 1080 },
      { width: 1920.5, height: 1080 },
      { width: Number.NaN, height: 1080 }
    ]) {
      expect(previewAddSchema.safeParse({ mediaId: "media-1", ...size }).success).toBe(false);
    }
  });
});
