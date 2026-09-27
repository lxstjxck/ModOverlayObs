import { describe, expect, it } from "vitest";
import { normalizeSevenTv, normalizeTwitch } from "../src/server/emotes";

const template = "https://static-cdn.jtvnw.net/emoticons/v2/{id}/{format}/{theme_mode}/{scale}";
const host = {
  url: "//cdn.7tv.app/emote/01ABCDEF0123456789ABCDEF01",
  files: [
    { name: "1x.webp", width: 32, height: 24 },
    { name: "4x.webp", width: 128, height: 96 },
    { name: "4x.avif", width: 128, height: 96 }
  ]
};

describe("channel emote normalization", () => {
  it("uses the Twitch template and keeps static and animated variants", () => {
    const result = normalizeTwitch({
      template,
      data: [
        { id: "static", name: "Still", format: ["static"] },
        { id: "moving", name: "Move", format: ["static", "animated"] }
      ]
    });
    expect(result[0]).toMatchObject({
      provider: "twitch",
      animated: false,
      sourceUrl: "https://static-cdn.jtvnw.net/emoticons/v2/static/static/dark/3.0"
    });
    expect(result[1]).toMatchObject({
      animated: true,
      previewUrl: "https://static-cdn.jtvnw.net/emoticons/v2/moving/animated/dark/1.0",
      sourceUrl: "https://static-cdn.jtvnw.net/emoticons/v2/moving/animated/dark/3.0"
    });
  });

  it("uses the channel alias, WebP variants and source dimensions for 7TV", () => {
    const result = normalizeSevenTv({
      emote_set: {
        emotes: [
          {
            id: "one",
            name: "ChannelAlias",
            data: { id: "one", name: "Original", animated: true, host }
          },
          { id: "two", name: "StaticAlias", data: { id: "two", animated: false, host } }
        ]
      }
    });
    expect(result[0]).toMatchObject({
      provider: "7tv",
      name: "ChannelAlias",
      animated: true,
      width: 128,
      height: 96,
      sourceUrl: "https://cdn.7tv.app/emote/01ABCDEF0123456789ABCDEF01/4x.webp"
    });
    expect(result[1]).toMatchObject({ name: "StaticAlias", animated: false });
  });
});
