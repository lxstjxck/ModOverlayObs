import { describe, expect, it } from "vitest";
import { normalizeSevenTv, normalizeTwitch } from "../src/server/emotes";

const template =
  "https://static-cdn.jtvnw.net/emoticons/v2/{{id}}/{{format}}/{{theme_mode}}/{{scale}}";
const host = {
  url: "//cdn.7tv.app/emote/01ABCDEF0123456789ABCDEF01",
  files: [
    { name: "1x.webp", width: 32, height: 24 },
    { name: "4x.webp", width: 128, height: 96 },
    { name: "4x.avif", width: 128, height: 96 }
  ]
};

describe("channel emote normalization", () => {
  it("expands the real Helix double-brace template for static and animated emotes", () => {
    const result = normalizeTwitch({
      template,
      data: [
        {
          id: "304456832",
          name: "Still",
          format: ["static"],
          scale: ["1.0", "2.0", "3.0"],
          theme_mode: ["light", "dark"]
        },
        {
          id: "emotesv2_e5a0b78816ed45f8aa5082e9ad7f52a5",
          name: "Move",
          format: ["static", "animated"],
          scale: ["1.0", "2.0", "3.0"],
          theme_mode: ["light", "dark"]
        }
      ]
    });
    expect(result[0]).toMatchObject({
      provider: "twitch",
      animated: false,
      previewUrl: "https://static-cdn.jtvnw.net/emoticons/v2/304456832/static/dark/1.0",
      sourceUrl: "https://static-cdn.jtvnw.net/emoticons/v2/304456832/static/dark/3.0"
    });
    expect(result[1]).toMatchObject({
      animated: true,
      previewUrl:
        "https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_e5a0b78816ed45f8aa5082e9ad7f52a5/animated/dark/1.0",
      sourceUrl:
        "https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_e5a0b78816ed45f8aa5082e9ad7f52a5/animated/dark/3.0"
    });
    for (const emote of result) {
      for (const url of [emote.previewUrl, emote.sourceUrl]) {
        expect(url).not.toMatch(/[{}]|%7b|%7d/i);
      }
    }
  });

  it("uses only the formats, theme and scales supplied for an emote", () => {
    const result = normalizeTwitch({
      template,
      data: [
        {
          id: "limited",
          name: "Limited",
          format: ["static"],
          scale: ["2.0", "1.0"],
          theme_mode: ["light"]
        },
        {
          id: "one_size",
          name: "One size",
          format: ["animated"],
          scale: ["2.0"],
          theme_mode: ["dark"]
        }
      ]
    });
    expect(result[0]).toMatchObject({
      animated: false,
      previewUrl: "https://static-cdn.jtvnw.net/emoticons/v2/limited/static/light/1.0",
      sourceUrl: "https://static-cdn.jtvnw.net/emoticons/v2/limited/static/light/2.0"
    });
    expect(result[1]).toMatchObject({
      animated: true,
      previewUrl: "https://static-cdn.jtvnw.net/emoticons/v2/one_size/animated/dark/2.0",
      sourceUrl: "https://static-cdn.jtvnw.net/emoticons/v2/one_size/animated/dark/2.0"
    });
  });

  it("falls back to the static image URLs when an animated template cannot be expanded", () => {
    const result = normalizeTwitch({
      template: "https://static-cdn.jtvnw.net/emoticons/v2/{{id}}/missing/{{theme_mode}}/{{scale}}",
      data: [
        {
          id: "fallback",
          name: "Fallback",
          format: ["static", "animated"],
          scale: ["1.0", "3.0"],
          theme_mode: ["dark"],
          images: {
            url_1x: "https://static-cdn.jtvnw.net/emoticons/v2/fallback/static/light/1.0",
            url_4x: "https://static-cdn.jtvnw.net/emoticons/v2/fallback/static/light/3.0"
          }
        }
      ]
    });
    expect(result).toMatchObject([
      {
        animated: false,
        previewUrl: "https://static-cdn.jtvnw.net/emoticons/v2/fallback/static/light/1.0",
        sourceUrl: "https://static-cdn.jtvnw.net/emoticons/v2/fallback/static/light/3.0"
      }
    ]);
    expect(result[0].previewUrl).not.toMatch(/[{}]|%7b|%7d/i);
    expect(result[0].sourceUrl).not.toMatch(/[{}]|%7b|%7d/i);
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
