import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { compressWebAsset } from "./bin/compress-web-asset.mjs";
import react from "@vitejs/plugin-react-swc";
import { defineConfig, type Plugin, type ViteDevServer } from "vite";
import svgr from "vite-plugin-svgr";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// Vite only builds the public website; Expo owns the application.
const devContext = process.env.VITE_DEV_CONTEXT ?? (process.env.NODE_ENV === "test" ? "test" : "development");
const viteCacheDir = path.resolve(__dirname, "node_modules/.vite", "site", devContext);
const viteDevLockPath = path.join(viteCacheDir, "dev-server.pid");
const devServerPort = parsePort(process.env.VITE_DEV_SERVER_PORT, 5173);
const apiServerPort = parsePort(process.env.API_PORT, 4000);
const apiProxyTarget = process.env.VITE_API_PROXY_TARGET ?? `http://localhost:${apiServerPort}`;
const hmrPort = parsePort(process.env.VITE_HMR_PORT, devServerPort);

export function precompressBuildAssets(): Plugin {
  return {
    name: "precompress-build-assets",
    apply: "build",
    generateBundle: {
      order: "post",
      async handler(_options, bundle) {
        // Runtime HTML is rendered with deployment metadata. Only emitted static assets
        // receive siblings, and already-compressed images/fonts stay untouched.
        for (const output of Object.values(bundle)) {
          const source = Buffer.from(output.type === "chunk" ? output.code : output.source);
          for (const variant of await compressWebAsset(output.fileName, source)) {
            this.emitFile({ type: "asset", fileName: `${output.fileName}.${variant.extension}`, source: variant.data });
          }
        }
      },
    },
  };
}

function parsePort(value: string | undefined, fallback: number) {
  if (!value) return fallback;

  const port = Number(value);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`Invalid port value: ${value}`);
  }
  return port;
}

function processIsRunning(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function releaseDevLock() {
  try {
    if (fs.existsSync(viteDevLockPath) && fs.readFileSync(viteDevLockPath, "utf8") === String(process.pid)) {
      fs.rmSync(viteDevLockPath, { force: true });
    }
  } catch {
    // Best-effort cleanup; stale locks are checked on the next startup.
  }
}

export default defineConfig(({ command }) => ({
  root: "frontend/site",
  cacheDir: viteCacheDir,
  envDir: __dirname,
  envPrefix: ["VITE_", "VAPID_"],
  publicDir: command === "serve" ? path.resolve(__dirname, "public") : false,
  plugins: [
    svgr(),
    react(),
    precompressBuildAssets(),
    ...(command === "serve"
      ? [
          {
            name: "single-vite-dev-server",
            configureServer(server: ViteDevServer) {
              if (fs.existsSync(viteDevLockPath)) {
                const existingPid = Number(fs.readFileSync(viteDevLockPath, "utf8"));
                if (existingPid && existingPid !== process.pid && processIsRunning(existingPid)) {
                  throw new Error(
                    `Another Vite dev server is already running for this project (PID ${existingPid}). Stop it before starting a new one.`,
                  );
                }
              }

              fs.mkdirSync(viteCacheDir, { recursive: true });
              fs.writeFileSync(viteDevLockPath, String(process.pid));

              server.httpServer?.once("close", releaseDevLock);
              process.once("SIGINT", releaseDevLock);
              process.once("SIGTERM", releaseDevLock);
              process.once("exit", releaseDevLock);
            },
          },
          {
            name: "dev-request-logger",
            configureServer(server: ViteDevServer) {
              server.middlewares.use((req, res, next) => {
                const startedAt = Date.now();
                res.on("finish", () => {
                  const durationMs = Date.now() - startedAt;
                  if (req.url?.startsWith("/api")) {
                    return;
                  }
                  // eslint-disable-next-line no-console
                  console.log(
                    JSON.stringify({
                      event: "vite_request",
                      method: req.method,
                      path: req.url,
                      status: res.statusCode,
                      duration_ms: durationMs,
                    }),
                  );
                });
                next();
              });
            },
          },
        ]
      : []),
  ],
  build: {
    outDir: "../../public/site",
    emptyOutDir: true,
    manifest: true,
    rollupOptions: {
          input: {
            index: path.resolve(__dirname, "frontend/site/site.html"),
          },
        },
  },
  server: {
    host: true,
    port: devServerPort,
    strictPort: true,
    cors: {
      origin: ["http://192.168.5.121:3000", "http://localhost:3000"],
    },
    hmr: {
      host: process.env.VITE_HMR_HOST ?? "127.0.0.1",
      port: hmrPort,
    },
    proxy: {
      "/api/v1": {
        target: apiProxyTarget,
        changeOrigin: true,
      },
      "/socket.io": {
        target: apiProxyTarget,
        ws: true,
        changeOrigin: true,
      },
      "/hocuspocus": {
        target: apiProxyTarget,
        ws: true,
        changeOrigin: true,
      },
      "/api": {
        target: apiProxyTarget,
        changeOrigin: true,
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "frontend/site"),
      "react": path.resolve(__dirname, "node_modules/react"),
      "react-dom": path.resolve(__dirname, "node_modules/react-dom"),
    },
  },
}));
