import type { CustomEmote, Streamer } from "@prisma/client";
import type { ChannelEmote, ChannelEmotesResponse, EmoteProviderName } from "../shared/types";
import { config } from "./config";
import { prisma } from "./db";

const ttlMs = 10 * 60_000;
const cache = new Map<string, { expires: number; items: ChannelEmote[] }>();
let appToken: { value: string; expires: number } | undefined;
let tokenRequest: Promise<string> | undefined;

async function getJson(url: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(8_000),
    redirect: "error"
  });
  if (!response.ok) throw new Error(`Provider returned ${response.status}`);
  return response.json();
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function items(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function string(value: unknown): string {
  return typeof value === "string" ? value : "";
}

async function twitchToken(): Promise<string> {
  if (!config.twitchClientId || !config.twitchClientSecret)
    throw new Error("Twitch credentials are not configured");
  if (appToken && appToken.expires > Date.now()) return appToken.value;
  if (!tokenRequest) {
    tokenRequest = (async () => {
      const body = new URLSearchParams({
        client_id: config.twitchClientId,
        client_secret: config.twitchClientSecret,
        grant_type: "client_credentials"
      });
      const data = record(
        await getJson("https://id.twitch.tv/oauth2/token", { method: "POST", body })
      );
      const value = string(data.access_token);
      if (!value) throw new Error("Twitch token response is invalid");
      appToken = {
        value,
        expires: Date.now() + Math.max(60, Number(data.expires_in) - 300) * 1000
      };
      return value;
    })().finally(() => {
      tokenRequest = undefined;
    });
  }
  return tokenRequest;
}

async function twitchApi(path: string): Promise<Record<string, unknown>> {
  const token = await twitchToken();
  return record(
    await getJson(`https://api.twitch.tv/helix/${path}`, {
      headers: { "Client-Id": config.twitchClientId, Authorization: `Bearer ${token}` }
    })
  );
}

async function broadcasterId(streamer: Streamer): Promise<string> {
  if (streamer.twitchBroadcasterId) return streamer.twitchBroadcasterId;
  if (!streamer.twitchLogin) throw new Error("Set a Twitch channel first");
  const data = await twitchApi(`users?login=${encodeURIComponent(streamer.twitchLogin)}`);
  const id = string(record(items(data.data)[0]).id);
  if (!id) throw new Error("Twitch channel was not found");
  const updated = await prisma.streamer.updateMany({
    where: { id: streamer.id, twitchLogin: streamer.twitchLogin },
    data: { twitchBroadcasterId: id }
  });
  if (!updated.count) throw new Error("Twitch channel changed while loading");
  return id;
}

function twitchUrl(
  template: string,
  id: string,
  format: "static" | "animated",
  theme: "dark" | "light",
  scale: string
): string | null {
  if (!["id", "format", "theme_mode", "scale"].every((field) => template.includes(`{{${field}}}`)))
    return null;
  const value = template
    .replaceAll("{{id}}", encodeURIComponent(id))
    .replaceAll("{{format}}", format)
    .replaceAll("{{theme_mode}}", theme)
    .replaceAll("{{scale}}", scale);
  return validTwitchUrl(value) ? value : null;
}

function validTwitchUrl(value: string): boolean {
  if (/[{}]|%7b|%7d/i.test(value)) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "static-cdn.jtvnw.net";
  } catch {
    return false;
  }
}

function twitchScales(value: unknown): string[] {
  return items(value)
    .filter(
      (scale): scale is string =>
        typeof scale === "string" && /^\d+(?:\.\d+)?$/.test(scale) && Number(scale) > 0
    )
    .sort((left, right) => Number(left) - Number(right));
}

function twitchStaticImage(row: Record<string, unknown>, scale: string): string | null {
  const key = ({ "1.0": "url_1x", "2.0": "url_2x", "3.0": "url_4x" } as Record<string, string>)[
    scale
  ];
  const url = key ? string(record(row.images)[key]) : "";
  return validTwitchUrl(url) ? url : null;
}

