import path from "node:path";

export type DetectedUploadKind = "IMAGE" | "GIF" | "VIDEO" | "AUDIO";

export interface SignatureResult {
  ok: boolean;
  type?: DetectedUploadKind;
  normalizedExtension?: string;
  reason?: string;
}

const extensionToType: Record<string, DetectedUploadKind> = {
  ".png": "IMAGE",
  ".jpg": "IMAGE",
  ".jpeg": "IMAGE",
  ".webp": "IMAGE",
  ".gif": "GIF",
  ".mp4": "VIDEO",
  ".webm": "VIDEO",
  ".mp3": "AUDIO",
  ".wav": "AUDIO",
  ".ogg": "AUDIO"
};

const mimeToType: Record<string, DetectedUploadKind> = {
  "image/png": "IMAGE",
  "image/jpeg": "IMAGE",
  "image/webp": "IMAGE",
  "image/gif": "GIF",
  "video/mp4": "VIDEO",
  "video/webm": "VIDEO",
  "audio/mpeg": "AUDIO",
  "audio/mp3": "AUDIO",
  "audio/wav": "AUDIO",
  "audio/x-wav": "AUDIO",
  "audio/ogg": "AUDIO"
};

export function detectSignature(buffer: Buffer, originalName: string, mimeType: string): SignatureResult {
  const extension = path.extname(originalName).toLowerCase();
  const extensionType = extensionToType[extension];
  const mimeTypeKind = mimeToType[mimeType.toLowerCase()];
  if (!extensionType || !mimeTypeKind) {
    return { ok: false, reason: "Unsupported extension or MIME type" };
  }
  if (extensionType !== mimeTypeKind) {
    return { ok: false, reason: "File extension does not match MIME type" };
  }

  const magicKind = detectMagicKind(buffer);
  if (!magicKind) {
    return { ok: false, reason: "File signature is not allowed" };
  }
  if (magicKind !== extensionType) {
    return { ok: false, reason: "File signature does not match declared type" };
  }

  return {
    ok: true,
    type: magicKind,
    normalizedExtension: extension === ".jpeg" ? ".jpg" : extension
  };
}

function detectMagicKind(buffer: Buffer): DetectedUploadKind | null {
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  ) {
    return "IMAGE";
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "IMAGE";
  }
  if (
    buffer.length >= 12 &&
    buffer.toString("ascii", 0, 4) === "RIFF" &&
    buffer.toString("ascii", 8, 12) === "WEBP"
  ) {
    return "IMAGE";
  }
  if (
    buffer.length >= 12 &&
    buffer.toString("ascii", 0, 4) === "RIFF" &&
    buffer.toString("ascii", 8, 12) === "WAVE"
  ) {
    return "AUDIO";
  }
  if (
    buffer.length >= 6 &&
    (buffer.toString("ascii", 0, 6) === "GIF87a" || buffer.toString("ascii", 0, 6) === "GIF89a")
  ) {
    return "GIF";
  }
  if (buffer.length >= 3 && buffer.toString("ascii", 0, 3) === "ID3") {
    return "AUDIO";
  }
  if (buffer.length >= 2 && buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0) {
    return "AUDIO";
  }
  if (buffer.length >= 4 && buffer.toString("ascii", 0, 4) === "OggS") {
    return "AUDIO";
  }
  if (buffer.length >= 12 && buffer.toString("ascii", 4, 8) === "ftyp") {
    return "VIDEO";
  }
  if (
    buffer.length >= 4 &&
    buffer[0] === 0x1a &&
    buffer[1] === 0x45 &&
    buffer[2] === 0xdf &&
    buffer[3] === 0xa3
  ) {
    return "VIDEO";
  }
  return null;
}
