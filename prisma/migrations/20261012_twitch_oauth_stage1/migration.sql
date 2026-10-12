-- Additive stage-one migration. Apply only to a backed-up, stopped database
-- after rehearsing on a copy; never use a destructive reset.
ALTER TABLE "User" ADD COLUMN "twitchUserId" TEXT;
ALTER TABLE "User" ADD COLUMN "twitchLogin" TEXT;
ALTER TABLE "User" ADD COLUMN "twitchAvatarUrl" TEXT;
CREATE UNIQUE INDEX "User_twitchUserId_key" ON "User"("twitchUserId");

ALTER TABLE "Session" ADD COLUMN "authMethod" TEXT NOT NULL DEFAULT 'LEGACY';
ALTER TABLE "Session" ADD COLUMN "twitchMode" TEXT;

CREATE TABLE "TwitchOAuthState" (
  "stateHash" TEXT NOT NULL PRIMARY KEY,
  "bindingHash" TEXT NOT NULL,
  "mode" TEXT NOT NULL,
  "redirectUri" TEXT NOT NULL,
  "expiresAt" DATETIME NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "TwitchOAuthState_expiresAt_idx" ON "TwitchOAuthState"("expiresAt");

CREATE TABLE "TwitchOAuthConnection" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "mode" TEXT NOT NULL,
  "encryptedAccess" TEXT NOT NULL,
  "encryptedRefresh" TEXT NOT NULL,
  "scopesJson" TEXT NOT NULL,
  "expiresAt" DATETIME NOT NULL,
  "checkedAt" DATETIME NOT NULL,
  "revokedAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "TwitchOAuthConnection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "TwitchOAuthConnection_userId_mode_key" ON "TwitchOAuthConnection"("userId", "mode");
