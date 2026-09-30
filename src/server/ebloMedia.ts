import { detectMediaTypeFromUrl, getEbloPostId } from "../shared/mediaUrl";
import type { MediaType } from "../shared/types";

const maxPageBytes = 256_000;

export interface EbloMedia {
  url: string;
  type: MediaType;
}

export function parseEbloMediaPage(html: string, postId: string): EbloMedia | null {
  const mediaType = /<body\b[^>]*\bdata-media-type="([^"]+)"/i.exec(html)?.[1];
  const tag =
    mediaType === "image"
      ? /<img\b[^>]*\bid="preview-image"[^>]*>/i.exec(html)?.[0]
      : mediaType === "video"
        ? /<div\b[^>]*\bid="preview-video"[^>]*>/i.exec(html)?.[0]
        : mediaType === "audio"
          ? /<(?:audio|div)\b[^>]*\bid="preview-audio"[^>]*>/i.exec(html)?.[0]
          : undefined;
  const sourceAttribute = mediaType === "video" || tag?.startsWith("<div") ? "data-src" : "src";
  const source = tag && new RegExp(`\\b${sourceAttribute}="([^"]+)"`, "i").exec(tag)?.[1];
  if (!source || source.includes("&")) return null;

  const url = new URL(source, "https://eblo.id");
  if (
    url.origin !== "https://eblo.id" ||
    !url.pathname.startsWith(`/uploads/${postId}/`) ||
    url.search ||
    url.hash
  )
    return null;
  const type = detectMediaTypeFromUrl(url.href);
  if (!type) return null;
  if (mediaType === "image" && type !== "IMAGE" && type !== "GIF") return null;
  if (mediaType === "video" && type !== "VIDEO") return null;
  if (mediaType === "audio" && type !== "AUDIO") return null;
  return { url: url.href, type };
}

export async function resolveEbloMedia(postUrl: string): Promise<EbloMedia | null> {
  const postId = getEbloPostId(postUrl);
  if (!postId) return null;
  const response = await fetch(`https://eblo.id/${postId}`, {
    redirect: "manual",
    signal: AbortSignal.timeout(8000),
    headers: { Accept: "text/html" }
  });
  if (!response.ok || !response.headers.get("content-type")?.includes("text/html")) return null;
  const reader = response.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxPageBytes) return null;
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  return parseEbloMediaPage(Buffer.concat(chunks).toString("utf8"), postId);
}
