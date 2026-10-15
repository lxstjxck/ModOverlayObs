import { readFileSync } from "node:fs";
import { brotliDecompressSync } from "node:zlib";

const knownTags = [
  "cmap", "head", "hhea", "hmtx", "maxp", "name", "OS/2", "post", "cvt ", "fpgm", "glyf", "loca", "prep",
  "CFF ", "VORG", "EBDT", "EBLC", "gasp", "hdmx", "kern", "LTSH", "PCLT", "VDMX", "vhea", "vmtx",
  "BASE", "GDEF", "GPOS", "GSUB", "EBSC", "JSTF", "MATH", "CBDT", "CBLC", "COLR", "CPAL", "SVG ",
  "sbix", "acnt", "avar", "bdat", "bloc", "bsln", "cvar", "fdsc", "feat", "fmtx", "fvar",
  "gvar", "hsty", "just", "lcar", "mort", "morx", "opbd", "prop", "trak", "Zapf", "Silf", "Glat",
  "Gloc", "Feat", "Sill"
];

function base128(bytes, cursor) {
  let value = 0;
  for (let index = 0; index < 5; index += 1) {
    const byte = bytes[cursor.offset++];
    if (byte === undefined || (index === 0 && byte === 0x80) || value & 0xfe000000) {
      throw new Error("Invalid WOFF2 Base128 integer");
    }
    value = (value << 7) | (byte & 0x7f);
    if (!(byte & 0x80)) return value;
  }
  throw new Error("WOFF2 Base128 integer is too long");
}

function fixed(table, offset) {
  return table.readInt32BE(offset) / 65536;
}

function tableDirectory(bytes) {
  if (bytes.toString("ascii", 0, 4) !== "wOF2") throw new Error("Expected WOFF2");
  const cursor = { offset: 48 };
  const tables = [];
  for (let index = 0; index < bytes.readUInt16BE(12); index += 1) {
    const flags = bytes[cursor.offset++];
    const tagIndex = flags & 0x3f;
    const tag = tagIndex === 0x3f ? bytes.toString("ascii", cursor.offset, cursor.offset += 4) : knownTags[tagIndex];
    const originalLength = base128(bytes, cursor);
    const transformVersion = flags >> 6;
    const transformed = tag === "glyf" || tag === "loca" ? transformVersion === 0 : transformVersion !== 0;
    const dataLength = transformed ? base128(bytes, cursor) : originalLength;
    tables.push({ tag, originalLength, dataLength, transformed });
  }
  const compressed = bytes.subarray(cursor.offset, cursor.offset + bytes.readUInt32BE(20));
  const data = brotliDecompressSync(compressed);
  let offset = 0;
  const result = new Map(tables.map((entry) => {
    const table = data.subarray(offset, offset + entry.dataLength);
    offset += entry.dataLength;
    return [entry.tag, { ...entry, data: table }];
  }));
  if (offset !== data.length) throw new Error("WOFF2 table lengths do not match decompressed data");
  return result;
}

function cmapGlyph(cmap, codepoint) {
  const count = cmap.readUInt16BE(2);
  const subtables = [];
  for (let index = 0; index < count; index += 1) {
    const record = 4 + index * 8;
    const platform = cmap.readUInt16BE(record);
    const encoding = cmap.readUInt16BE(record + 2);
    const offset = cmap.readUInt32BE(record + 4);
    const format = cmap.readUInt16BE(offset);
    if (platform === 3 && (encoding === 1 || encoding === 10)) subtables.push({ offset, format });
  }
  for (const { offset, format } of subtables.sort((a, b) => b.format - a.format)) {
    if (format === 12) {
      const groups = cmap.readUInt32BE(offset + 12);
      for (let index = 0; index < groups; index += 1) {
        const group = offset + 16 + index * 12;
        const start = cmap.readUInt32BE(group);
        const end = cmap.readUInt32BE(group + 4);
        if (codepoint >= start && codepoint <= end) return cmap.readUInt32BE(group + 8) + codepoint - start;
      }
    }
    if (format === 4) {
      const segments = cmap.readUInt16BE(offset + 6) / 2;
      const ends = offset + 14;
      const starts = ends + segments * 2 + 2;
      const deltas = starts + segments * 2;
      const ranges = deltas + segments * 2;
      for (let index = 0; index < segments; index += 1) {
        if (codepoint > cmap.readUInt16BE(ends + index * 2)) continue;
        if (codepoint < cmap.readUInt16BE(starts + index * 2)) break;
        const delta = cmap.readInt16BE(deltas + index * 2);
        const range = cmap.readUInt16BE(ranges + index * 2);
        if (!range) return (codepoint + delta) & 0xffff;
        const glyphOffset = ranges + index * 2 + range + (codepoint - cmap.readUInt16BE(starts + index * 2)) * 2;
        const glyph = cmap.readUInt16BE(glyphOffset);
        return glyph ? (glyph + delta) & 0xffff : 0;
      }
    }
  }
  return 0;
}

