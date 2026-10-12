import { PrismaClient } from "@prisma/client";
import { readFile, realpath } from "node:fs/promises";
import path from "node:path";

const args = process.argv.slice(2);
if (
  args.length < 2 ||
  args.length > 3 ||
  args[0] !== "--database" ||
  !path.isAbsolute(args[1]) ||
  (args[2] && args[2] !== "--apply")
) {
  throw new Error(
    "Usage: node scripts/reconcile-twitch-oauth-stage1.mjs --database <absolute existing SQLite path> [--apply]"
  );
}
const database = await realpath(args[1]);
const apply = args[2] === "--apply";
const sql = await readFile(
  path.resolve("prisma/migrations/20261012_twitch_oauth_stage1/migration.sql"),
  "utf8"
);
const statements = sql
  .replace(/^--.*$/gm, "")
  .split(";")
  .map((part) => part.trim())
  .filter(Boolean);
const prisma = new PrismaClient({ datasourceUrl: `file:${database.replaceAll("\\", "/")}` });

async function schema(db) {
  const tables = new Set(
    (await db.$queryRawUnsafe("SELECT name FROM sqlite_master WHERE type = 'table'")).map(
      (row) => row.name
    )
  );
  const indexes = new Set(
    (await db.$queryRawUnsafe("SELECT name FROM sqlite_master WHERE type = 'index'")).map(
      (row) => row.name
    )
  );
  const columns = new Map();
  for (const table of ["User", "Session", "TwitchOAuthState", "TwitchOAuthConnection"]) {
    columns.set(
      table,
      tables.has(table) ? await db.$queryRawUnsafe(`PRAGMA table_info("${table}")`) : []
    );
  }
  return { tables, indexes, columns };
}

