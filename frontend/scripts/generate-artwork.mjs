import { readFileSync, readdirSync, writeFileSync } from "node:fs";
const assets = new URL("../src/assets/", import.meta.url);
const read = (path) => readFileSync(new URL(path, assets), "utf8");
const files = (folder) =>
  readdirSync(new URL(folder, assets))
    .filter((name) => name.endsWith(".svg"))
    .sort();
const icons = Object.fromEntries(
  files("icons/").map((file) => [file.slice(0, -4), read(`icons/${file}`)]),
);
const frames = files("fire/").map((file) => read(`fire/${file}`));
const output = `// Generated from Expo src/assets by scripts/generate-artwork.mjs; do not edit.\nexport const icons = ${JSON.stringify(icons, null, 2)} as const;\nexport const fireFrames = ${JSON.stringify(frames, null, 2)};\n`;
const target = new URL("../src/styles/artwork.ts", import.meta.url);
if (process.argv.includes("--check")) {
  if (readFileSync(target, "utf8") !== output)
    throw new Error("Expo artwork is stale.");
} else writeFileSync(target, output);
