import { Role } from "@prisma/client";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { config, isProduction } from "./config";
import { prisma } from "./db";
import { defaultPermissionsByRole } from "../shared/types";
import { cleanupStaleTtsFiles } from "./ttsFiles";

export async function ensureRuntimeState(): Promise<void> {
  const userCount = await prisma.user.count();
  const createLegacyOwner = userCount === 0 && Boolean(config.initialAdminPassword.trim());
  if (userCount === 0 && (createLegacyOwner || !twitchOnlyConfigured())) {
    const password = config.initialAdminPassword;
    if (password.trim().length < 12 || password.trim() === "change-me-now") {
      throw new Error(
        "Set INITIAL_ADMIN_PASSWORD to a unique password of at least 12 characters before the first start."
      );
    }
  }

  await fs.mkdir(config.uploadDir, { recursive: true });
  await fs.mkdir(path.resolve(config.projectRoot, "database"), { recursive: true });
  await fs.mkdir(path.join(config.uploadDir, ".tmp"), { recursive: true });
  await cleanupStaleTtsFiles();

  await prisma.session.deleteMany({
    where: { expiresAt: { lt: new Date() } }
  });

  const streamerCount = await prisma.streamer.count();
  const hasLegacyUser = createLegacyOwner || await prisma.user.count({ where: { twitchUserId: null } }) > 0;
  if (streamerCount === 0 && hasLegacyUser) {
    await prisma.streamer.create({
      data: {
        displayName: "Default Streamer",
        overlayToken: crypto.randomBytes(32).toString("hex"),
        canvasWidth: 1920,
        canvasHeight: 1080
      }
    });
  }

  if (createLegacyOwner) {
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

function twitchOnlyConfigured(): boolean {
  try {
    const redirect = new URL(config.twitchOAuthRedirectUri);
    return Boolean(config.twitchClientId && config.twitchClientSecret &&
      /^[0-9a-f]{64}$/i.test(config.oauthTokenEncryptionKey) &&
      redirect.pathname === "/api/auth/twitch/callback" && !redirect.search && !redirect.hash &&
      (redirect.protocol === "https:" ||
        (!isProduction && redirect.protocol === "http:" && ["localhost", "127.0.0.1"].includes(redirect.hostname))));
  } catch { return false; }
}
