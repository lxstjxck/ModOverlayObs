import { PrismaClient } from "@prisma/client";
import crypto from "node:crypto";
import { realpath } from "node:fs/promises";
import path from "node:path";

const argument = process.argv[2];
if (!argument || !path.isAbsolute(argument)) {
  throw new Error(
    "Usage: node scripts/inspect-sqlite-migrations.mjs <absolute SQLite database path>"
  );
}
const database = await realpath(argument);
const prisma = new PrismaClient({ datasourceUrl: `file:${database.replaceAll("\\", "/")}` });
const models = [
  "User",
  "Session",
  "Streamer",
  "TwitchOAuthState",
  "TwitchOAuthConnection",
  "ChannelModeratorSnapshot",
  "ChannelModeratorBan",
  "Media",
  "Settings",
  "PreviewElement",
  "LiveInstance",
  "CustomEmote",
  "AuditLog",
  "SchemaMigration",
  "_prisma_migrations"
];
const stableColumns = {
  User: [
    "id",
    "username",
    "displayName",
    "passwordHash",
    "role",
    "permissionsJson",
    "createdAt",
    "updatedAt"
  ],
  Session: ["id", "tokenHash", "userId", "authMethod", "twitchMode", "expiresAt", "createdAt"],
  Streamer: [
    "id",
    "displayName",
    "overlayToken",
    "canvasWidth",
    "canvasHeight",
    "settingsJson",
    "createdAt",
    "updatedAt",
    "twitchLogin",
    "twitchBroadcasterId"
  ],
  TwitchOAuthState: ["stateHash", "bindingHash", "mode", "redirectUri", "expiresAt", "createdAt"],
  TwitchOAuthConnection: [
    "id",
    "userId",
    "mode",
    "encryptedAccess",
    "encryptedRefresh",
    "scopesJson",
    "expiresAt",
    "checkedAt",
    "revokedAt",
    "createdAt",
    "updatedAt"
  ],
  Media: [
    "id",
    "streamerId",
    "filename",
    "originalName",
    "mimeType",
    "type",
    "size",
    "url",
    "durationMs",
    "width",
    "height",
    "uploadedById",
    "createdAt",
    "updatedAt"
  ],
  Settings: ["key", "value", "updatedAt"],
  PreviewElement: [
    "id",
    "streamerId",
    "mediaId",
    "type",
    "name",
    "src",
    "text",
    "x",
    "y",
    "width",
    "height",
    "rotation",
    "opacity",
    "zIndex",
    "visible",
    "durationMs",
    "animationIn",
    "animationOut",
    "previewVolume",
    "liveVolume",
    "muted",
    "loop",
    "startTime",
    "propsJson",
    "createdAt",
    "updatedAt"
  ],
  LiveInstance: [
    "id",
    "streamerId",
    "previewElementId",
    "mediaId",
    "type",
    "name",
    "src",
    "text",
    "x",
    "y",
    "width",
    "height",
    "rotation",
    "opacity",
    "zIndex",
    "visible",
    "durationMs",
    "animationIn",
    "animationOut",
    "liveVolume",
    "muted",
    "loop",
    "startTime",
    "propsJson",
    "startedAt",
    "endsAt",
    "createdAt",
    "updatedAt"
  ],
  CustomEmote: [
    "id",
    "streamerId",
    "provider",
    "externalId",
    "name",
    "sourceUrl",
    "previewUrl",
    "animated",
    "width",
    "height",
    "createdAt",
    "createdById"
  ],
  AuditLog: ["id", "timestamp", "userId", "streamerId", "action", "mediaId", "metadataJson"]
};
try {
  const attached = await prisma.$queryRawUnsafe("PRAGMA database_list");
  if (attached.length !== 1 || path.resolve(attached[0].file) !== database) {
    throw new Error("Connected SQLite path differs from requested database");
  }
  const report = {
    database,
    integrity: null,
    foreignKeyIssues: null,
    tables: {},
    fingerprints: {},
    schemaMigrations: [],
    prismaMigrations: []
  };
  report.integrity = (await prisma.$queryRawUnsafe("PRAGMA quick_check")).map(
    (row) => Object.values(row)[0]
  );
  report.foreignKeyIssues = (await prisma.$queryRawUnsafe("PRAGMA foreign_key_check")).length;
  const found = await prisma.$queryRawUnsafe("SELECT name FROM sqlite_master WHERE type = 'table'");
  const names = new Set(found.map((row) => row.name));
  for (const model of models) {
    if (!names.has(model)) continue;
    const columns = await prisma.$queryRawUnsafe(`PRAGMA table_info("${model}")`);
    const indexes = await prisma.$queryRawUnsafe(`PRAGMA index_list("${model}")`);
    const count = await prisma.$queryRawUnsafe(`SELECT COUNT(*) AS count FROM "${model}"`);
    report.tables[model] = {
      count: Number(count[0].count),
      columns: columns.map((column) => ({
        name: column.name,
        type: column.type,
        notNull: Boolean(column.notnull),
        default: column.dflt_value,
        primaryKey: Boolean(column.pk)
      })),
      indexes: indexes.map((index) => ({ name: index.name, unique: Boolean(index.unique) }))
    };
    if (Object.hasOwn(stableColumns, model)) {
      const selected = stableColumns[model].filter((name) =>
        columns.some((column) => column.name === name)
      );
      const order =
        model === "Settings" ? "key" : model === "TwitchOAuthState" ? "stateHash" : "id";
      const rows = await prisma.$queryRawUnsafe(
        `SELECT ${selected.map((name) => `"${name}"`).join(", ")} FROM "${model}" ORDER BY "${order}"`
      );
      report.fingerprints[model] = crypto
        .createHash("sha256")
        .update(JSON.stringify(rows))
        .digest("hex");
    }
  }
  if (names.has("SchemaMigration")) {
    report.schemaMigrations = await prisma.$queryRawUnsafe(
      'SELECT version FROM "SchemaMigration" ORDER BY version'
    );
  }
  if (names.has("_prisma_migrations")) {
    report.prismaMigrations = await prisma.$queryRawUnsafe(
      'SELECT migration_name, finished_at, rolled_back_at FROM "_prisma_migrations" ORDER BY started_at'
    );
  }
  console.log(JSON.stringify(report, null, 2));
} finally {
  await prisma.$disconnect();
}