export function normalizeTwitch(data: unknown): ChannelEmote[] {
  const response = record(data);
  const template = string(response.template);
  if (!template.startsWith("https://static-cdn.jtvnw.net/"))
    throw new Error("Twitch CDN template is invalid");
  return items(response.data).flatMap((value) => {
    const row = record(value);
    const id = string(row.id);
    const name = string(row.name);
    if (!/^[a-zA-Z0-9_-]+$/.test(id) || !name) return [];
    const formats = items(row.format);
    const themes = items(row.theme_mode);
    const scales = twitchScales(row.scale);
    const theme = themes.includes("dark") ? "dark" : themes.includes("light") ? "light" : null;
    if (!theme || !scales.length) return [];
    const previewScale = scales[0];
    const sourceScale = scales[scales.length - 1];
    let animated = false;
    let previewUrl: string | null = null;
    let sourceUrl: string | null = null;
    if (formats.includes("animated")) {
      previewUrl = twitchUrl(template, id, "animated", theme, previewScale);
      sourceUrl = twitchUrl(template, id, "animated", theme, sourceScale);
      animated = Boolean(previewUrl && sourceUrl);
    }
    if (!animated && formats.includes("static")) {
      previewUrl =
        twitchUrl(template, id, "static", theme, previewScale) ??
        twitchStaticImage(row, previewScale);
      sourceUrl =
        twitchUrl(template, id, "static", theme, sourceScale) ??
        twitchStaticImage(row, sourceScale);
    }
    if (!previewUrl || !sourceUrl) return [];
    return [
      {
        id,
        provider: "twitch" as const,
        name,
        animated,
        previewUrl,
        sourceUrl
      }
    ];
  });
}

type SevenFile = { name: string; width: number; height: number };
function sevenFile(value: unknown): SevenFile | null {
  const row = record(value);
  const name = string(row.name);
  if (!/^\d+x\.webp$/i.test(name)) return null;
  return { name, width: Number(row.width) || 0, height: Number(row.height) || 0 };
}

function sevenEmote(value: unknown, nameOverride?: string): ChannelEmote | null {
  const row = record(value);
  const data = record(row.data && typeof row.data === "object" ? row.data : row);
  const id = string(row.id || data.id);
  const name = nameOverride || string(row.name || data.name);
  const host = record(data.host);
  const files = items(host.files)
    .map(sevenFile)
    .filter((file): file is SevenFile => Boolean(file))
    .sort((a, b) => a.width - b.width);
  if (!id || !name || !files.length) return null;
  const hostUrl = string(host.url);
  if (!/^\/\/cdn\.7tv\.app\/emote\/[a-zA-Z0-9]+$/.test(hostUrl)) return null;
  const preview = files.find((file) => file.name.startsWith("1x.")) ?? files[0];
  const source = files.find((file) => file.name.startsWith("4x.")) ?? files.at(-1)!;
  const base = `https:${hostUrl}`;
  return {
    id,
    provider: "7tv",
    name,
    animated: data.animated === true,
    previewUrl: `${base}/${preview.name}`,
    sourceUrl: `${base}/${source.name}`,
    width: source.width || undefined,
    height: source.height || undefined
  };
}

export function normalizeSevenTv(data: unknown): ChannelEmote[] {
  const root = record(data);
  const set = record(root.emote_set);
  return items(set.emotes).flatMap((value) => {
    const row = record(value);
    const emote = sevenEmote(row, string(row.name));
    return emote ? [emote] : [];
  });
}

async function cached(
  key: string,
  load: () => Promise<ChannelEmote[]>,
  refresh = false
): Promise<ChannelEmote[]> {
  const existing = cache.get(key);
  if (!refresh && existing && existing.expires > Date.now()) return existing.items;
  const result = await load();
  cache.set(key, { items: result, expires: Date.now() + ttlMs });
  return result;
}

export function clearEmoteCache(streamerId: string): void {
  cache.delete(`${streamerId}:twitch`);
  cache.delete(`${streamerId}:7tv`);
}

