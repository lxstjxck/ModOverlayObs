import type { TwitchChannelView, TwitchMode } from "../shared/types";

export function dashboardMode(location: Pick<Location, "pathname" | "search">): TwitchMode {
  if (location.pathname === "/streamer") return "streamer";
  return new URLSearchParams(location.search).get("view") === "moderator" ? "moderator" : "streamer";
}

export function dashboardUrl(mode: TwitchMode): string {
  return mode === "moderator" ? "/channels?view=moderator" : "/channels";
}

export function ownTwitchChannel(channels: TwitchChannelView[], twitchId: string): TwitchChannelView | null {
  return channels.find((channel) => channel.twitchId === twitchId && channel.role === "owner") ?? null;
}

export function moderatedTwitchChannels(channels: TwitchChannelView[], twitchId: string): TwitchChannelView[] {
  return channels.filter((channel) => channel.role === "moderator" && channel.twitchId !== twitchId);
}
