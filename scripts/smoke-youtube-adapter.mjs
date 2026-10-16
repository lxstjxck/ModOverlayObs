import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { mediaStatusInputSchema } = require("../dist/server/shared/mediaStatus.js");
const report = {
  elementId: "video",
  connectionId: "obs",
  player: "youtube",
  position: 42,
  duration: 90,
  playing: false,
  state: "BUFFERING",
  commandId: "seek-1",
  errorCode: null,
  issue: null
};
assert.equal(mediaStatusInputSchema.safeParse(report).success, true);

const assetDir = path.resolve("dist/client/assets");
const bundles = fs.readdirSync(assetDir).filter((name) => /^index-.*\.js$/.test(name));
assert.equal(bundles.length, 1);
const bundle = fs.readFileSync(path.join(assetDir, bundles[0]), "utf8");
assert.equal(bundle.includes("https://www.youtube.com/iframe_api"), true);
assert.equal(bundle.includes("youtube:status"), true);
assert.equal(bundle.includes("setLoop"), true);

console.log("Built YouTube adapter smoke: ok");
