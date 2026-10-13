import { expect, it } from "vitest";
import { ttsEnabledFromEnv } from "../src/server/config";

it("keeps Twitch TTS disabled unless explicitly enabled", () => {
  expect(ttsEnabledFromEnv(undefined)).toBe(false);
  expect(ttsEnabledFromEnv("false")).toBe(false);
  expect(ttsEnabledFromEnv("1")).toBe(false);
  expect(ttsEnabledFromEnv("true")).toBe(true);
});
