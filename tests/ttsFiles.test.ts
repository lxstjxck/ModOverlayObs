import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { cleanupStaleTtsFiles } from "../src/server/ttsFiles";

const directories: string[] = [];

afterEach(async () => {
  for (const directory of directories.splice(0)) {
    const resolved = await fs.realpath(directory);
    if (!resolved.startsWith(path.join(os.tmpdir(), "modoverlay-tts-clean-"))) {
      throw new Error("Refusing to remove a directory outside the TTS test fixture");
    }
    await fs.rm(resolved, { recursive: true });
  }
});

it("removes only old TTS WAV files from the temporary directory", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "modoverlay-tts-clean-"));
  directories.push(directory);
  const id = "A".repeat(43);
  const stale = `tts-${id}.wav`;
  const recent = `tts-${"B".repeat(43)}.wav`;
  const unrelated = "uploaded-image.png";
  for (const name of [stale, recent, unrelated]) {
    await fs.writeFile(path.join(directory, name), "test");
  }
  const now = Date.now();
  const oldDate = new Date(now - 11 * 60_000);
  await fs.utimes(path.join(directory, stale), oldDate, oldDate);
  await fs.utimes(path.join(directory, unrelated), oldDate, oldDate);

  await cleanupStaleTtsFiles(directory, now);

  expect((await fs.readdir(directory)).sort()).toEqual([recent, unrelated].sort());
});
