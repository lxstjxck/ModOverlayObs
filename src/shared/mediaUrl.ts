export interface YouTubeEmbedOptions {
  autoplay?: boolean;
  muted?: boolean;
  loop?: boolean;
  origin?: string;
}

export function getYouTubeVideoId(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  try {
    const url = new URL(value);
    const host = url.hostname.replace(/^www\./, "").toLowerCase();
    if (host === "youtu.be") {
      return sanitizeYouTubeId(url.pathname.split("/").filter(Boolean)[0]);
    }
    if (!["youtube.com", "m.youtube.com", "music.youtube.com", "youtube-nocookie.com"].includes(host)) {
      return null;
    }
    if (url.pathname === "/watch") {
      return sanitizeYouTubeId(url.searchParams.get("v"));
    }
    const parts = url.pathname.split("/").filter(Boolean);
    if (["embed", "shorts", "live"].includes(parts[0] ?? "")) {
      return sanitizeYouTubeId(parts[1]);
    }
  } catch {
    return null;
  }
  return null;
}

export function buildYouTubeEmbedUrl(
  value: string | null | undefined,
  options: YouTubeEmbedOptions = {}
): string | null {
  const id = getYouTubeVideoId(value);
  if (!id) {
    return null;
  }
  const url = new URL(`https://www.youtube.com/embed/${id}`);
  url.searchParams.set("enablejsapi", "1");
  url.searchParams.set("playsinline", "1");
  url.searchParams.set("rel", "0");
  url.searchParams.set("modestbranding", "1");
  if (options.origin) {
    url.searchParams.set("origin", options.origin);
  }
  if (options.autoplay) {
    url.searchParams.set("autoplay", "1");
  }
  if (options.muted) {
    url.searchParams.set("mute", "1");
  }
  if (options.loop) {
    url.searchParams.set("loop", "1");
    url.searchParams.set("playlist", id);
  }
  return url.toString();
}

function sanitizeYouTubeId(value: string | null | undefined): string | null {
  if (!value || !/^[a-zA-Z0-9_-]{6,32}$/.test(value)) {
    return null;
  }
  return value;
}
