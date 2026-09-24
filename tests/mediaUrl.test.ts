import { describe, expect, it } from "vitest";
import { buildYouTubeEmbedUrl, getYouTubeVideoId } from "../src/shared/mediaUrl";
import { mediaUrlSchema } from "../src/shared/validation";

describe("remote media validation", () => {
  it.each(["IMAGE", "GIF", "VIDEO", "AUDIO"])("accepts HTTPS links for %s", (type) => {
    expect(mediaUrlSchema.safeParse({ type, url: "https://example.com/media" }).success).toBe(true);
  });
  it.each(["file:///C:/private.png", "javascript:alert(1)", "data:image/png;base64,AAAA"])("rejects non-web URLs: %s", (url) => {
    expect(mediaUrlSchema.safeParse({ type: "IMAGE", url }).success).toBe(false);
  });
});

describe("media url helpers", () => {
  it("extracts YouTube ids from watch urls", () => {
    expect(getYouTubeVideoId("https://www.youtube.com/watch?v=OqPxaKs8xrk")).toBe("OqPxaKs8xrk");
  });

  it("extracts YouTube ids from short urls", () => {
    expect(getYouTubeVideoId("https://youtu.be/OqPxaKs8xrk")).toBe("OqPxaKs8xrk");
  });

  it("builds embeddable YouTube urls with js api enabled", () => {
    const embed = buildYouTubeEmbedUrl("https://www.youtube.com/watch?v=OqPxaKs8xrk", {
      autoplay: true,
      loop: true,
      origin: "http://localhost:5173"
    });

    expect(embed).toContain("https://www.youtube.com/embed/OqPxaKs8xrk");
    expect(embed).toContain("enablejsapi=1");
    expect(embed).toContain("autoplay=1");
    expect(embed).toContain("loop=1");
    expect(embed).toContain("playlist=OqPxaKs8xrk");
  });

  it("ignores unsupported hosts", () => {
    expect(buildYouTubeEmbedUrl("https://example.com/watch?v=OqPxaKs8xrk")).toBeNull();
  });
});
