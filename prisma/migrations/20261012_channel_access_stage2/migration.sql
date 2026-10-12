-- Additive migration. Apply to a stopped, backed-up database after rehearsal.
ALTER TABLE "TwitchOAuthState" ADD COLUMN "legacySessionHash" TEXT;
ALTER TABLE "Streamer" ADD COLUMN "ownerUserId" TEXT REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE UNIQUE INDEX "Streamer_ownerUserId_key" ON "Streamer"("ownerUserId");

CREATE TABLE "ChannelModeratorSnapshot" (
  "channelId" TEXT NOT NULL PRIMARY KEY,
  "userIdsJson" TEXT NOT NULL,
  "checkedAt" DATETIME NOT NULL,
  CONSTRAINT "ChannelModeratorSnapshot_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Streamer" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "ChannelModeratorBan" (
  "channelId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("channelId", "userId"),
  CONSTRAINT "ChannelModeratorBan_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Streamer" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ChannelModeratorBan_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "ChannelModeratorBan_userId_idx" ON "ChannelModeratorBan"("userId");
