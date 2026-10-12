import { PrismaClient } from "@prisma/client";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const version = "20261012_twitch_oauth_stage1";
const args = process.argv.slice(2);
if (
  args.length !== 3 ||
  args[0] !== "--database" ||
  args[2] !== "--apply" ||
  !path.isAbsolute(args[1])
) {
  throw new Error(
    "Usage: node scripts/apply-twitch-oauth-migration.mjs --database <absolute existing SQLite path> --apply"
  );
}
const databasePath = path.resolve(args[1]);
if (!(await stat(databasePath)).isFile()) throw new Error("Database path is not a file");
const prisma = new PrismaClient({ datasourceUrl: `file:${databasePath.replaceAll("\\", "/")}` });
try {
  const attached = await prisma.$queryRawUnsafe("PRAGMA database_list");
  if (attached.length !== 1 || path.resolve(attached[0].file) !== databasePath) {
    throw new Error(
      "Refusing migration: connected SQLite path differs from explicit database path"
    );
  }
  const sqlPath = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../prisma/migrations",
    version,
    "migration.sql"
  );
  const sql = (await readFile(sqlPath, "utf8")).replace(/^--.*$/gm, "");
  const statements = sql
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean);
  const result = await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(
      'CREATE TABLE IF NOT EXISTS "SchemaMigration" ("version" TEXT NOT NULL PRIMARY KEY, "appliedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)'
    );
    const applied = await tx.$queryRawUnsafe(
      'SELECT "version" FROM "SchemaMigration" WHERE "version" = ?',
      version
    );
    if (applied.length) return "already applied";
    const oldSchema = await tx.$queryRawUnsafe('PRAGMA table_info("User")');
    if (oldSchema.some((column) => column.name === "twitchUserId")) {
      throw new Error(
        "Twitch columns already exist without a migration journal entry; inspect this database manually"
      );
    }
    for (const statement of statements) await tx.$executeRawUnsafe(statement);
    await tx.$executeRawUnsafe('INSERT INTO "SchemaMigration" ("version") VALUES (?)', version);
    return "applied";
  });
  process.stdout.write(`Twitch OAuth migration ${result}: ${version}\n`);
} finally {
  await prisma.$disconnect();
}
