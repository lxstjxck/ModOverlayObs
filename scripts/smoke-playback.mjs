import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { MediaStatuses } = require("../dist/server/server/mediaStatuses.js");
const { mediaStatusInputSchema } = require("../dist/server/shared/mediaStatus.js");
const statuses = new MediaStatuses();
const report = {
  elementId: "video",
  connectionId: "obs-a",
  position: 41,
  duration: 90,
  playing: true,
  commandId: "seek-1"
};

assert.equal(mediaStatusInputSchema.safeParse(report).success, true);
assert.equal(statuses.update("stage", "obs-a", report).position, 41);
assert.equal(statuses.update("stage", "obs-b", { ...report, connectionId: "obs-b", position: 57 }).position, 57);
assert.equal(statuses.snapshot("stage").length, 2);
statuses.removeSocket("stage", "obs-a");
assert.deepEqual(statuses.snapshot("stage").map((item) => item.position), [57]);

const assetDir = path.resolve("dist/client/assets");
const bundles = fs.readdirSync(assetDir).filter((name) => /^index-.*\.js$/.test(name));
assert.equal(bundles.length, 1);
assert.equal(fs.readFileSync(path.join(assetDir, bundles[0]), "utf8").includes("media:status"), true);

console.log("Built playback telemetry smoke: ok");
