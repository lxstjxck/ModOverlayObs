import { describe, expect, it } from "vitest";
import { detectSignature } from "../src/server/utils/magic";

describe("upload magic detection", () => {
  it("accepts png with matching extension and mime", () => {
    const buffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(detectSignature(buffer, "test.png", "image/png")).toMatchObject({
      ok: true,
      type: "IMAGE",
      normalizedExtension: ".png"
    });
  });

  it("rejects mismatched mime and extension", () => {
    const buffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(detectSignature(buffer, "test.png", "video/mp4")).toMatchObject({
      ok: false
    });
  });

  it("rejects svg even when it is named like an image", () => {
    const buffer = Buffer.from("<svg><script>alert(1)</script></svg>");
    expect(detectSignature(buffer, "test.png", "image/png")).toMatchObject({
      ok: false
    });
  });

  it("accepts mp3 audio with matching extension and mime", () => {
    const buffer = Buffer.from("ID3\x04\x00\x00\x00\x00\x00\x21", "binary");
    expect(detectSignature(buffer, "track.mp3", "audio/mpeg")).toMatchObject({
      ok: true,
      type: "AUDIO",
      normalizedExtension: ".mp3"
    });
  });

  it("rejects audio when the extension is declared as video", () => {
    const buffer = Buffer.from("ID3\x04\x00\x00\x00\x00\x00\x21", "binary");
    expect(detectSignature(buffer, "track.mp4", "video/mp4")).toMatchObject({
      ok: false
    });
  });
});
