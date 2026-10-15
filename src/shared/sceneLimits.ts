// These bounds keep a full Socket.IO snapshot small enough for OBS Browser Source.
// Server deployments may lower them with environment variables before startup.
function positiveInteger(name: string, fallback: number, maximum: number): number {
  const value = typeof process === "undefined" ? NaN : Number(process.env[name]);
  return Number.isSafeInteger(value) && value > 0 && value <= maximum ? value : fallback;
}

export const sceneLimits = Object.freeze({
  previewElements: positiveInteger("SCENE_MAX_PREVIEW_ELEMENTS", 250, 500),
  liveInstances: positiveInteger("SCENE_MAX_LIVE_INSTANCES", 100, 200),
  propsBytes: 2048,
  elementBytes: positiveInteger("SCENE_MAX_ELEMENT_BYTES", 8192, 16384),
  previewBytes: positiveInteger("SCENE_MAX_PREVIEW_BYTES", 1024 * 1024, 2 * 1024 * 1024),
  liveBytes: positiveInteger("SCENE_MAX_LIVE_BYTES", 512 * 1024, 1024 * 1024)
});
