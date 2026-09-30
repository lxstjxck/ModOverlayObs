import fs from "node:fs/promises";
import path from "node:path";
import { config } from "./config";

const ttsWavName = /^tts-[A-Za-z0-9_-]{43}\.wav$/;
const staleAfterMs = 10 * 60_000;

export async function cleanupStaleTtsFiles(
  directory = path.join(config.uploadDir, ".tmp"),
  now = Date.now()
): Promise<void> {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile() || !ttsWavName.test(entry.name)) continue;
    const file = path.join(directory, entry.name);
    try {
      const stats = await fs.stat(file);
      if (now - stats.mtimeMs >= staleAfterMs) await fs.rm(file);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
}
