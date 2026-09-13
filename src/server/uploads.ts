import type { MediaType } from "@prisma/client";
import type { Request } from "express";
import multer from "multer";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { config } from "./config";
import { detectSignature } from "./utils/magic";

export interface ValidatedUpload {
  type: MediaType;
  filename: string;
  url: string;
  size: number;
  mimeType: string;
  originalName: string;
  finalPath: string;
}

const tmpDir = path.join(config.uploadDir, ".tmp");

export const uploadMiddleware = multer({
  dest: tmpDir,
  limits: {
    fileSize: config.maxVideoSize,
    files: 1
  }
});

export async function validateAndStoreUpload(file: Express.Multer.File): Promise<ValidatedUpload> {
  const head = await readHead(file.path);
  const signature = detectSignature(head, file.originalname, file.mimetype);
  if (!signature.ok || !signature.type || !signature.normalizedExtension) {
    await safeUnlink(file.path);
    throw new Error(signature.reason ?? "File type is not allowed");
  }

  const maxSize = getMaxSize(signature.type);
  if (file.size > maxSize) {
    await safeUnlink(file.path);
    throw new Error("File is larger than the configured limit");
  }

  const filename = `${crypto.randomUUID()}${signature.normalizedExtension}`;
  const finalPath = path.join(config.uploadDir, filename);
  await fs.rename(file.path, finalPath);

  return {
    type: signature.type,
    filename,
    url: `/uploads/${filename}`,
    size: file.size,
    mimeType: file.mimetype,
    originalName: file.originalname,
    finalPath
  };
}

export async function deleteStoredUpload(filename: string): Promise<void> {
  const resolved = path.resolve(config.uploadDir, filename);
  const uploadRoot = path.resolve(config.uploadDir);
  const relative = path.relative(uploadRoot, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return;
  }
  await safeUnlink(resolved);
}

export function uploadErrorHandler(error: unknown, _request: Request): string {
  if (error instanceof multer.MulterError) {
    return error.code === "LIMIT_FILE_SIZE" ? "File is too large" : error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "Upload failed";
}

function getMaxSize(type: MediaType): number {
  if (type === "VIDEO") {
    return config.maxVideoSize;
  }
  if (type === "AUDIO") {
    return config.maxAudioSize;
  }
  if (type === "GIF") {
    return config.maxGifSize;
  }
  return config.maxImageSize;
}

async function readHead(filePath: string): Promise<Buffer> {
  const handle = await fs.open(filePath, "r");
  try {
    const buffer = Buffer.alloc(16);
    const result = await handle.read(buffer, 0, buffer.length, 0);
    return buffer.subarray(0, result.bytesRead);
  } finally {
    await handle.close();
  }
}

async function safeUnlink(filePath: string): Promise<void> {
  try {
    await fs.unlink(filePath);
  } catch {
    // File is already gone.
  }
}
