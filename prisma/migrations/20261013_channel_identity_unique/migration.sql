-- A Twitch broadcaster may belong to one channel. SQLite permits multiple NULL values.
CREATE UNIQUE INDEX "Streamer_twitchBroadcasterId_key" ON "Streamer"("twitchBroadcasterId");
