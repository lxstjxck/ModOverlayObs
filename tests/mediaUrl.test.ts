import { describe, expect, it } from "vitest";
import {
  buildYouTubeEmbedUrl,
  detectMediaTypeFromUrl,
  getEbloPostId,
  getYouTubeVideoId,
  isPublicHttpsMediaUrl,
  isRenderableMediaUrl
} from "../src/shared/mediaUrl";
import { customEmoteSchema, mediaUrlSchema } from "../src/shared/validation";

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

  it.each([
    "https://cdn.example.org/picture.png",
    "https://cdn.example.org/movie.mp4",
    "https://cdn.example.org/sound.mp3",
    "https://www.youtube.com/watch?v=OqPxaKs8xrk",
    "https://eblo.id/XRbi1j2",
    "https://static-cdn.jtvnw.net/emoticons/v2/123/static/dark/3.0",
    "https://cdn.7tv.app/emote/123/4x.webp",
    "https://custom.example.org/emote.gif",
    "https://8.8.8.8/media.png",
    "https://[2606:4700:4700::1111]/media.png"
  ])("accepts public HTTPS destination %s", (url) => {
    expect(isPublicHttpsMediaUrl(url)).toBe(true);
    expect(isRenderableMediaUrl(url)).toBe(true);
  });

  it.each([
    "http://localhost/a.mp4", "http://127.0.0.1/a.mp4", "https://127.0.0.1/a.mp4",
    "https://10.0.0.1/a.mp4", "https://172.16.2.3/a.mp4", "https://192.168.1.1/a.mp4",
    "https://169.254.1.1/a.mp4", "https://100.64.0.1/a.mp4", "https://0.0.0.0/a.mp4",
    "https://[::1]/a.mp4", "https://[fc00::1]/a.mp4", "https://[fe80::1]/a.mp4",
    "https://[::ffff:127.0.0.1]/a.mp4", "https://2130706433/a.mp4",
    "https://0x7f000001/a.mp4", "https://0177.0.0.1/a.mp4", "https://127.1/a.mp4",
    "https://127%2e0%2e0%2e1/a.mp4", "https://[::ffff:7f00:1]/a.mp4",
    "https://foo.localhost/a.mp4", "https://foo.local/a.mp4", "https://router.lan/a.mp4",
    "https://foo%2elocal/a.mp4",
    "https://router.home.arpa/a.mp4", "https://host.localdomain/a.mp4",
    "https://localhost./a.mp4", "https://user:pass@example.org/a.mp4",
    "file:///tmp/a.png", "data:image/png,AAAA", "javascript:alert(1)",
    "https://example.org:8443/a.mp4", "https://example.org\\@127.0.0.1/a.mp4",
    "not a url", `https://example.org/${"a".repeat(2048)}`
  ])("rejects unsafe destination %s", (url) => {
    expect(isPublicHttpsMediaUrl(url)).toBe(false);
    expect(isRenderableMediaUrl(url)).toBe(false);
    expect(mediaUrlSchema.safeParse({ type: "VIDEO", url }).success).toBe(false);
  });

  it("keeps generated uploads usable without accepting external upload lookalikes", () => {
    expect(isRenderableMediaUrl("/uploads/abc-123.mp4?overlayToken=secret_1")).toBe(true);
    expect(isRenderableMediaUrl("/uploads/abc-123.mp4")).toBe(true);
    expect(isRenderableMediaUrl("//evil.example.org/uploads/abc.mp4")).toBe(false);
  });

  it("applies the same destination policy to Custom Emotes", () => {
    expect(customEmoteSchema.safeParse({ url: "https://custom.example.org/emote.webp" }).success).toBe(true);
    expect(customEmoteSchema.safeParse({ url: "https://192.168.1.1/emote.webp" }).success).toBe(false);
  });
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
