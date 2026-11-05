import { ExpressAdapter } from "@nestjs/platform-express";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { createServer, request, type Server } from "node:http";
import os from "node:os";
import path from "node:path";
import { brotliCompressSync, brotliDecompressSync, gzipSync, gunzipSync } from "node:zlib";
import type { Request, Response } from "express";
import { CLIENT_BUILD_IMMUTABLE_ASSET_CACHE, setFrontendAssetCacheHeaders } from "@server/runtime/clientBuild";
import { precompressedFrontendAssets } from "@server/runtime/precompressedAssets";

describe("precompressed frontend assets over HTTP", () => {
  const source = Buffer.from('console.log("a meaningful application asset");\n'.repeat(100));
  const stylesheet = Buffer.from(".app { color: #222; background: #fff; }\n".repeat(100));
  const brotli = brotliCompressSync(source);
  const gzip = gzipSync(source);
  let root: string;
  let server: Server;
  let port: number;

  beforeAll(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "afire-static-http-"));
    const publicRoot = path.join(root, "public");
    const assets = path.join(publicRoot, "assets");
    await mkdir(assets, { recursive: true });
    const legacyRoot = path.join(root, "legacy-public");
    await mkdir(legacyRoot);
    await writeFile(path.join(legacyRoot, "manifest.json"), '{"name":"Legacy"}');
    await writeFile(path.join(legacyRoot, "legacy-only.txt"), 'legacy website asset');
    await writeFile(path.join(publicRoot, "manifest.json"), '{"name":"Expo-owned"}');
    await writeFile(path.join(publicRoot, "service-worker.js"), '/* Expo-owned worker */');
    await writeFile(path.join(legacyRoot, "service-worker.js"), '/* legacy worker */');
    const expo = path.join(publicRoot, "_expo/static/js/web");
    await mkdir(expo, { recursive: true });
    await Promise.all([
      writeFile(path.join(expo, "entry-123.js"), source),
      writeFile(path.join(expo, "entry-123.js.br"), brotli),
      writeFile(path.join(expo, "entry-123.js.gz"), gzip),
      writeFile(path.join(assets, "app-abc123.js"), source),
      writeFile(path.join(assets, "app-abc123.js.br"), brotli),
      writeFile(path.join(assets, "app-abc123.js.gz"), gzip),
      writeFile(path.join(assets, "style-abc123.css"), stylesheet),
      writeFile(path.join(assets, "style-abc123.css.br"), brotliCompressSync(stylesheet)),
      writeFile(path.join(assets, "old-build.js"), source),
      writeFile(path.join(assets, "orphan.js.br"), brotli),
      writeFile(path.join(assets, "image.png"), "original image"),
      writeFile(path.join(assets, "image.png.br"), brotli),
      writeFile(path.join(publicRoot, "index.html"), "<title>A Fire</title>"),
      writeFile(path.join(publicRoot, "index.html.br"), brotli),
      writeFile(path.join(root, "outside.js"), "outside the static root"),
      writeFile(path.join(assets, "unsafe-variant.js"), source),
    ]);
    await symlink(path.join(root, "outside.js"), path.join(assets, "unsafe.js"));
    await symlink(path.join(root, "outside.js"), path.join(assets, "unsafe-variant.js.br"));

    const adapter = new ExpressAdapter();
    adapter.use((_req: Request, res: Response, next: () => void) => { res.vary("Origin"); next(); });
    adapter.use(precompressedFrontendAssets(publicRoot));
    adapter.useStaticAssets(publicRoot, { index: false, setHeaders: setFrontendAssetCacheHeaders });
    adapter.useStaticAssets(legacyRoot, { index: false });
    adapter.get("/api/private.js", (_req: Request, res: Response) => {
      res.setHeader("Cache-Control", "private, no-cache, must-revalidate");
      res.send("private response");
    });
    server = createServer(adapter.getInstance());
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing HTTP test port");
    port = address.port;
  });

  afterAll(async () => {
    if (server) await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    if (root) await rm(root, { recursive: true, force: true });
  });

  it("serves Expo bundles through the same compression and immutable-cache owner", async () => {
    const response = await get("/_expo/static/js/web/entry-123.js", "br");
    expect(response.status).toBe(200);
    expect(response.headers["content-encoding"]).toBe("br");
    expect(response.headers["cache-control"]).toBe(CLIENT_BUILD_IMMUTABLE_ASSET_CACHE);
    expect(brotliDecompressSync(response.body)).toEqual(source);
  });

  it("serves the installed frontend's manifest and worker before legacy fallbacks", async () => {
    expect((await get('/manifest.json')).body.toString()).toBe('{"name":"Expo-owned"}');
    expect((await get('/service-worker.js')).body.toString()).toBe('/* Expo-owned worker */');
    expect((await get('/legacy-only.txt')).body.toString()).toBe('legacy website asset');
  });

  function get(url: string, encoding?: string, extraHeaders: Record<string, string> = {}, method = "GET") {
    return new Promise<{ status: number; headers: import("node:http").IncomingHttpHeaders; body: Buffer }>((resolve, reject) => {
      const req = request({
        host: "127.0.0.1", port, path: url, method,
        headers: { ...(encoding === undefined ? {} : { "Accept-Encoding": encoding }), ...extraHeaders },
      }, (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => resolve({ status: response.statusCode!, headers: response.headers, body: Buffer.concat(chunks) }));
        response.on("error", reject);
      });
      req.on("error", reject);
      req.end();
    });
  }

  it("serves compressed bytes with the original MIME, immutable cache, and combined Vary header", async () => {
    const response = await get("/assets/app-abc123.js?build=123", "br, gzip");
    expect(response.status).toBe(200);
    expect(response.headers["content-encoding"]).toBe("br");
    expect(response.headers["content-type"]).toMatch(/javascript/);
    expect(response.headers["content-length"]).toBe(String(brotli.length));
    expect(response.headers["cache-control"]).toBe(CLIENT_BUILD_IMMUTABLE_ASSET_CACHE);
    expect(response.headers.vary).toBe("Origin, Accept-Encoding");
    expect(brotliDecompressSync(response.body)).toEqual(source);
    const css = await get("/assets/style-abc123.css", "br");
    expect(css.headers["content-type"]).toMatch(/^text\/css/);
    expect(brotliDecompressSync(css.body)).toEqual(stylesheet);
  });

  it.each([
    ["gzip;q=1, br;q=0.5", "gzip"],
    ["br;q=0, gzip;q=0.8", "gzip"],
    ["gzip;q=0, br;q=0.8", "br"],
    ["*;q=0.8, identity;q=0", "br"],
    ["gzip;q=0.5, identity;q=1", undefined],
    ["br;q=0, gzip;q=0", undefined],
    ["unknown", undefined],
    ["", undefined],
    [undefined, undefined],
  ])("respects Accept-Encoding %s", async (accept, expected) => {
    const response = await get("/assets/app-abc123.js", accept);
    expect(response.status).toBe(200);
    expect(response.headers["content-encoding"]).toBe(expected);
    const decoded = expected === "br" ? brotliDecompressSync(response.body) : expected === "gzip" ? gunzipSync(response.body) : response.body;
    expect(decoded).toEqual(source);
    expect(response.headers["cache-control"]).toBe(CLIENT_BUILD_IMMUTABLE_ASSET_CACHE);
    expect(response.headers.vary).toContain("Accept-Encoding");
  });

  it("returns 406 when no available representation is acceptable, including identity", async () => {
    for (const accept of ["br;q=0, gzip;q=0, identity;q=0", "*;q=0", "unknown, identity;q=0"]) {
      const response = await get("/assets/app-abc123.js", accept);
      expect(response.status).toBe(406);
      expect(response.headers["content-encoding"]).toBeUndefined();
    }
    expect((await get("/assets/old-build.js", "br, identity;q=0")).status).toBe(406);
  });

  it("supports HEAD and conditional requests with representation-specific ETags", async () => {
    const first = await get("/assets/app-abc123.js", "br");
    expect(first.headers.etag).toBeTruthy();
    const head = await get("/assets/app-abc123.js", "br", {}, "HEAD");
    expect(head.status).toBe(200);
    expect(head.body.length).toBe(0);
    expect(head.headers["content-encoding"]).toBe("br");
    expect(head.headers["content-length"]).toBe(first.headers["content-length"]);
    expect(head.headers.etag).toBe(first.headers.etag);
    const cached = await get("/assets/app-abc123.js", "br", { "If-None-Match": first.headers.etag! });
    expect(cached.status).toBe(304);
    expect(cached.body.length).toBe(0);
    expect(cached.headers.vary).toContain("Accept-Encoding");
    const different = await get("/assets/app-abc123.js", "gzip", { "If-None-Match": first.headers.etag! });
    expect(different.status).toBe(200);
    expect(different.headers.etag).not.toBe(first.headers.etag);
  });

  it("preserves uncompressed builds, missing assets, non-GET methods, HTML, images, and API policy", async () => {
    const legacy = await get("/assets/old-build.js", "br, gzip");
    expect(legacy.status).toBe(200);
    expect(legacy.body).toEqual(source);
    expect(legacy.headers["content-encoding"]).toBeUndefined();
    expect((await get("/assets/orphan.js", "br")).status).toBe(404);
    expect((await get("/assets/missing.js", "br")).status).toBe(404);
    expect((await get("/assets/app-abc123.js", "br", {}, "POST")).status).toBe(404);
    const html = await get("/index.html", "br");
    expect(html.body.toString()).toBe("<title>A Fire</title>");
    expect(html.headers["content-encoding"]).toBeUndefined();
    const image = await get("/assets/image.png", "br");
    expect(image.body.toString()).toBe("original image");
    expect(image.headers["content-encoding"]).toBeUndefined();
    const api = await get("/api/private.js", "br");
    expect(api.body.toString()).toBe("private response");
    expect(api.headers["content-encoding"]).toBeUndefined();
    expect(api.headers["cache-control"]).toBe("private, no-cache, must-revalidate");
    expect(api.headers.vary).toBe("Origin");
  });

  it.each(["/assets/../outside.js", "/assets/%2e%2e/outside.js", "/assets/%2e%2e%2foutside.js", "/assets/..%5coutside.js", "/assets/%00.js", "/assets/%zz.js"])(
    "rejects an unsafe request path %s", async (url) => {
      const response = await get(url, "br");
      expect(response.status).toBe(400);
      expect(response.headers["content-encoding"]).toBeUndefined();
      expect(response.body.toString()).not.toContain("outside the static root");
    },
  );

  it("does not follow assets or compressed siblings outside the static asset root", async () => {
    expect((await get("/assets/unsafe.js", "br")).status).toBe(404);
    const safe = await get("/assets/unsafe-variant.js", "br");
    expect(safe.status).toBe(200);
    expect(safe.body).toEqual(source);
    expect(safe.headers["content-encoding"]).toBeUndefined();
    expect((await get("/assets/unsafe-variant.js", "br, identity;q=0")).status).toBe(406);
  });
});
