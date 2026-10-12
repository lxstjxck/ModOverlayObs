import { PrismaClient } from "@prisma/client";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { expect, it } from "vitest";

const run = promisify(execFile);

it("reconciles a partially present OAuth migration without changing existing rows or recording false history", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "modoverlay-migration-"));
  if (
    !path.isAbsolute(directory) ||
    !path.basename(directory).startsWith("modoverlay-migration-")
  ) {
    throw new Error("Unsafe test directory");
  }
  const database = path.join(directory, "test.db");
  const prisma = new PrismaClient({ datasourceUrl: `file:${database.replaceAll("\\", "/")}` });
  try {
    await prisma.$executeRawUnsafe(
      'CREATE TABLE "User" ("id" TEXT PRIMARY KEY, "username" TEXT NOT NULL, "twitchUserId" TEXT)'
    );
    await prisma.$executeRawUnsafe(
      'CREATE TABLE "Session" ("id" TEXT PRIMARY KEY, "userId" TEXT NOT NULL)'
    );
    await prisma.$executeRawUnsafe(
      'CREATE TABLE "Streamer" ("id" TEXT PRIMARY KEY, "overlayToken" TEXT NOT NULL)'
    );
    await prisma.$executeRawUnsafe(
      'INSERT INTO "User" ("id", "username") VALUES (?, ?)',
      "existing-user",
      "owner"
    );
    await prisma.$executeRawUnsafe(
      'INSERT INTO "Streamer" ("id", "overlayToken") VALUES (?, ?)',
      "existing-channel",
      "existing-obs-token"
    );
    const script = path.resolve("scripts/reconcile-twitch-oauth-stage1.mjs");
    const dry = await run(process.execPath, [script, "--database", database]);
    expect(JSON.parse(dry.stdout).missing).toContain("TwitchOAuthState");
    expect(JSON.parse(dry.stdout).missing).toContain("User_twitchUserId_key");
    const applied = await run(process.execPath, [script, "--database", database, "--apply"]);
    expect(JSON.parse(applied.stdout).stageOneComplete).toBe(true);
    const again = await run(process.execPath, [script, "--database", database, "--apply"]);
    expect(JSON.parse(again.stdout).added).toEqual([]);
    const user = await prisma.$queryRawUnsafe<Array<{ id: string; username: string }>>(
      'SELECT "id", "username" FROM "User"'
    );
    const channel = await prisma.$queryRawUnsafe<Array<{ id: string; overlayToken: string }>>(
      'SELECT "id", "overlayToken" FROM "Streamer"'
    );
    expect(user).toEqual([{ id: "existing-user", username: "owner" }]);
    expect(channel).toEqual([{ id: "existing-channel", overlayToken: "existing-obs-token" }]);
    const tables = await prisma.$queryRawUnsafe<Array<{ name: string }>>(
      "SELECT name FROM sqlite_master WHERE type = 'table'"
    );
    expect(tables.map((table) => table.name)).toContain("TwitchOAuthConnection");
    expect(tables.map((table) => table.name)).not.toContain("_prisma_migrations");
  } finally {
    await prisma.$disconnect();
    await rm(directory, { recursive: true, force: true });
  }
});
