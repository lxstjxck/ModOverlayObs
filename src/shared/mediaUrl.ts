import type { MediaType } from "./types";

export interface YouTubeEmbedOptions {
  autoplay?: boolean;
  muted?: boolean;
  loop?: boolean;
  origin?: string;
}

const mediaExtensions: Record<string, MediaType> = {
  png: "IMAGE",
  jpg: "IMAGE",
  jpeg: "IMAGE",
  webp: "IMAGE",
  avif: "IMAGE",
  gif: "GIF",
  mp4: "VIDEO",
  webm: "VIDEO",
  mp3: "AUDIO",
  wav: "AUDIO",
  ogg: "AUDIO",
  oga: "AUDIO",
  m4a: "AUDIO",
  aac: "AUDIO",
  flac: "AUDIO"
};

export function detectMediaTypeFromUrl(value: string): MediaType | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (getYouTubeVideoId(value)) return "VIDEO";

    const extension = url.pathname.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase();
    if (extension && mediaExtensions[extension]) return mediaExtensions[extension];

    const format = url.searchParams.get("format") ?? url.searchParams.get("fm");
    return format ? (mediaExtensions[format.toLowerCase()] ?? null) : null;
  } catch {
    return null;
  }
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
    if (
      !["youtube.com", "m.youtube.com", "music.youtube.com", "youtube-nocookie.com"].includes(host)
    ) {
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
