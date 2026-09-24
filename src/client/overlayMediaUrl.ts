export function overlayMediaUrl(
  src: string | null | undefined,
  token: string
): string | null | undefined {
  // Only generated upload paths receive credentials, never remote URLs.
  if (!src || !/^\/uploads\/[a-zA-Z0-9-]+\.[a-zA-Z0-9]+$/.test(src)) return src;
  return `${src}?overlayToken=${encodeURIComponent(token)}`;
}
