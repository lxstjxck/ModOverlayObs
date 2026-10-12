import type { MediaItem } from "../shared/types";
import { getYouTubeVideoId } from "../shared/mediaUrl";

export interface MediaDimensions {
  width: number;
  height: number;
}

/** Keep the source intact; only choose a usable initial size for its canvas element. */
export function fitInitialMediaDimensions(
  dimensions: MediaDimensions,
  canvasWidth: number,
  canvasHeight: number
): MediaDimensions {
  // SPAWN spans 30% of the canvas width; the existing server places new media
  // at x = -width - 56, so leave that offset and a small visible margin.
  const limitWidth = Math.max(8, canvasWidth * 0.3 - 64);
  const limitHeight = Math.max(8, canvasHeight * 0.48);
  const scale = Math.min(1, limitWidth / dimensions.width, limitHeight / dimensions.height);
  return {
    width: Math.round(dimensions.width * scale),
    height: Math.round(dimensions.height * scale)
  };
}

export async function readMediaDimensions(media: MediaItem): Promise<MediaDimensions | null> {
  if (media.type === "AUDIO") return null;
  if (getYouTubeVideoId(media.url)) return { width: 1920, height: 1080 };
  if (media.width && media.height) return { width: media.width, height: media.height };

  return new Promise((resolve, reject) => {
    const element = media.type === "VIDEO" ? document.createElement("video") : new Image();
    const timeout = window.setTimeout(
      () => finish(null, new Error("Не удалось определить размер медиа.")),
      10000
    );
    let done = false;
    function finish(size: MediaDimensions | null, error?: Error) {
      if (done) return;
      done = true;
      window.clearTimeout(timeout);
      element.removeAttribute("src");
      if (element instanceof HTMLVideoElement) element.load();
      if (error) reject(error);
      else resolve(size);
    }
    function loaded() {
      const width = element instanceof HTMLVideoElement ? element.videoWidth : element.naturalWidth;
      const height =
        element instanceof HTMLVideoElement ? element.videoHeight : element.naturalHeight;
      if (!width || !height || width > 10000 || height > 10000) {
        finish(null, new Error("Размер медиа вне допустимых пределов (1–10000 px)."));
        return;
      }
      finish({ width, height });
    }
    element.addEventListener(
      element instanceof HTMLVideoElement ? "loadedmetadata" : "load",
      loaded,
      { once: true }
    );
    element.addEventListener(
      "error",
      () => finish(null, new Error("Не удалось загрузить медиа для определения размера.")),
      { once: true }
    );
    if (element instanceof HTMLVideoElement) element.preload = "metadata";
    element.src = media.url;
  });
}
