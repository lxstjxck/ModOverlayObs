import bcrypt from "bcryptjs";
import { execFile } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import dotenv from "dotenv";
import { realpath, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

dotenv.config({ quiet: true });
const args = process.argv.slice(2);
if (
  ![2, 3].includes(args.length) ||
  args[0] !== "--database" ||
  !path.isAbsolute(args[1]) ||
  (args.length === 3 && args[2] !== "--apply")
) {
  throw new Error(
    "Usage: node scripts/reset-legacy-owner-password.mjs --database <absolute SQLite path> [--apply]"
  );
}

const database = await realpath(args[1]);
if (!(await stat(database)).isFile()) throw new Error("Database path is not a file");
const prisma = new PrismaClient({ datasourceUrl: `file:${database.replaceAll("\\", "/")}` });
try {
  const attached = await prisma.$queryRawUnsafe("PRAGMA database_list");
  if (attached.length !== 1 || path.resolve(attached[0].file) !== database) {
    throw new Error("Connected SQLite path differs from requested database");
  }
  const owners = await prisma.user.findMany({
    where: { role: "OWNER", twitchUserId: null },
    select: { id: true, username: true }
  });
  if (owners.length !== 1) throw new Error("Expected exactly one legacy OWNER account");
  const owner = owners[0];
  if (args.length === 2) {
    console.log(JSON.stringify({ username: owner.username, ready: true, changed: false }));
  } else {
    const password = process.env.OWNER_RESET_PASSWORD;
    if (!password || password.trim().length < 12 || password.trim() === "change-me-now") {
      throw new Error("Set OWNER_RESET_PASSWORD to a unique password of at least 12 characters");
    }
    const run = promisify(execFile);
    const backupScript = path.resolve("scripts/backup-sqlite.mjs");
    const backup = await run(process.execPath, [backupScript, database]);
    const { backup: backupPath } = JSON.parse(backup.stdout);
    const passwordHash = await bcrypt.hash(password, 12);
    await prisma.$transaction(async (tx) => {
      const updated = await tx.user.updateMany({
        where: { id: owner.id, role: "OWNER", twitchUserId: null },
        data: { passwordHash }
      });
      if (updated.count !== 1) throw new Error("Legacy OWNER account changed during reset");
      await tx.session.deleteMany({ where: { userId: owner.id } });
    });
    console.log(JSON.stringify({ username: owner.username, changed: true, backup: backupPath }));
  }
} finally {
  await prisma.$disconnect();
}
