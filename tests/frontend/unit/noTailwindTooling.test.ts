import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const projectRoot = process.cwd();

function findCssFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.name === 'node_modules' || entry.name === '.expo' ||
      ['ios', 'android', 'dist'].some(name => path === resolve(projectRoot, 'frontend', name))) return [];
    if (entry.isDirectory()) return findCssFiles(path);
    return entry.isFile() && entry.name.endsWith(".css") ? [path] : [];
  });
}

describe("frontend styling toolchain", () => {
  it("keeps Tailwind out of runtime and build configuration", () => {
    for (const manifest of ['package.json', 'frontend/package.json']) {
      const packageJson = JSON.parse(readFileSync(resolve(projectRoot, manifest), "utf8")) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      const installedPackages = {
        ...packageJson.dependencies,
        ...packageJson.devDependencies,
      };

      expect(Object.keys(installedPackages).filter((name) => name.includes("tailwind"))).toEqual([]);
    }
    expect(existsSync(resolve(projectRoot, "tailwind.config.cjs"))).toBe(false);
    expect(existsSync(resolve(projectRoot, "components.json"))).toBe(false);

    for (const relativePath of ["vite.config.ts", "postcss.config.cjs", "frontend/site/styles/index.css"]) {
      const source = readFileSync(resolve(projectRoot, relativePath), "utf8");
      expect(source.toLowerCase(), relativePath).not.toContain("tailwind");
    }

    for (const cssFile of findCssFiles(resolve(projectRoot, "frontend"))) {
      const source = readFileSync(cssFile, "utf8");
      expect(source, cssFile).not.toMatch(/@(?:apply|config|source|tailwind|theme)\b|--tw-/);
    }
  });
});
