import { readFileSync } from "node:fs";

const tokenFile = "src/client/styles/tokens.css";
const displayFiles = ["src/client/styles/landing.css", "src/client/styles/ecosystem.css", "src/client/styles/workspace.css"];
const displaySelectors = [
  ".landing-hero h1",
  ".landing-section-heading h2",
  ".landing-cta h2",
  ".ecosystem-hero h1",
  ".ecosystem-section-heading h2",
  ".lxst-auth-intro h1",
  ".lxst-dashboard-title-row h1"
];
const mostNegative = -0.005;
const tokens = readFileSync(tokenFile, "utf8");
const values = new Map();
const violations = [];

for (const name of ["--ui-display-tracking", "--ui-section-tracking"]) {
  const raw = tokens.match(new RegExp(`${name}\\s*:\\s*([^;]+);`))?.[1]?.trim();
  if (!raw) violations.push(`${tokenFile}: missing ${name}`);
  else values.set(name, raw);
}

function check(value, location) {
  const raw = value.startsWith("var(") ? values.get(value.match(/^var\((--[\w-]+)\)$/)?.[1]) : value;
  if (raw === "normal") return;
  const amount = raw?.match(/^(-?\d+(?:\.\d+)?)em$/);
  if (!amount || Number(amount[1]) < mostNegative) {
    violations.push(`${location}: letter-spacing ${value} exceeds the display-heading limit (${mostNegative}em)`);
  }
}

for (const [name, value] of values) check(value, `${tokenFile}: ${name}`);
for (const file of displayFiles) {
  const css = readFileSync(file, "utf8");
  for (const [, selector, declarations] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!displaySelectors.some((item) => selector.includes(item))) continue;
    for (const [, value] of declarations.matchAll(/(?:^|;)\s*letter-spacing\s*:\s*([^;]+);/g)) {
      check(value.trim(), `${file}: ${selector.trim()}`);
    }
  }
}

if (violations.length) {
  process.stderr.write(`${violations.join("\n")}\n`);
  process.exitCode = 1;
}
