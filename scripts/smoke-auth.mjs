import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { PrismaClient } from "@prisma/client";
import dotenv from "dotenv";
import express from "express";
import http from "node:http";
import { realpath } from "node:fs/promises";
import path from "node:path";

dotenv.config();
const args = process.argv.slice(2);
if (
  args.length !== 3 ||
  args[0] !== "--database" ||
  !path.isAbsolute(args[1]) ||
  !["--legacy", "--legacy-fixture", "--oauth-start"].includes(args[2])
) {
  throw new Error(
    "Usage: node scripts/smoke-auth.mjs --database <absolute SQLite path> (--legacy|--legacy-fixture|--oauth-start)"
  );
}
const database = await realpath(args[1]);
if (
  args[2] === "--legacy-fixture" &&
  (path.dirname(database) !== path.resolve("backups") ||
    !path.basename(database).startsWith("modoverlay-login-smoke-"))
) {
  throw new Error(
    "Fixture login is permitted only on a disposable backups/modoverlay-login-smoke-* copy"
  );
}
process.env.DATABASE_URL = `file:${database.replaceAll("\\", "/")}`;
const probe = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });
const require = createRequire(import.meta.url);
const { createAppRouter } = require("../dist/server/server/routes.js");
const { requireTrustedOrigin, requireCsrf } = require("../dist/server/server/security.js");
const app = express();
app.set("trust proxy", false);
app.use(express.json());
app.use("/api", requireTrustedOrigin, requireCsrf, createAppRouter());
const server = http.createServer(app);
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
try {
  if (args[2] === "--legacy" || args[2] === "--legacy-fixture") {
    const fixture = args[2] === "--legacy-fixture";
    const password = fixture
      ? crypto.randomBytes(24).toString("base64url")
      : (process.env.OWNER_RESET_PASSWORD ?? process.env.INITIAL_ADMIN_PASSWORD);
    const owner = fixture
      ? await probe.user.create({
          data: {
            username: `smoke-${crypto.randomBytes(8).toString("hex")}`,
            displayName: "Smoke test",
            passwordHash: await bcrypt.hash(password, 12),
            role: "OWNER"
          }
        })
      : await probe.user.findFirst({ where: { role: "OWNER", twitchUserId: null } });
    if (!owner || !password || !(await bcrypt.compare(password, owner.passwordHash))) {
      throw new Error(
        "Legacy password in .env does not match the stored owner; manual login check required"
      );
    }
    const login = await fetch(`${origin}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: owner.username, password })
    });
    if (login.status !== 200) throw new Error(`Legacy HTTP login failed: ${login.status}`);
    const cookie = login.headers
      .getSetCookie()
      .find((part) => part.startsWith("mod_overlay_session="))
      ?.split(";")[0];
    const body = await login.json();
    if (!cookie || !body.csrfToken) throw new Error("Legacy login did not issue a session");
    const me = await fetch(`${origin}/api/auth/me`, { headers: { Cookie: cookie } });
    const media = await fetch(`${origin}/api/media`, { headers: { Cookie: cookie } });
    const obs = await fetch(`${origin}/api/obs`, { headers: { Cookie: cookie } });
    const channel = await probe.streamer.findFirst({ orderBy: { createdAt: "asc" } });
    if (me.status !== 200 || media.status !== 200 || obs.status !== 200 || !channel)
      throw new Error("Legacy authenticated reads failed");
    const obsBody = await obs.json();
    if (new URL(obsBody.overlayUrl).pathname !== `/overlay/${channel.overlayToken}`)
      throw new Error("OBS Overlay URL changed");
    const logout = await fetch(`${origin}/api/auth/logout`, {
      method: "POST",
      headers: { Cookie: cookie, "x-csrf-token": body.csrfToken }
    });
    if (logout.status !== 200) throw new Error("Legacy logout failed");
    console.log(
      `Legacy HTTP login, authenticated reads, OBS URL and logout: ok (${fixture ? "disposable copy" : "local database"})`
    );
  } else {
    const start = await fetch(`${origin}/api/auth/twitch/start/streamer`, { redirect: "manual" });
    if (start.status !== 302) throw new Error(`Twitch OAuth start failed: ${start.status}`);
    const authorize = new URL(start.headers.get("location"));
    if (
      authorize.origin !== "https://id.twitch.tv" ||
      authorize.searchParams.get("scope") !== "moderation:read"
    )
      throw new Error("Unexpected Twitch OAuth authorization request");
    const state = authorize.searchParams.get("state");
    if (!state) throw new Error("Twitch OAuth state missing");
    const stateHash = crypto.createHash("sha256").update(state).digest("hex");
    const saved = await probe.twitchOAuthState.findUnique({ where: { stateHash } });
    if (!saved) throw new Error("Twitch OAuth state was not persisted");
    await probe.twitchOAuthState.delete({ where: { stateHash } });
    console.log("Twitch OAuth start and persisted state: ok");
  }
} finally {
  await new Promise((resolve) => server.close(resolve));
  await probe.$disconnect();
}