function readFont(path) {
  const tables = tableDirectory(readFileSync(path));
  const get = (tag) => tables.get(tag)?.data;
  const head = get("head");
  const hhea = get("hhea");
  const os2 = get("OS/2");
  const maxp = get("maxp");
  const fvar = get("fvar");
  const cmap = get("cmap");
  const hmtx = tables.get("hmtx");
  const unitsPerEm = head.readUInt16BE(18);
  const numberOfHMetrics = hhea.readUInt16BE(34);
  const axes = [];
  if (fvar) {
    const offset = fvar.readUInt16BE(4);
    const count = fvar.readUInt16BE(8);
    const size = fvar.readUInt16BE(10);
    for (let index = 0; index < count; index += 1) {
      const position = offset + index * size;
      axes.push({ tag: fvar.toString("ascii", position, position + 4), min: fixed(fvar, position + 4), default: fixed(fvar, position + 8), max: fixed(fvar, position + 12) });
    }
  }
  const glyphs = {};
  for (const letter of ["В", "с", "Т", "А", "П", "О", "И", "T", "A", "O", "V", "o", " "]) {
    const gid = cmapGlyph(cmap, letter.codePointAt(0));
    if (!gid) continue;
    if (hmtx?.transformed) throw new Error("Transformed hmtx needs reconstruction");
    const advance = hmtx.data.readUInt16BE(Math.min(gid, numberOfHMetrics - 1) * 4);
    const lsbOffset = gid < numberOfHMetrics ? gid * 4 + 2 : numberOfHMetrics * 4 + (gid - numberOfHMetrics) * 2;
    glyphs[letter === " " ? "space" : letter] = { gid, advance, lsb: hmtx.data.readInt16BE(lsbOffset) };
  }
  const gpos = get("GPOS");
  const features = [];
  if (gpos) {
    const featureList = gpos.readUInt16BE(6);
    const count = gpos.readUInt16BE(featureList);
    for (let index = 0; index < count; index += 1) {
      features.push(gpos.toString("ascii", featureList + 2 + index * 6, featureList + 6 + index * 6));
    }
  }
  return {
    path,
    fontRevision: fixed(head, 4),
    unitsPerEm,
    ascender: hhea.readInt16BE(4),
    descender: hhea.readInt16BE(6),
    lineGap: hhea.readInt16BE(8),
    defaultWeightClass: os2.readUInt16BE(4),
    glyphCount: maxp.readUInt16BE(4),
    axes,
    gposFeatures: [...new Set(features)],
    glyphsAtDefaultAxis: glyphs,
    tableTags: [...tables.keys()]
  };
}

for (const path of ["public/fonts/montserrat-cyrillic.woff2", "public/fonts/montserrat-latin.woff2"]) {
  process.stdout.write(`${JSON.stringify(readFont(path), null, 2)}\n`);
}

if (process.argv.includes("--browser")) {
  const port = process.env.LXST_CDP_PORT ?? "9225";
  const pages = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  const page = pages.find((entry) => entry.type === "page");
  if (!page) throw new Error("No Chromium page is available on the CDP port");
  const socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  let nextId = 0;
  const pending = new Map();
  socket.addEventListener("message", (event) => {
    const response = JSON.parse(event.data);
    const handler = pending.get(response.id);
    if (!handler) return;
    pending.delete(response.id);
    response.error ? handler.reject(response.error) : handler.resolve(response.result);
  });
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
  await call("Page.enable");
  await call("Page.navigate", { url: process.env.LXST_DEV_URL ?? "http://127.0.0.1:5173/" });
  const result = await call("Runtime.evaluate", {
    expression: `document.fonts.ready.then(() => {
      const context = document.createElement('canvas').getContext('2d');
      context.textAlign = 'left';
      const measure = (text, weight, kerning = 'normal') => {
        context.font = weight + ' 100px Montserrat';
        context.fontKerning = kerning;
        const metrics = context.measureText(text);
        return {advance:metrics.width, inkStart:-metrics.actualBoundingBoxLeft,
          inkEnd:metrics.actualBoundingBoxRight,
          rightBearing:metrics.width-metrics.actualBoundingBoxRight};
      };
      return {
        faces:[...document.fonts].filter(face=>face.family==='Montserrat').map(face=>({weight:face.weight,status:face.status})),
        glyphs:Object.fromEntries(['В','с','Т','А','П','О','И','К','у','T','A','O'].map(letter=>
          [letter,{weight300:measure(letter,300),weight400:measure(letter,400)}])),
        pairs:Object.fromEntries(['стр','тво','Все','для','Тв','Во','To'].map(pair=>
          [pair,{normal300:measure(pair,300).advance,none300:measure(pair,300,'none').advance,
            normal400:measure(pair,400).advance,none400:measure(pair,400,'none').advance}]))
      };
    })`,
    awaitPromise: true,
    returnByValue: true
  });
  socket.close();
  process.stdout.write(`${JSON.stringify({ browserMetricsAt100px: result.result.value }, null, 2)}\n`);
}
