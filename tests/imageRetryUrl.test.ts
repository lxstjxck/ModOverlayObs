import { describe, expect, it } from "vitest";
import { imageRetryUrl } from "../src/client/components/CanvasStage";

describe("image retry URL", () => {
  it("retries an external image without losing its query string", () => {
    expect(imageRetryUrl("https://cdn.7tv.app/emote/abc/4x.webp?foo=bar", 2)).toBe(
      "https://cdn.7tv.app/emote/abc/4x.webp?foo=bar&overlayRetry=2"
    );
  });

  it("does not change protected upload paths", () => {
    expect(imageRetryUrl("/uploads/image.png?overlayToken=secret", 1)).toBe(
      "/uploads/image.png?overlayToken=secret"
    );
  });
});
