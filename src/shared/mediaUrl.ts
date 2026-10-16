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

export const unsafeMediaUrlMessage =
  "Нельзя использовать локальный или небезопасный адрес. Укажите публичную HTTPS-ссылку на медиа.";

// Browser Source resolves DNS itself. This check blocks literal/local destinations; it
// cannot prevent a public hostname from later resolving or redirecting to a private IP.
export function isPublicHttpsMediaUrl(value: string | null | undefined): boolean {
  if (
    !value ||
    value.length > 2048 ||
    /[\s\\]/.test(value) ||
    [...value].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)
  ) return false;
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.port ||
      !url.hostname ||
      url.hostname.endsWith(".") ||
      url.href.length > 2048
    )
      return false;

    const host = url.hostname.toLowerCase();
    if (host.startsWith("[")) {
      const address = host.slice(1, -1);
      // Only global unicast IPv6 is eligible. This excludes mapped IPv4,
      // loopback, unique-local, link-local and unspecified addresses.
      return /^[23][0-9a-f]{3}:/i.test(address) && !address.startsWith("2001:db8:");
    }
    if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
      const [a, b, c] = host.split(".").map(Number);
      return !(
        a === 0 ||
        a === 10 ||
        a === 127 ||
        a >= 224 ||
        (a === 100 && b >= 64 && b <= 127) ||
        (a === 169 && b === 254) ||
        (a === 172 && b >= 16 && b <= 31) ||
        (a === 192 && (b === 168 || (b === 0 && (c === 0 || c === 2)) || (b === 88 && c === 99))) ||
        (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
        (a === 203 && b === 0 && c === 113)
      );
    }
    const labels = host.split(".");
    if (
      labels.length < 2 ||
      labels.some((label) => !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label))
    ) return false;
    return ![
      "localhost", "local", "localdomain", "internal", "lan", "home", "corp",
      "intranet", "arpa", "onion", "test", "invalid"
    ].includes(labels.at(-1)!);
  } catch {
    return false;
  }
}

export function isRenderableMediaUrl(value: string | null | undefined): boolean {
  return Boolean(
    value &&
    (/^\/uploads\/[a-zA-Z0-9-]+\.[a-zA-Z0-9]+(?:\?overlayToken=[A-Za-z0-9_-]+)?$/.test(value) ||
      isPublicHttpsMediaUrl(value))
  );
}

export function detectMediaTypeFromUrl(value: string): MediaType | null {
  try {
    if (!isPublicHttpsMediaUrl(value)) return null;
    const url = new URL(value);
    if (getYouTubeVideoId(value)) return "VIDEO";

    const extension = url.pathname.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase();
    if (extension && mediaExtensions[extension]) return mediaExtensions[extension];

    const format = url.searchParams.get("format") ?? url.searchParams.get("fm");
    return format ? (mediaExtensions[format.toLowerCase()] ?? null) : null;
  } catch {
    return null;
  }
}

export function getEbloPostId(value: string): string | null {
  try {
    if (!isPublicHttpsMediaUrl(value)) return null;
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      !["eblo.id", "www.eblo.id"].includes(url.hostname.toLowerCase()) ||
      url.port ||
      url.username ||
      url.password
    )
      return null;
    const match = /^\/([a-zA-Z0-9]{7})\/?$/.exec(url.pathname);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

export function getYouTubeVideoId(value: string | null | undefined): string | null {
  if (!value || !isPublicHttpsMediaUrl(value)) {
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
  url.searchParams.set("playlist", id);
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
  }
  return url.toString();
}

function sanitizeYouTubeId(value: string | null | undefined): string | null {
  if (!value || !/^[a-zA-Z0-9_-]{6,32}$/.test(value)) {
    return null;
  }
  return value;
}