function pendingStatements(state) {
  const pending = [];
  for (const statement of statements) {
    const add = statement.match(/^ALTER TABLE "([A-Za-z]+)" ADD COLUMN "([A-Za-z]+)" /);
    const table = statement.match(/^CREATE TABLE "([A-Za-z]+)" \(/);
    const index = statement.match(/^CREATE (?:UNIQUE )?INDEX "([A-Za-z_]+)" /);
    if (add) {
      if (!state.columns.get(add[1])?.some((column) => column.name === add[2]))
        pending.push({ name: `${add[1]}.${add[2]}`, statement });
    } else if (table) {
      if (!state.tables.has(table[1])) pending.push({ name: table[1], statement });
    } else if (index) {
      if (!state.indexes.has(index[1])) pending.push({ name: index[1], statement });
    } else {
      throw new Error("Unexpected statement in stage-one migration SQL");
    }
  }
  return pending;
}

function requireColumn(state, table, name, type, notNull, defaultValue = null) {
  const column = state.columns.get(table)?.find((entry) => entry.name === name);
  if (
    !column ||
    column.type.toUpperCase() !== type ||
    Boolean(column.notnull) !== notNull ||
    column.dflt_value !== defaultValue
  ) {
    throw new Error(`Unexpected or missing ${table}.${name}; manual review required`);
  }
}

async function requireIndex(db, table, name, unique, expectedColumns) {
  const list = await db.$queryRawUnsafe(`PRAGMA index_list("${table}")`);
  const index = list.find((row) => row.name === name);
  if (!index || Boolean(index.unique) !== unique)
    throw new Error(`Unexpected or missing index ${name}`);
  const columns = await db.$queryRawUnsafe(`PRAGMA index_info("${name}")`);
  if (columns.map((row) => row.name).join(",") !== expectedColumns.join(","))
    throw new Error(`Unexpected columns in index ${name}`);
}

async function verify(db) {
  const state = await schema(db);
  for (const name of ["twitchUserId", "twitchLogin", "twitchAvatarUrl"])
    requireColumn(state, "User", name, "TEXT", false);
  requireColumn(state, "Session", "authMethod", "TEXT", true, "'LEGACY'");
  requireColumn(state, "Session", "twitchMode", "TEXT", false);
  for (const name of ["stateHash", "bindingHash", "mode", "redirectUri"])
    requireColumn(state, "TwitchOAuthState", name, "TEXT", true);
  requireColumn(state, "TwitchOAuthState", "expiresAt", "DATETIME", true);
  requireColumn(state, "TwitchOAuthState", "createdAt", "DATETIME", true, "CURRENT_TIMESTAMP");
  for (const name of ["id", "userId", "mode", "encryptedAccess", "encryptedRefresh", "scopesJson"])
    requireColumn(state, "TwitchOAuthConnection", name, "TEXT", true);
  for (const name of ["expiresAt", "checkedAt", "updatedAt"])
    requireColumn(state, "TwitchOAuthConnection", name, "DATETIME", true);
  requireColumn(state, "TwitchOAuthConnection", "revokedAt", "DATETIME", false);
  requireColumn(state, "TwitchOAuthConnection", "createdAt", "DATETIME", true, "CURRENT_TIMESTAMP");
  if (
    !state.columns.get("TwitchOAuthState")?.find((column) => column.name === "stateHash")?.pk ||
    !state.columns.get("TwitchOAuthConnection")?.find((column) => column.name === "id")?.pk
  ) {
    throw new Error("Unexpected Twitch OAuth primary keys");
  }
  await requireIndex(db, "User", "User_twitchUserId_key", true, ["twitchUserId"]);
  await requireIndex(db, "TwitchOAuthState", "TwitchOAuthState_expiresAt_idx", false, [
    "expiresAt"
  ]);
  await requireIndex(db, "TwitchOAuthConnection", "TwitchOAuthConnection_userId_mode_key", true, [
    "userId",
    "mode"
  ]);
  const foreignKeys = await db.$queryRawUnsafe('PRAGMA foreign_key_list("TwitchOAuthConnection")');
  if (
    !foreignKeys.some(
      (key) =>
        key.table === "User" &&
        key.from === "userId" &&
        key.to === "id" &&
        key.on_delete === "CASCADE"
    )
  ) {
    throw new Error("Unexpected TwitchOAuthConnection.userId foreign key");
  }
  if ((await db.$queryRawUnsafe("PRAGMA foreign_key_check")).length !== 0)
    throw new Error("Foreign key check failed");
}

try {
  const attached = await prisma.$queryRawUnsafe("PRAGMA database_list");
  if (attached.length !== 1 || path.resolve(attached[0].file) !== database)
    throw new Error("Connected SQLite path differs from requested database");
  const health = await prisma.$queryRawUnsafe("PRAGMA quick_check");
  if (health.length !== 1 || Object.values(health[0])[0] !== "ok")
    throw new Error("SQLite integrity check failed");
  const initial = await schema(prisma);
  if (
    !initial.tables.has("User") ||
    !initial.tables.has("Session") ||
    !initial.tables.has("Streamer")
  )
    throw new Error("Not an existing ModOverlayObs database");
  const pending = pendingStatements(initial);
  if (initial.tables.has("_prisma_migrations")) {
    const applied = await prisma.$queryRawUnsafe(
      'SELECT migration_name FROM "_prisma_migrations" WHERE migration_name = ?',
      "20261012_twitch_oauth_stage1"
    );
    if (applied.length && pending.length)
      throw new Error("Prisma history marks stage one applied, but its schema is incomplete");
  }
  if (!apply) {
    console.log(
      JSON.stringify({
        database,
        missing: pending.map((item) => item.name),
        complete: pending.length === 0
      })
    );
    if (!pending.length) await verify(prisma);
  } else {
    await prisma.$transaction(async (tx) => {
      for (const item of pending) await tx.$executeRawUnsafe(item.statement);
      await verify(tx);
    });
    console.log(
      JSON.stringify({
        database,
        added: pending.map((item) => item.name),
        stageOneComplete: true,
        prismaHistoryChanged: false
      })
    );
  }
} finally {
  await prisma.$disconnect();
}
