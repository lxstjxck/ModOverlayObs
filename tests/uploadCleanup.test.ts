import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, expect, it, vi } from "vitest";

const fixture = await vi.hoisted(async () => {
  const fs = await import("node:fs/promises");
  const os = await import("node:os");
  const path = await import("node:path");
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "modoverlay-upload-clean-"));
  return { root };
});

vi.mock("../src/server/config", () => ({
  config: { uploadDir: fixture.root }
}));

import { cleanupStaleUploadFiles } from "../src/server/uploads";

const tmpDir = path.join(fixture.root, ".tmp");
const now = Date.now();
const old = new Date(now - 25 * 60 * 60_000);

afterAll(async () => {
  const resolved = await fs.realpath(fixture.root);
  if (!resolved.startsWith(path.join(os.tmpdir(), "modoverlay-upload-clean-"))) {
    throw new Error("Refusing to remove a directory outside the upload test fixture");
  }
  await fs.rm(resolved, { recursive: true });
});

it("removes only old Multer temporary files and can run twice", async () => {
  await fs.mkdir(tmpDir, { recursive: true });
  const stale = "a".repeat(32);
  const recent = "b".repeat(32);
  const tts = `tts-${"A".repeat(43)}.wav`;
  const unrelated = "keep.txt";
  const outside = path.join(fixture.root, "c".repeat(32));
  for (const name of [stale, recent, tts, unrelated]) {
    await fs.writeFile(path.join(tmpDir, name), "test");
  }
  await fs.writeFile(outside, "keep");
  for (const name of [stale, tts, unrelated]) {
    await fs.utimes(path.join(tmpDir, name), old, old);
  }
  await fs.utimes(outside, old, old);

  expect(await cleanupStaleUploadFiles(now)).toBe(1);
  expect(await cleanupStaleUploadFiles(now)).toBe(0);
  expect((await fs.readdir(tmpDir)).sort()).toEqual([recent, tts, unrelated].sort());
  expect(await fs.readFile(outside, "utf8")).toBe("keep");
});

it("does not follow a symlink used as the temporary directory", async () => {
  const linkedRoot = await fs.mkdtemp(path.join(os.tmpdir(), "modoverlay-upload-clean-"));
  try {
    const target = path.join(linkedRoot, "target");
    await fs.mkdir(target);
    const file = path.join(target, "d".repeat(32));
    await fs.writeFile(file, "keep");
    await fs.utimes(file, old, old);
    // This fixture uses the same configured root, then swaps only its .tmp entry.
    await fs.rename(tmpDir, path.join(fixture.root, "previous-tmp"));
    await fs.symlink(target, tmpDir, process.platform === "win32" ? "junction" : "dir");
    expect(await cleanupStaleUploadFiles(now)).toBe(0);
    expect(await fs.readFile(file, "utf8")).toBe("keep");
  } finally {
    await fs.unlink(tmpDir);
    await fs.rename(path.join(fixture.root, "previous-tmp"), tmpDir);
    await fs.rm(linkedRoot, { recursive: true });
  }
});

it.skipIf(process.platform === "win32")("does not remove a file symlink", async () => {
  const outside = path.join(fixture.root, "protected.txt");
  const link = path.join(tmpDir, "e".repeat(32));
  await fs.writeFile(outside, "keep");
  await fs.utimes(outside, old, old);
  await fs.symlink(outside, link);
  expect(await cleanupStaleUploadFiles(now)).toBe(0);
  expect(await fs.lstat(link).then((stat) => stat.isSymbolicLink())).toBe(true);
  expect(await fs.readFile(outside, "utf8")).toBe("keep");
});

it("limits each cleanup pass to 100 files", async () => {
  for (let index = 0; index < 101; index++) {
    const file = path.join(tmpDir, index.toString(16).padStart(32, "0"));
    await fs.writeFile(file, "old");
    await fs.utimes(file, old, old);
  }
  expect(await cleanupStaleUploadFiles(now)).toBe(100);
  expect((await fs.readdir(tmpDir)).filter((name) => /^[a-f0-9]{32}$/.test(name))).toHaveLength(2);
  expect(await cleanupStaleUploadFiles(now)).toBe(1);
});
