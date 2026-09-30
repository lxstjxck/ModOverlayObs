import { describe, expect, it } from "vitest";
import { cleanTtsText, moderatorTtsText, redemptionTtsText } from "../src/server/ttsPolicy";

describe("Twitch TTS policy", () => {
  it("accepts a moderator command, regardless of case", () => {
    expect(
      moderatorTtsText(
        {
          broadcaster_user_id: "streamer",
          chatter_user_id: "mod",
          badges: [{ set_id: "moderator" }],
          message: { text: "!TTS  Привет   стример " }
        },
        "streamer"
      )
    ).toBe("Привет стример");
  });

  it("accepts a lead moderator command", () => {
    expect(
      moderatorTtsText(
        {
          broadcaster_user_id: "streamer",
          chatter_user_id: "lead-mod",
          badges: [{ set_id: "lead_moderator" }],
          message: { text: "!tts проверка" }
        },
        "streamer"
      )
    ).toBe("проверка");
  });

  it("rejects commands from non-moderators and rewards", () => {
    const base = {
      broadcaster_user_id: "streamer",
      chatter_user_id: "viewer",
      message: { text: "!tts hello" }
    };
    expect(moderatorTtsText(base, "streamer")).toBeNull();
    expect(
      moderatorTtsText(
        { ...base, badges: [{ set_id: "moderator" }], channel_points_custom_reward_id: "x" },
        "streamer"
      )
    ).toBeNull();
    expect(
      moderatorTtsText(
        { ...base, badges: [{ set_id: "moderator" }], source_broadcaster_user_id: "other" },
        "streamer"
      )
    ).toBeNull();
  });

  it("rejects empty or oversized text", () => {
    expect(cleanTtsText("  ")).toBeNull();
    expect(cleanTtsText("x".repeat(201))).toBeNull();
    expect(cleanTtsText("hello\n world")).toBe("hello world");
  });

  it("accepts only the configured channel points reward", () => {
    const event = {
      id: "redemption",
      broadcaster_user_id: "streamer",
      user_id: "viewer",
      reward: { id: "tts-reward" },
      user_input: " Привет  "
    };
    expect(redemptionTtsText(event, "streamer", "tts-reward")).toBe("Привет");
    expect(redemptionTtsText(event, "other", "tts-reward")).toBeNull();
    expect(redemptionTtsText(event, "streamer", "other-reward")).toBeNull();
    expect(redemptionTtsText(event, "streamer", null)).toBeNull();
    expect(
      redemptionTtsText({ ...event, user_input: "x".repeat(201) }, "streamer", "tts-reward")
    ).toBeNull();
    expect(
      redemptionTtsText({ ...event, status: "fulfilled" }, "streamer", "tts-reward")
    ).toBeNull();
  });
});
