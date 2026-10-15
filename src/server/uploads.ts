import type { MediaType } from "@prisma/client";
import type { Request, RequestHandler } from "express";
import multer from "multer";
import crypto from "node:crypto";
import { constants } from "node:fs";
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
const multerTemporaryName = /^[a-f0-9]{32}$/;
const staleAfterMs = 24 * 60 * 60_000;
const maxCleanupFiles = 100;
const activeTemporaryNames = new Set<string>();
const requestTemporaryNames = new WeakMap<Request, string>();
let pendingCommit: Promise<unknown> = Promise.resolve();

// Avoid SQLite lock contention within this process. The DB transaction remains
// responsible for enforcing the quota atomically.
export function withUploadCommit<T>(action: () => Promise<T>): Promise<T> {
  const result = pendingCommit.then(action);
  pendingCommit = result.catch(() => undefined);
  return result;
}

const multerMiddleware = multer({
  storage: multer.diskStorage({
    destination: tmpDir,
    filename: (request, _file, callback) => {
      const name = crypto.randomBytes(16).toString("hex");
      activeTemporaryNames.add(name);
      requestTemporaryNames.set(request, name);
      callback(null, name);
    }
  }),
  limits: {
    fileSize: config.maxVideoSize,
    files: 1
  }
});

export const uploadMiddleware: { single: (field: string) => RequestHandler } = {
  single(field) {
    const middleware = multerMiddleware.single(field);
    return (request, response, next) => {
      let middlewareDone = false;
      let responseDone = false;
      const release = () => {
        if (!middlewareDone || !responseDone) return;
        response.off("finish", responseEnded);
        response.off("close", responseEnded);
        const name = requestTemporaryNames.get(request);
        if (name) {
          activeTemporaryNames.delete(name);
          requestTemporaryNames.delete(request);
        }
      };
      const responseEnded = () => {
        responseDone = true;
        release();
      };
      response.once("finish", responseEnded);
      response.once("close", responseEnded);
      middleware(request, response, (error) => {
        middlewareDone = true;
        release();
        next(error);
      });
    };
  }
};

// Multer 2.4 handles interrupted requests. This also recovers files left by a
// process crash, including files created by the former Multer disk storage.
export async function cleanupStaleUploadFiles(now = Date.now()): Promise<number> {
  try {
    const root = await fs.lstat(config.uploadDir);
    const directory = await fs.lstat(tmpDir);
    if (!root.isDirectory() || root.isSymbolicLink() ||
        !directory.isDirectory() || directory.isSymbolicLink()) return 0;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return 0;
    throw error;
  }

  let removed = 0;
  const entries = await fs.readdir(tmpDir);
  for (const name of entries) {
    if (removed >= maxCleanupFiles) break;
    if (!multerTemporaryName.test(name) || activeTemporaryNames.has(name)) continue;
    const filePath = path.join(tmpDir, name);
    try {
      const stats = await fs.lstat(filePath);
      if (!stats.isFile() || stats.isSymbolicLink() || now - stats.mtimeMs < staleAfterMs) continue;
      // O_NOFOLLOW protects platforms that support it; lstat and unlink never
      // follow a file symlink on platforms where it is unavailable.
      const handle = await fs.open(filePath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      try {
        const current = await handle.stat();
        if (current.ino !== stats.ino || current.dev !== stats.dev || now - current.mtimeMs < staleAfterMs) continue;
        await fs.unlink(filePath);
        removed++;
      } finally {
        await handle.close();
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        console.warn("Temporary upload cleanup skipped a file", error);
      }
    }
  }
  return removed;
}

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
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}
