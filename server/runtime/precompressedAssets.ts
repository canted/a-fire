import { realpath, stat } from "node:fs/promises";
import path from "node:path";
import type { RequestHandler } from "express";
import { setFrontendAssetCacheHeaders } from "./clientBuild";

async function existingFile(filePath: string): Promise<string | null> {
  try {
    const resolved = await realpath(filePath);
    return (await stat(resolved)).isFile() ? resolved : null;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") return null;
    throw error;
  }
}

/** Negotiate prebuilt representations of public build assets, never API or media responses. */
export function precompressedFrontendAssets(frontendRoot: string): RequestHandler {
  return async (req, res, next) => {
    const prefix = req.path.startsWith("/assets/") ? "assets" : req.path.startsWith("/_expo/static/") ? "_expo/static" : null;
    if ((req.method !== "GET" && req.method !== "HEAD") || !prefix) {
      next();
      return;
    }

    let pathname: string;
    try {
      pathname = decodeURIComponent(req.path);
    } catch {
      res.status(400).end();
      return;
    }
    const segments = pathname.slice(1).split("/");
    if (pathname.includes("\\") || pathname.includes("\0") || segments.some((segment) => segment.startsWith("."))) {
      res.status(400).end();
      return;
    }
    if (!/\.(?:js|mjs|css|svg|json|txt|xml|wasm)$/.test(pathname)) {
      next();
      return;
    }

    try {
      const originalPath = path.join(frontendRoot, ...segments);
      const original = await existingFile(originalPath);
      if (!original) {
        next();
        return;
      }
      const assetsRoot = path.join(await realpath(frontendRoot), prefix) + path.sep;
      if (!original.startsWith(assetsRoot)) {
        res.status(404).end();
        return;
      }
      const siblings = await Promise.all([existingFile(`${originalPath}.br`), existingFile(`${originalPath}.gz`)]);
      const representations = new Map<string, string>();
      for (const [index, encoding] of ["br", "gzip"].entries()) {
        const sibling = siblings[index];
        if (sibling?.startsWith(assetsRoot)) representations.set(encoding, sibling);
      }
      res.vary("Accept-Encoding");
      const encoding = req.acceptsEncodings([...representations.keys(), "identity"]);
      if (!encoding) {
        res.status(406).end();
        return;
      }
      if (encoding === "identity") {
        next();
        return;
      }

      res.type(path.extname(originalPath));
      res.setHeader("Content-Encoding", encoding);
      setFrontendAssetCacheHeaders(res, originalPath);
      // sendFile retains Express's HEAD, conditional requests, representation-specific
      // ETags, content length, and range behavior for the selected bytes.
      res.sendFile(representations.get(encoding)!, (error) => {
        if (!error) return;
        if (!res.headersSent) {
          res.removeHeader("Content-Encoding");
          res.removeHeader("Content-Type");
          res.removeHeader("Cache-Control");
        }
        next(error);
      });
    } catch (error) {
      next(error);
    }
  };
}
