import { afterEach, describe, expect, it, vi } from "vitest";
import { parseEbloMediaPage, resolveEbloMedia } from "../src/server/ebloMedia";

afterEach(() => vi.unstubAllGlobals());

describe("eblo.id post media", () => {
  it.each([
    ["image", '<img id="preview-image" src="/uploads/XRbi1j2/photo.webp">', "IMAGE", "photo.webp"],
    [
      "image",
      '<img id="preview-image" src="/uploads/XRbi1j2/animation.gif">',
      "GIF",
      "animation.gif"
    ],
    [
      "video",
      '<div id="preview-video" data-src="/uploads/XRbi1j2/clip.webm"></div>',
      "VIDEO",
      "clip.webm"
    ],
    [
      "audio",
      '<audio id="preview-audio" src="/uploads/XRbi1j2/sound.mp3"></audio>',
      "AUDIO",
      "sound.mp3"
    ]
  ] as const)("extracts %s media", (kind, tag, type, filename) => {
    expect(parseEbloMediaPage(`<body data-media-type="${kind}">${tag}</body>`, "XRbi1j2")).toEqual({
      url: `https://eblo.id/uploads/XRbi1j2/${filename}`,
      type
    });
  });

  it.each([
    '<body data-media-type="image"><img id="preview-image" src="https://evil.test/pic.webp"></body>',
    '<body data-media-type="video"><div id="preview-video" data-src="/uploads/OTHER12/clip.webm"></div></body>',
    '<body data-media-type="image"><img id="preview-image" src="/uploads/XRbi1j2/page.html"></body>',
    '<body data-media-type="album"><img id="preview-image" src="/uploads/XRbi1j2/photo.webp"></body>'
  ])("rejects unsupported or untrusted media", (html) => {
    expect(parseEbloMediaPage(html, "XRbi1j2")).toBeNull();
  });

  it("requests only the canonical post and rejects redirects", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 302 }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await resolveEbloMedia("https://www.eblo.id/XRbi1j2?share=1")).toBeNull();
    expect(fetchMock).toHaveBeenCalledWith(
      "https://eblo.id/XRbi1j2",
      expect.objectContaining({ redirect: "manual" })
    );
  });
});
