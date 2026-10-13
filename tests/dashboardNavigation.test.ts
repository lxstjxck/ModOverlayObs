import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { TwitchChannelView } from "../src/shared/types";
import { dashboardMode, dashboardUrl, moderatedTwitchChannels, ownTwitchChannel } from "../src/client/dashboardNavigation";

const own: TwitchChannelView = { id: "one", twitchId: "me", displayName: "Me", avatarUrl: null, status: "connected", role: "owner" };
const other: TwitchChannelView = { id: "two", twitchId: "other", displayName: "Other", avatarUrl: null, status: "connected", role: "moderator" };

describe("dashboard navigation", () => {
  it("keeps direct links and reloads on the selected section", () => {
    expect(dashboardMode({ pathname: "/channels", search: "" })).toBe("streamer");
    expect(dashboardMode({ pathname: "/streamer", search: "" })).toBe("streamer");
    expect(dashboardMode({ pathname: "/channels", search: "?view=moderator" })).toBe("moderator");
    expect(dashboardMode({ pathname: "/channels", search: "?view=unknown" })).toBe("streamer");
    expect(dashboardUrl("streamer")).toBe("/channels");
    expect(dashboardUrl("moderator")).toBe("/channels?view=moderator");
  });

  it("derives channel lists from the authenticated Twitch identity", () => {
    expect(ownTwitchChannel([other, own], "me")).toEqual(own);
    expect(ownTwitchChannel([other], "me")).toBeNull();
    expect(moderatedTwitchChannels([own, other, { ...other, twitchId: "me" }], "me")).toEqual([other]);
  });

  it("offers touch sized controls and a single column channel grid on mobile", () => {
    const css = readFileSync(new URL("../src/client/styles/workspace.css", import.meta.url), "utf8");
    expect(css).toMatch(/\.lxst-mode-switch button\s*\{[^}]*min-height:\s*44px/s);
    expect(css).toMatch(/@media \(max-width: 760px\)[\s\S]*?\.lxst-channel-grid\s*\{\s*grid-template-columns:\s*minmax\(0, 1fr\)/);
  });
});
