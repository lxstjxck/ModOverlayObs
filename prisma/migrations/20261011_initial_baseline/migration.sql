-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "username" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'MODERATOR',
    "permissionsJson" TEXT NOT NULL DEFAULT '{}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tokenHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Streamer" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "displayName" TEXT NOT NULL,
    "overlayToken" TEXT NOT NULL,
    "canvasWidth" INTEGER NOT NULL DEFAULT 1920,
    "canvasHeight" INTEGER NOT NULL DEFAULT 1080,
    "settingsJson" TEXT NOT NULL DEFAULT '{}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "twitchLogin" TEXT,
    "twitchBroadcasterId" TEXT
);

-- CreateTable
CREATE TABLE "CustomEmote" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "streamerId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "externalId" TEXT,
    "name" TEXT NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "previewUrl" TEXT NOT NULL,
    "animated" BOOLEAN NOT NULL DEFAULT false,
    "width" INTEGER,
    "height" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,
    CONSTRAINT "CustomEmote_streamerId_fkey" FOREIGN KEY ("streamerId") REFERENCES "Streamer" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Media" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "streamerId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "url" TEXT NOT NULL,
    "durationMs" INTEGER,
    "width" INTEGER,
    "height" INTEGER,
    "uploadedById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Media_streamerId_fkey" FOREIGN KEY ("streamerId") REFERENCES "Streamer" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Media_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PreviewElement" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "streamerId" TEXT NOT NULL,
    "mediaId" TEXT,
    "type" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "src" TEXT,
    "text" TEXT,
    "x" REAL NOT NULL DEFAULT 100,
    "y" REAL NOT NULL DEFAULT 100,
    "width" REAL NOT NULL DEFAULT 320,
    "height" REAL NOT NULL DEFAULT 180,
    "rotation" REAL NOT NULL DEFAULT 0,
    "opacity" REAL NOT NULL DEFAULT 1,
    "zIndex" INTEGER NOT NULL DEFAULT 1,
    "visible" BOOLEAN NOT NULL DEFAULT true,
    "durationMs" INTEGER,
    "animationIn" TEXT NOT NULL DEFAULT 'none',
    "animationOut" TEXT NOT NULL DEFAULT 'none',
    "previewVolume" REAL NOT NULL DEFAULT 1,
    "liveVolume" REAL NOT NULL DEFAULT 1,
    "muted" BOOLEAN NOT NULL DEFAULT false,
    "loop" BOOLEAN NOT NULL DEFAULT false,
    "startTime" REAL NOT NULL DEFAULT 0,
    "propsJson" TEXT NOT NULL DEFAULT '{}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PreviewElement_streamerId_fkey" FOREIGN KEY ("streamerId") REFERENCES "Streamer" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PreviewElement_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "Media" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "LiveInstance" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "streamerId" TEXT NOT NULL,
    "previewElementId" TEXT,
    "mediaId" TEXT,
    "type" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "src" TEXT,
    "text" TEXT,
    "x" REAL NOT NULL DEFAULT 100,
    "y" REAL NOT NULL DEFAULT 100,
    "width" REAL NOT NULL DEFAULT 320,
    "height" REAL NOT NULL DEFAULT 180,
    "rotation" REAL NOT NULL DEFAULT 0,
    "opacity" REAL NOT NULL DEFAULT 1,
    "zIndex" INTEGER NOT NULL DEFAULT 1,
    "visible" BOOLEAN NOT NULL DEFAULT true,
    "durationMs" INTEGER,
    "animationIn" TEXT NOT NULL DEFAULT 'none',
    "animationOut" TEXT NOT NULL DEFAULT 'none',
    "liveVolume" REAL NOT NULL DEFAULT 1,
    "muted" BOOLEAN NOT NULL DEFAULT false,
    "loop" BOOLEAN NOT NULL DEFAULT false,
    "startTime" REAL NOT NULL DEFAULT 0,
    "propsJson" TEXT NOT NULL DEFAULT '{}',
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endsAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "LiveInstance_streamerId_fkey" FOREIGN KEY ("streamerId") REFERENCES "Streamer" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "LiveInstance_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "Media" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "timestamp" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT,
    "streamerId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "mediaId" TEXT,
    "metadataJson" TEXT NOT NULL DEFAULT '{}',
    CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "AuditLog_streamerId_fkey" FOREIGN KEY ("streamerId") REFERENCES "Streamer" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AuditLog_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "Media" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Settings" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "value" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Streamer_overlayToken_key" ON "Streamer"("overlayToken");

-- CreateIndex
CREATE INDEX "CustomEmote_streamerId_idx" ON "CustomEmote"("streamerId");

-- CreateIndex
CREATE UNIQUE INDEX "Media_filename_key" ON "Media"("filename");

-- CreateIndex
CREATE INDEX "Media_streamerId_idx" ON "Media"("streamerId");

-- CreateIndex
CREATE INDEX "Media_uploadedById_idx" ON "Media"("uploadedById");

-- CreateIndex
CREATE INDEX "PreviewElement_streamerId_idx" ON "PreviewElement"("streamerId");

-- CreateIndex
CREATE INDEX "PreviewElement_mediaId_idx" ON "PreviewElement"("mediaId");

-- CreateIndex
CREATE INDEX "LiveInstance_streamerId_idx" ON "LiveInstance"("streamerId");

-- CreateIndex
CREATE INDEX "LiveInstance_previewElementId_idx" ON "LiveInstance"("previewElementId");

-- CreateIndex
CREATE INDEX "LiveInstance_mediaId_idx" ON "LiveInstance"("mediaId");

-- CreateIndex
CREATE INDEX "LiveInstance_endsAt_idx" ON "LiveInstance"("endsAt");

-- CreateIndex
CREATE INDEX "AuditLog_userId_idx" ON "AuditLog"("userId");

-- CreateIndex
CREATE INDEX "AuditLog_streamerId_idx" ON "AuditLog"("streamerId");

-- CreateIndex
CREATE INDEX "AuditLog_mediaId_idx" ON "AuditLog"("mediaId");
