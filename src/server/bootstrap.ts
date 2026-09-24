import { Role } from "@prisma/client";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { config } from "./config";
import { prisma } from "./db";
import { defaultPermissionsByRole } from "../shared/types";

export async function ensureRuntimeState(): Promise<void> {
  await fs.mkdir(config.uploadDir, { recursive: true });
  await fs.mkdir(path.resolve(config.projectRoot, "database"), { recursive: true });
  await fs.mkdir(path.join(config.uploadDir, ".tmp"), { recursive: true });

  await prisma.session.deleteMany({
    where: { expiresAt: { lt: new Date() } }
  });

  const streamerCount = await prisma.streamer.count();
  if (streamerCount === 0) {
    await prisma.streamer.create({
      data: {
        displayName: "Default Streamer",
        overlayToken: crypto.randomBytes(32).toString("hex"),
        canvasWidth: 1920,
        canvasHeight: 1080
      }
    });
  }

  const userCount = await prisma.user.count();
  if (userCount === 0) {
    const passwordHash = await bcrypt.hash(config.initialAdminPassword, 12);
    await prisma.user.create({
      data: {
        username: config.initialAdminUsername,
        displayName: "Owner",
        passwordHash,
        role: Role.OWNER,
        permissionsJson: JSON.stringify(defaultPermissionsByRole.OWNER)
      }
    });
  }
}
