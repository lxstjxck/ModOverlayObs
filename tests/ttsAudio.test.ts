import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import express from "express";
import { expect, it } from "vitest";
import { sendTtsAudio } from "../src/server/tts";

it("serves only the active TTS WAV from the hidden temporary directory", async () => {
  const prefix = path.join(os.tmpdir(), "modoverlay-tts-audio-");
  const directory = await fs.mkdtemp(prefix);
  if (!path.resolve(directory).startsWith(path.resolve(prefix))) {
    throw new Error("Refusing to remove a directory outside the TTS test fixture");
  }
  const file = path.join(directory, ".tmp", "voice.wav");
  const id = crypto.randomBytes(32).toString("base64url");
  const wav = Buffer.from("RIFFtestWAVE");
  await fs.mkdir(path.dirname(file));
  await fs.writeFile(file, wav);

  const app = express();
  app.get("/api/tts/audio/:id", (request, response) =>
    sendTtsAudio(request, response, { id, file })
  );
  const server = app.listen(0);
  try {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Test server address missing");
    const baseUrl = `http://127.0.0.1:${address.port}/api/tts/audio/`;

    const wrongId = await fetch(`${baseUrl}${crypto.randomBytes(32).toString("base64url")}`);
    expect(wrongId.status).toBe(404);

    const response = await fetch(`${baseUrl}${id}`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("audio/wav");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(Buffer.from(await response.arrayBuffer())).toEqual(wav);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
    await fs.rm(directory, { recursive: true, force: true });
  }
});
