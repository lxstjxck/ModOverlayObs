import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { execFile } from "node:child_process";
import crypto from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { expect, it } from "vitest";

const run = promisify(execFile);

it("backs up data, resets only the legacy owner password, and revokes their sessions", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "modoverlay-owner-reset-"));
  const database = path.join(directory, "test.db");
  const prisma = new PrismaClient({ datasourceUrl: `file:${database.replaceAll("\\", "/")}` });
  let backup: string | undefined;
  try {
    await prisma.$executeRawUnsafe(
      'CREATE TABLE "User" ("id" TEXT PRIMARY KEY, "username" TEXT NOT NULL, "passwordHash" TEXT NOT NULL, "role" TEXT NOT NULL, "twitchUserId" TEXT, "updatedAt" DATETIME NOT NULL)'
    );
    await prisma.$executeRawUnsafe(
      'CREATE TABLE "Session" ("id" TEXT PRIMARY KEY, "userId" TEXT NOT NULL)'
    );
    await prisma.$executeRawUnsafe(
      'CREATE TABLE "Streamer" ("id" TEXT PRIMARY KEY, "overlayToken" TEXT NOT NULL)'
    );
    await prisma.$executeRawUnsafe(
      'CREATE TABLE "Media" ("id" TEXT PRIMARY KEY, "filename" TEXT NOT NULL)'
    );
    const oldHash = await bcrypt.hash("old-password-for-test", 4);
    await prisma.$executeRawUnsafe(
      'INSERT INTO "User" ("id", "username", "passwordHash", "role", "updatedAt") VALUES (?, ?, ?, ?, ?)',
      "owner-id",
      "owner",
      oldHash,
      "OWNER",
      new Date()
    );
    await prisma.$executeRawUnsafe(
      'INSERT INTO "User" ("id", "username", "passwordHash", "role", "updatedAt") VALUES (?, ?, ?, ?, ?)',
      "other-id",
      "other",
      oldHash,
      "MODERATOR",
      new Date()
    );
    await prisma.$executeRawUnsafe(
      'INSERT INTO "Session" ("id", "userId") VALUES (?, ?)',
      "s1",
      "owner-id"
    );
    await prisma.$executeRawUnsafe(
      'INSERT INTO "Session" ("id", "userId") VALUES (?, ?)',
      "s2",
      "other-id"
    );
    await prisma.$executeRawUnsafe(
      'INSERT INTO "Streamer" ("id", "overlayToken") VALUES (?, ?)',
      "c1",
      "existing-obs-token"
    );
    await prisma.$executeRawUnsafe(
      'INSERT INTO "Media" ("id", "filename") VALUES (?, ?)',
      "m1",
      "existing-media.png"
    );

    const script = path.resolve("scripts/reset-legacy-owner-password.mjs");
    const dry = await run(process.execPath, [script, "--database", database]);
    expect(JSON.parse(dry.stdout)).toMatchObject({ username: "owner", changed: false });
    await expect(
      run(process.execPath, [script, "--database", database, "--apply"], {
        env: { ...process.env, OWNER_RESET_PASSWORD: "short" }
      })
    ).rejects.toThrow("Set OWNER_RESET_PASSWORD");
    expect(
      await prisma.$queryRawUnsafe('SELECT "passwordHash" FROM "User" WHERE "id" = ?', "owner-id")
    ).toEqual([{ passwordHash: oldHash }]);
    const newPassword = crypto.randomBytes(24).toString("base64url");
    const applied = await run(process.execPath, [script, "--database", database, "--apply"], {
      env: { ...process.env, OWNER_RESET_PASSWORD: newPassword }
    });
    backup = JSON.parse(applied.stdout).backup;
    const users = await prisma.$queryRawUnsafe<Array<{ id: string; passwordHash: string }>>(
      'SELECT "id", "passwordHash" FROM "User" ORDER BY "id"'
    );
    expect(users.find((user) => user.id === "owner-id")?.passwordHash).not.toBe(oldHash);
    expect(
      await bcrypt.compare(newPassword, users.find((user) => user.id === "owner-id")!.passwordHash)
    ).toBe(true);
    expect(users.find((user) => user.id === "other-id")?.passwordHash).toBe(oldHash);
    expect(await prisma.$queryRawUnsafe('SELECT "id", "userId" FROM "Session"')).toEqual([
      { id: "s2", userId: "other-id" }
    ]);
    expect(await prisma.$queryRawUnsafe('SELECT "overlayToken" FROM "Streamer"')).toEqual([
      { overlayToken: "existing-obs-token" }
    ]);
    expect(await prisma.$queryRawUnsafe('SELECT "filename" FROM "Media"')).toEqual([
      { filename: "existing-media.png" }
    ]);
  } finally {
    await prisma.$disconnect();
    if (backup && path.resolve(backup).startsWith(path.resolve("backups") + path.sep)) {
      await rm(backup);
    }
    await rm(directory, { recursive: true, force: true });
  }
});
