import { readFileSync, writeFileSync } from "node:fs";

const files = [
  "src/client/styles.css",
  "src/client/broadcastConsole.css",
  "src/client/styles/landing.css",
  "src/client/styles/ecosystem.css",
  "src/client/styles/workspace.css",
  "src/client/styles/editor.css"
];
const scale = [4, 8, 12, 16, 24, 40, 56, 88, 128];
const spacingProperty = /(?<![\w-])((?:margin|padding)(?:-(?:top|right|bottom|left|inline|block)(?:-(?:start|end))?)?|(?:row-|column-)?gap)\s*:\s*([^;]+);/g;
// These selectors set the illustrated editor or OBS canvas geometry, not UI rhythm.
const geometrySelector = /\.landing-demo|\.canvas|\.crop|\.overlay-stage|\.media-frame|\.scene-stage/;
const block = /([^{}]+)\{([^{}]*)\}/g;
const violations = [];
const fix = process.argv.includes("--fix");

for (const file of files) {
  let css = readFileSync(file, "utf8");
  css = css.replace(block, (whole, selector, declarations) => {
    if (geometrySelector.test(selector)) return whole;
    const updated = declarations.replace(spacingProperty, (declaration, property, value) => {
      const next = value.replace(/(-?)(\d+(?:\.\d+)?)px\b/g, (pixel, sign, raw) => {
        const amount = Number(raw);
        if (amount === 0 || scale.includes(amount)) return pixel;
        if (!fix) {
          violations.push(`${file}: ${selector.trim()} { ${property}: ${value.trim()} }`);
          return pixel;
        }
        const nearest = scale.reduce((best, candidate) =>
          Math.abs(candidate - amount) < Math.abs(best - amount) ? candidate : best
        );
        return sign ? `calc(-1 * var(--space-${scale.indexOf(nearest) + 1}))` : `var(--space-${scale.indexOf(nearest) + 1})`;
      });
      return declaration.replace(value, next);
    });
    return whole.replace(declarations, updated);
  });
  if (fix) writeFileSync(file, css);
}

if (violations.length) {
  process.stderr.write(`Arbitrary UI spacing:\n${[...new Set(violations)].join("\n")}\n`);
  process.exitCode = 1;
}
