import { compressWebAsset } from "../../../bin/compress-web-asset.mjs";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { brotliDecompressSync, gunzipSync } from "node:zlib";
import { build } from "vite";
import { precompressBuildAssets } from "../../../vite.config";

describe("precompressed production build", () => {
  it("emits smaller Brotli/gzip siblings for static text while preserving sources and excluding HTML/media", async () => {
    const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "afire-static-build-")));
    try {
      await writeFile(path.join(root, "index.html"), '<script type="module" src="/entry.js"></script>');
      const entries = Array.from({ length: 100 }, (_, index) => `Meaningful project entry ${index}`);
      await writeFile(path.join(root, "entry.js"), `import "./style.css"; console.log(${JSON.stringify(entries)});`);
      const css = Array.from({ length: 100 }, (_, index) => `.entry-${index} { color: #222; background: #fff; }`).join("\n");
      await writeFile(path.join(root, "style.css"), css);
      const result = await build({
        configFile: false, root, publicDir: false, logLevel: "silent",
        plugins: [
          {
            name: "representative-test-assets",
            generateBundle() {
              this.emitFile({ type: "asset", fileName: "assets/tiny.css", source: "body {}" });
              this.emitFile({ type: "asset", fileName: "assets/image.png", source: "image".repeat(500) });
              this.emitFile({ type: "asset", fileName: "runtime.html", source: "html".repeat(500) });
            },
          },
          precompressBuildAssets(),
        ],
        build: { write: false, minify: false },
      });
      if (Array.isArray(result) || !("output" in result)) throw new Error("Expected a single Vite build output");
      const assets = new Map(result.output.map((output) => [output.fileName, Buffer.from(output.type === "chunk" ? output.code : output.source)]));
      const generatedAssets = [...assets.entries()].filter(([name]) => /^assets\/index-.+\.(js|css)$/.test(name));
      expect(generatedAssets).toHaveLength(2);
      for (const [name, source] of generatedAssets) {
        const brotli = assets.get(`${name}.br`)!;
        const gzip = assets.get(`${name}.gz`)!;
        expect(brotliDecompressSync(brotli)).toEqual(source);
        expect(gunzipSync(gzip)).toEqual(source);
        expect(brotli.length).toBeLessThan(source.length);
        expect(gzip.length).toBeLessThan(source.length);
      }
      for (const original of ["assets/tiny.css", "assets/image.png", "runtime.html", "index.html"]) {
        expect(assets.has(original)).toBe(true);
        expect(assets.has(`${original}.br`)).toBe(false);
        expect(assets.has(`${original}.gz`)).toBe(false);
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

it("applies the same compression policy to Expo static bundles only", async () => {
  const source = Buffer.from("const meaningfulApplicationData = 1;\n".repeat(100));
  const variants = await compressWebAsset("_expo/static/js/web/entry-123.js", source);
  expect(variants.map(variant => variant.extension)).toEqual(["br", "gz"]);
  expect(brotliDecompressSync(variants[0].data)).toEqual(source);
  expect(gunzipSync(variants[1].data)).toEqual(source);
  for (const name of ["index.html", "api/private.js", "_expo/static/image.png", "service-worker.js"]) expect(await compressWebAsset(name, source)).toEqual([]);
});
