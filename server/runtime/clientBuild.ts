import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

type HeaderResponse = {
  setHeader: (name: string, value: string) => void;
};

type JsonResponse = HeaderResponse & {
  json: (body: ClientBuildResponse) => unknown;
};

type ViteManifestEntry = {
  file?: unknown;
  css?: unknown;
  isEntry?: unknown;
};

type ViteManifest = Record<string, ViteManifestEntry>;

export type ClientBuildMetadata = {
  buildId: string;
  assets: string[];
};

export type ClientBuildResponse = {
  buildId: string | null;
  checkedAt: number;
};

export const CLIENT_BUILD_NO_STORE = "no-store, max-age=0";
export const CLIENT_BUILD_HTML_CACHE = "no-cache, must-revalidate";
export const CLIENT_BUILD_IMMUTABLE_ASSET_CACHE = "public, max-age=31536000, immutable";

export function readClientBuildMetadata(frontendRoot: string): ClientBuildMetadata | null {
  const expoMetadataPath = path.join(frontendRoot, "client-build.json");
  if (existsSync(expoMetadataPath)) {
    try {
      const metadata = JSON.parse(readFileSync(expoMetadataPath, "utf8")) as Partial<ClientBuildMetadata>;
      if (typeof metadata.buildId === "string" && /^[a-f0-9]{16}$/.test(metadata.buildId) && Array.isArray(metadata.assets) && metadata.assets.length > 0 && metadata.assets.every(asset => typeof asset === "string" && !asset.startsWith("/") && !asset.includes("\\") && !asset.split("/").includes("..") && /\.(?:js|css)$/.test(asset))) return metadata as ClientBuildMetadata;
      return null;
    } catch { return null; }
  }
  const manifestPath = path.join(frontendRoot, ".vite", "manifest.json");
  if (!existsSync(manifestPath)) return null;

  try {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as ViteManifest;
    return clientBuildMetadataFromManifest(manifest);
  } catch {
    return null;
  }
}

export function clientBuildMetadataFromManifest(manifest: ViteManifest): ClientBuildMetadata | null {
  const entry = manifest["index.html"] ?? Object.values(manifest).find((candidate) => candidate?.isEntry === true);
  if (!entry || typeof entry.file !== "string" || !entry.file.trim()) return null;

  const css = Array.isArray(entry.css) ? entry.css.filter((asset): asset is string => typeof asset === "string") : [];
  const assets = [entry.file, ...css].filter((asset) => asset.trim().length > 0);
  if (assets.length === 0) return null;

  return {
    assets,
    buildId: createHash("sha256").update(assets.join("\n")).digest("hex").slice(0, 16),
  };
}

export function clientBuildResponse(metadata: ClientBuildMetadata | null, checkedAt = Date.now()): ClientBuildResponse {
  return { buildId: metadata?.buildId ?? null, checkedAt };
}

export function setClientBuildNoStoreHeaders(response: HeaderResponse): void {
  response.setHeader("Cache-Control", CLIENT_BUILD_NO_STORE);
}

export function sendClientBuildResponse(response: JsonResponse, metadata: ClientBuildMetadata | null): unknown {
  setClientBuildNoStoreHeaders(response);
  return response.json(clientBuildResponse(metadata));
}

export function setFrontendHtmlCacheHeaders(response: HeaderResponse): void {
  response.setHeader("Cache-Control", CLIENT_BUILD_HTML_CACHE);
}

export function setFrontendAssetCacheHeaders(response: HeaderResponse, filePath: string): void {
  if (!filePath.includes(`${path.sep}assets${path.sep}`) && !filePath.includes(`${path.sep}_expo${path.sep}static${path.sep}`)) return;
  response.setHeader("Cache-Control", CLIENT_BUILD_IMMUTABLE_ASSET_CACHE);
}
