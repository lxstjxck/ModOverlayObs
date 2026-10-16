import { describe, expect, it } from "vitest";
import { mediaStatusInputSchema } from "../src/shared/mediaStatus";
import { MediaStatuses } from "../src/server/mediaStatuses";

const status = (connectionId: string, position: number, commandId: string | null = null) => ({
  elementId: "video", connectionId, position, duration: 90, playing: true, commandId
});

describe("ephemeral OBS telemetry", () => {
  it("keeps two OBS positions separate and removes only the disconnected source", () => {
    const statuses = new MediaStatuses();
    statuses.update("channel", "obs-1", status("obs-1", 12), 1000);
    statuses.update("channel", "obs-2", status("obs-2", 47), 1000);
    expect(statuses.snapshot("channel").map((item) => item.position)).toEqual([12, 47]);
    statuses.removeSocket("channel", "obs-1");
    expect(statuses.snapshot("channel")).toMatchObject([{ connectionId: "obs-2", position: 47 }]);
  });

  it("limits duplicate frames and accepts a changed command or actual seek", () => {
    const statuses = new MediaStatuses();
    expect(statuses.update("channel", "obs", status("obs", 12), 1000)).not.toBeNull();
    expect(statuses.update("channel", "obs", status("obs", 12.1), 1100)).toBeNull();
    expect(statuses.update("channel", "obs", status("obs", 42, "seek-1"), 1100)?.position).toBe(42);
    expect(statuses.update("other", "obs", status("forged", 42), 1200)).toBeNull();
    expect(statuses.snapshot("other")).toEqual([]);
  });

  it("rejects malformed and excessive telemetry", () => {
    expect(mediaStatusInputSchema.safeParse({ ...status("obs", Infinity) }).success).toBe(false);
    expect(mediaStatusInputSchema.safeParse({ ...status("obs", 1), streamerId: "other" }).success).toBe(false);
    const statuses = new MediaStatuses();
    for (let index = 0; index < 100; index += 1) {
      expect(statuses.update("channel", "obs", { ...status("obs", index), elementId: `video-${index}` }, 1000)).not.toBeNull();
    }
    expect(statuses.update("channel", "obs", { ...status("obs", 0), elementId: "overflow" }, 1000)).toBeNull();
    statuses.retainElements("channel", new Set(["video-1"]));
    expect(statuses.snapshot("channel")).toHaveLength(1);
    expect(statuses.update("channel", "obs", { ...status("obs", 0), elementId: "new" }, 2000)).not.toBeNull();
  });
});
