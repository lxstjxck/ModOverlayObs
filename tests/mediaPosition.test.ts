import { describe, expect, it } from "vitest";
import { formatMediaPosition, parseMediaPosition } from "../src/client/mediaPosition";

describe("media position", () => {
  it("formats playback time as minutes and seconds", () => {
    expect(formatMediaPosition(0)).toBe("00:00");
    expect(formatMediaPosition(83.8)).toBe("01:23");
    expect(formatMediaPosition(83.8, true)).toBe("00:01:23");
    expect(formatMediaPosition(3600)).toBe("01:00:00");
  });

  it("accepts valid positions and rejects malformed or out-of-range values", () => {
    expect(parseMediaPosition(" 01:23 ")).toBe(83);
    expect(parseMediaPosition("00:00")).toBe(0);
    expect(parseMediaPosition("01:02:03")).toBe(3723);
    expect(parseMediaPosition("24:00:00")).toBe(86400);
    for (const invalid of ["1:23", "01m:23s", "01:60", "01:99:00", "25:00:00", "-01:00"])
      expect(parseMediaPosition(invalid)).toBeNull();
  });
});
