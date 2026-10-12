import { PrismaClient } from "@prisma/client";
import { mkdir, realpath, stat } from "node:fs/promises";
import path from "node:path";

const sourceArg = process.argv[2];
if (!sourceArg || !path.isAbsolute(sourceArg)) {
  throw new Error("Usage: node scripts/backup-sqlite.mjs <absolute SQLite database path>");
}
const source = await realpath(sourceArg);
if (!(await stat(source)).isFile()) throw new Error("Source is not a file");
const directory = path.resolve("backups");
await mkdir(directory, { recursive: true });
const destination = path.join(
  directory,
  `modoverlay-pre-migration-${new Date().toISOString().replaceAll(/[:.]/g, "-")}.db`
);
const prisma = new PrismaClient({ datasourceUrl: `file:${source.replaceAll("\\", "/")}` });
try {
  const attached = await prisma.$queryRawUnsafe("PRAGMA database_list");
  if (attached.length !== 1 || path.resolve(attached[0].file) !== source) {
    throw new Error("Connected SQLite path differs from requested source");
  }
  const health = await prisma.$queryRawUnsafe("PRAGMA quick_check");
  if (health.length !== 1 || Object.values(health[0])[0] !== "ok") {
    throw new Error("Source SQLite integrity check failed");
  }
  const quote = String.fromCharCode(39);
  const target = destination.replaceAll("\\", "/").replaceAll(quote, quote + quote);
  await prisma.$executeRawUnsafe(`VACUUM INTO ${quote}${target}${quote}`);
} finally {
  await prisma.$disconnect();
}
const copy = new PrismaClient({ datasourceUrl: `file:${destination.replaceAll("\\", "/")}` });
try {
  const health = await copy.$queryRawUnsafe("PRAGMA quick_check");
  if (health.length !== 1 || Object.values(health[0])[0] !== "ok") {
    throw new Error("Backup SQLite integrity check failed");
  }
} finally {
  await copy.$disconnect();
}
console.log(JSON.stringify({ backup: destination, bytes: (await stat(destination)).size }));