function customToEmote(row: CustomEmote): ChannelEmote {
  return {
    id: row.id,
    provider: "custom",
    name: row.name,
    animated: row.animated,
    previewUrl: row.previewUrl,
    sourceUrl: row.sourceUrl,
    width: row.width ?? undefined,
    height: row.height ?? undefined
  };
}

export async function getChannelEmotes(
  streamer: Streamer,
  refresh = false
): Promise<ChannelEmotesResponse> {
  const errors: ChannelEmotesResponse["errors"] = {};
  const [twitchResult, sevenResult, custom] = await Promise.all([
    cached(
      `${streamer.id}:twitch`,
      async () =>
        normalizeTwitch(
          await twitchApi(`chat/emotes?broadcaster_id=${await broadcasterId(streamer)}`)
        ),
      refresh
    ).catch((error: Error) => {
      errors.twitch = error.message;
      return [];
    }),
    cached(
      `${streamer.id}:7tv`,
      async () =>
        normalizeSevenTv(
          await getJson(
            `https://7tv.io/v3/users/twitch/${encodeURIComponent(await broadcasterId(streamer))}`
          )
        ),
      refresh
    ).catch((error: Error) => {
      errors.sevenTv = error.message;
      return [];
    }),
    prisma.customEmote.findMany({
      where: { streamerId: streamer.id },
      orderBy: { createdAt: "desc" }
    })
  ]);
  return { twitch: twitchResult, sevenTv: sevenResult, custom: custom.map(customToEmote), errors };
}

export async function resolveEmote(
  streamerId: string,
  provider: EmoteProviderName,
  id: string
): Promise<ChannelEmote> {
  if (provider === "custom") {
    const row = await prisma.customEmote.findFirst({ where: { id, streamerId } });
    if (!row) throw new Error("Emote not found");
    return customToEmote(row);
  }
  const streamer = await prisma.streamer.findUniqueOrThrow({ where: { id: streamerId } });
  const result = await getChannelEmotes(streamer);
  const emote = (provider === "twitch" ? result.twitch : result.sevenTv).find(
    (item) => item.id === id
  );
  if (!emote) throw new Error("Emote not found");
  return emote;
}

export async function createCustomEmote(
  streamerId: string,
  userId: string,
  input: { url: string; name?: string }
): Promise<ChannelEmote> {
  const url = new URL(input.url);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    !url.hostname.includes(".")
  )
    throw new Error("Use a public HTTPS image URL");
  const match =
    url.hostname === "7tv.app" ? /^\/emotes\/([a-zA-Z0-9]{20,32})\/?$/.exec(url.pathname) : null;
  let emote: ChannelEmote;
  if (match) {
    const row = record(await getJson(`https://7tv.io/v3/emotes/${match[1]}`));
    const normalized = sevenEmote(row);
    if (!normalized) throw new Error("7TV emote has no supported WebP image");
    emote = normalized;
  } else {
    if (
      !/\.(png|jpe?g|gif|webp)(?:$)/i.test(url.pathname) ||
      /^(localhost|.*\.localhost)$/i.test(url.hostname) ||
      /^\d+\.\d+\.\d+\.\d+$/.test(url.hostname)
    )
      throw new Error("Use a direct public HTTPS PNG, JPEG, GIF, or WebP URL");
    const name =
      input.name ||
      decodeURIComponent(url.pathname.split("/").pop() || "Custom emote").slice(0, 80);
    emote = {
      id: "",
      provider: "custom",
      name,
      animated: /\.gif$/i.test(url.pathname),
      sourceUrl: url.href,
      previewUrl: url.href
    };
  }
  const row = await prisma.customEmote.create({
    data: {
      streamerId,
      createdById: userId,
      provider: emote.provider,
      externalId: match?.[1],
      name: input.name || emote.name,
      sourceUrl: emote.sourceUrl,
      previewUrl: emote.previewUrl,
      animated: emote.animated,
      width: emote.width,
      height: emote.height
    }
  });
  return customToEmote(row);
}
