import {
  cpSync,
  writeFileSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { expect, it } from "vitest";

const expo = path.resolve("frontend");
function sources(folder: string): string[] {
  return readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(folder, entry.name);
    return entry.isDirectory()
      ? sources(file)
      : /\.(?:ts|tsx|css|mjs|cjs)$/.test(file)
        ? [file]
        : [];
  });
}

it("keeps Expo style and visual asset references inside the replacement frontend", () => {
  const violations: string[] = [];
  for (const file of [
    ...sources(path.join(expo, "src")),
    ...sources(path.join(expo, ".storybook")),
    ...sources(path.join(expo, "scripts")),
    path.join(expo, "metro.config.cjs"),
  ]) {
    for (const match of readFileSync(file, "utf8").matchAll(
      /["'](\.[^"'\n]+)["']/g,
    )) {
      const target = path.resolve(path.dirname(file), match[1]);
      const legacyVisual =
        /\/frontend\/(?:styles|icons|animations)\//.test(`${target}/`) ||
        /\/frontend\/features\/.*\/assets\//.test(target);
      if (legacyVisual)
        violations.push(`${path.relative(expo, file)} -> ${match[1]}`);
    }
  }
  expect(violations).toEqual([]);
});

it("regenerates tokens and artwork without any legacy frontend present", () => {
  const isolated = mkdtempSync(path.join(tmpdir(), "afire-expo-styles-"));
  try {
    for (const folder of ["scripts", "src/styles", "src/assets"]) {
      cpSync(path.join(expo, folder), path.join(isolated, folder), {
        recursive: true,
      });
    }
    for (const generator of ["generate-tokens.mjs", "generate-artwork.mjs"]) {
      execFileSync(
        process.execPath,
        [path.join(isolated, "scripts", generator), "--check"],
        { cwd: isolated },
      );
    }
  } finally {
    rmSync(isolated, { recursive: true, force: true });
  }
});

it("rejects importing the public website runtime into the application", () => {
  const isolated = mkdtempSync(path.join(tmpdir(), "afire-app-boundary-"));
  try {
    for (const folder of ["scripts", "src/styles"]) {
      cpSync(path.join(expo, folder), path.join(isolated, folder), { recursive: true });
    }
    cpSync(path.join(expo, "app.json"), path.join(isolated, "app.json"));
    writeFileSync(path.join(isolated, "src", "regression.ts"), 'import { Button } from "../site/components/Button";');
    expect(() => execFileSync(process.execPath, [path.join(isolated, "scripts/check-boundaries.mjs")], { stdio: "pipe" }))
      .toThrow(/public website runtime dependency/);
  } finally {
    rmSync(isolated, { recursive: true, force: true });
  }
});
