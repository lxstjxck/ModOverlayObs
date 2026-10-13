import { PrismaClient } from "@prisma/client";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { expect, it } from "vitest";

const run = promisify(execFile);
const migrationNames = [
  "20261011_initial_baseline",
  "20261012_twitch_oauth_stage1",
  "20261013_channel_access_stage2",
  "20261013_channel_identity_unique"
];

it("installs the complete Prisma schema on an empty SQLite database", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "modoverlay-fresh-migrations-"));
  if (
    !path.isAbsolute(directory) ||
    !path.basename(directory).startsWith("modoverlay-fresh-migrations-")
  ) {
    throw new Error("Unsafe test directory");
  }

  const database = path.join(directory, "fresh.db");
  const databaseUrl = `file:${database.replaceAll("\\", "/")}`;
  const env = { ...process.env, DATABASE_URL: databaseUrl };
  const cli = path.resolve("node_modules/prisma/build/index.js");
  const schema = path.resolve("prisma/schema.prisma");
  const prisma = new PrismaClient({ datasourceUrl: databaseUrl });

  try {
    await writeFile(database, "", { flag: "wx" });
    const deployed = await run(process.execPath, [cli, "migrate", "deploy", "--schema", schema], {
      env,
      timeout: 30_000
    });
    for (const name of migrationNames) {
      expect(deployed.stdout).toContain(`Applying migration \`${name}\``);
    }

    const databases = await prisma.$queryRawUnsafe<Array<{ file: string }>>("PRAGMA database_list");
    expect(path.resolve(databases[0].file)).toBe(database);

    const history = await prisma.$queryRawUnsafe<Array<{ migration_name: string }>>(
      'SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY started_at'
    );
    expect(history.map(({ migration_name }) => migration_name)).toEqual(migrationNames);

    const foreignKeyErrors = await prisma.$queryRawUnsafe<Array<unknown>>(
      "PRAGMA foreign_key_check"
    );
    expect(foreignKeyErrors).toEqual([]);

    const diff = await run(
      process.execPath,
      [
        cli,
        "migrate",
        "diff",
        "--from-url",
        databaseUrl,
        "--to-schema-datamodel",
        schema,
        "--script"
      ],
      { env, timeout: 30_000 }
    );
    expect(diff.stdout.trim()).toBe("-- This is an empty migration.");

    const repeated = await run(process.execPath, [cli, "migrate", "deploy", "--schema", schema], {
      env,
      timeout: 30_000
    });
    expect(repeated.stdout).toContain("No pending migrations to apply");
  } finally {
    await prisma.$disconnect();
    await rm(directory, { recursive: true, force: true });
  }
}, 90_000);
