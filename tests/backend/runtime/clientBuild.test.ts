import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  CLIENT_BUILD_IMMUTABLE_ASSET_CACHE,
  CLIENT_BUILD_NO_STORE,
  clientBuildMetadataFromManifest,
  readClientBuildMetadata,
  sendClientBuildResponse,
  setFrontendAssetCacheHeaders,
} from "@server/runtime/clientBuild";

describe("runtime/clientBuild", () => {
  it("derives build metadata from Vite entry assets", () => {
    const metadata = clientBuildMetadataFromManifest({
      "index.html": {
        file: "assets/index-CcPAyxCH.js",
        css: ["assets/index-C454CixU.css"],
        isEntry: true,
      },
    });

    const expectedBuildId = createHash("sha256")
      .update("assets/index-CcPAyxCH.js\nassets/index-C454CixU.css")
      .digest("hex")
      .slice(0, 16);

    expect(metadata).toEqual({
      assets: ["assets/index-CcPAyxCH.js", "assets/index-C454CixU.css"],
      buildId: expectedBuildId,
    });
  });

  it("returns null when the manifest is missing or malformed", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "afire-client-build-"));

    try {
      expect(readClientBuildMetadata(root)).toBeNull();

      mkdirSync(path.join(root, ".vite"), { recursive: true });
      writeFileSync(path.join(root, ".vite", "manifest.json"), "{");
      expect(readClientBuildMetadata(root)).toBeNull();

      writeFileSync(path.join(root, ".vite", "manifest.json"), JSON.stringify({ "index.html": { css: [] } }));
      expect(readClientBuildMetadata(root)).toBeNull();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("sends no-store build metadata responses", () => {
    const setHeader = vi.fn();
    const json = vi.fn();

    sendClientBuildResponse(
      { setHeader, json },
      { buildId: "build-1", assets: ["assets/index.js"] },
    );

    expect(setHeader).toHaveBeenCalledWith("Cache-Control", CLIENT_BUILD_NO_STORE);
    expect(json).toHaveBeenCalledWith({
      buildId: "build-1",
      checkedAt: expect.any(Number),
    });
  });

  it("marks hashed frontend assets immutable", () => {
    const response = { setHeader: vi.fn() };

    setFrontendAssetCacheHeaders(response, path.join("public", "frontend", "assets", "index-abcd.js"));

    expect(response.setHeader).toHaveBeenCalledWith("Cache-Control", CLIENT_BUILD_IMMUTABLE_ASSET_CACHE);
  });
});

it("reads Expo release metadata and rejects malformed asset paths", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "afire-expo-build-"));
  try {
    const metadata = { buildId: "0123456789abcdef", assets: ["_expo/static/js/web/entry-abc.js"] };
    writeFileSync(path.join(root, "client-build.json"), JSON.stringify(metadata));
    expect(readClientBuildMetadata(root)).toEqual(metadata);
    writeFileSync(path.join(root, "client-build.json"), JSON.stringify({ ...metadata, assets: ["../secret.js"] }));
    expect(readClientBuildMetadata(root)).toBeNull();
    const response = { setHeader: vi.fn() };
    setFrontendAssetCacheHeaders(response, path.join(root, "_expo/static/js/web/entry-abc.js"));
    expect(response.setHeader).toHaveBeenCalledWith("Cache-Control", CLIENT_BUILD_IMMUTABLE_ASSET_CACHE);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
