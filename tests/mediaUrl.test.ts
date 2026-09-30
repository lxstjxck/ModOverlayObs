import { describe, expect, it } from "vitest";
import {
  buildYouTubeEmbedUrl,
  detectMediaTypeFromUrl,
  getEbloPostId,
  getYouTubeVideoId
} from "../src/shared/mediaUrl";
import { mediaUrlSchema } from "../src/shared/validation";

describe("remote media validation", () => {
  it.each(["IMAGE", "GIF", "VIDEO", "AUDIO"])("accepts HTTPS links for %s", (type) => {
    expect(mediaUrlSchema.safeParse({ type, url: "https://example.com/media" }).success).toBe(true);
  });
  it.each(["file:///C:/private.png", "javascript:alert(1)", "data:image/png;base64,AAAA"])(
    "rejects non-web URLs: %s",
    (url) => {
      expect(mediaUrlSchema.safeParse({ type: "IMAGE", url }).success).toBe(false);
    }
  );
});

describe("media url helpers", () => {
  it("recognizes eblo.id post links without accepting lookalike hosts", () => {
    expect(getEbloPostId("https://eblo.id/XRbi1j2?share=1")).toBe("XRbi1j2");
    expect(getEbloPostId("https://www.eblo.id/XRbi1j2")).toBe("XRbi1j2");
    for (const url of [
      "https://eblo.id.evil.test/XRbi1j2",
      "http://eblo.id/XRbi1j2",
      "https://eblo.id/@user",
      "https://eblo.id/XRbi1j2/other"
    ])
      expect(getEbloPostId(url)).toBeNull();
  });

  it("accepts a post without a declared media type only for eblo.id", () => {
    expect(mediaUrlSchema.safeParse({ url: "https://eblo.id/XRbi1j2" }).success).toBe(true);
    expect(mediaUrlSchema.safeParse({ url: "https://example.com/file.mp4" }).success).toBe(false);
  });
  it.each([
    ["https://cdn.example.com/image.PNG?size=large", "IMAGE"],
    ["https://cdn.example.com/animation.gif", "GIF"],
    ["https://cdn.example.com/video.mp4", "VIDEO"],
    ["https://cdn.example.com/audio.mp3", "AUDIO"],
    ["https://cdn.example.com/image?format=webp", "IMAGE"],
    ["https://youtu.be/OqPxaKs8xrk", "VIDEO"]
  ] as const)("detects %s as %s", (url, type) => {
    expect(detectMediaTypeFromUrl(url)).toBe(type);
  });

  it.each([
    "https://cdn.example.com/media",
    "https://example.com/watch?v=OqPxaKs8xrk",
    "file:///private/video.mp4",
    "not a url"
  ])("does not guess the type of %s", (url) => {
    expect(detectMediaTypeFromUrl(url)).toBeNull();
  });

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
