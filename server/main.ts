import "reflect-metadata";
import path from "node:path";
import type { Request, Response, NextFunction } from "express";
import type { RequestWithUser } from "./api/v1/auth/auth.guard";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { IoAdapter } from "@nestjs/platform-socket.io";
import { AppModule } from "./app.module";
import { RequestIdInterceptor } from "./logging/request-id.interceptor";
import { LoggingInterceptor } from "./logging/logging.interceptor";
import { ensureDatabaseUrl } from "./runtime/env";
import { loadEnv } from "./runtime/loadEnv";
import { getPosthogClient, shutdownPosthog } from "./runtime/posthog";
import { installShutdownHandlers, drainHttpServer } from "./runtime/shutdown";
import { BossService } from "./queue/boss.service";
import { RealtimeService } from "./realtime/realtime.service";
import { HocuspocusService } from "./realtime/hocuspocus.service";
import { renderFrontendIndexHtml } from "./runtime/frontendIndex";
import { resolveStartupTimeoutMs, withStartupTimeout } from "./runtime/startupTimeout";
import { precompressedFrontendAssets } from "./runtime/precompressedAssets";
import {
  readClientBuildMetadata,
  sendClientBuildResponse,
  setFrontendAssetCacheHeaders,
  setFrontendHtmlCacheHeaders,
} from "./runtime/clientBuild";

const DEFAULT_PORT = 4000;

async function bootstrap(): Promise<void> {
  loadEnv();
  ensureDatabaseUrl();
  getPosthogClient();

  const app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: ["error", "warn", "log"] });
  app.set("trust proxy", true);
  app.use((req: RequestWithUser, res: Response, next: NextFunction) => {
    const startedAt = Date.now();
    res.on("finish", () => {
      const durationMs = Date.now() - startedAt;
      // eslint-disable-next-line no-console
      console.log(
        JSON.stringify({
          event: "http_request",
          method: req.method,
          path: req.originalUrl,
          request_id: req.requestId ?? null,
          session_id: req.sessionId ?? null,
          status: res.statusCode,
          duration_ms: durationMs,
        }),
      );
    });
    next();
  });
  app.useWebSocketAdapter(new IoAdapter(app));
  app.enableCors({
    origin: true,
    credentials: true,
  });
  app.useGlobalInterceptors(new RequestIdInterceptor(), new LoggingInterceptor());
  const port = Number(process.env.API_PORT ?? DEFAULT_PORT);

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const publicRoot = path.resolve(process.cwd(), "public");
  const frontendRoot = path.join(publicRoot, "frontend");
  const frontendIndex = path.join(frontendRoot, "index.html");
  const hasFrontendBuild = existsSync(frontendRoot) && existsSync(frontendIndex);
  const clientBuildMetadata = hasFrontendBuild ? readClientBuildMetadata(frontendRoot) : null;

  // The installed frontend owns its public assets. Legacy root assets are a
  // fallback for builds that do not supply their own manifest/icons/worker.
  if (hasFrontendBuild) {
    app.use(precompressedFrontendAssets(frontendRoot));
    app.useStaticAssets(frontendRoot, { index: false, setHeaders: setFrontendAssetCacheHeaders });
  }

  if (existsSync(publicRoot)) {
    app.useStaticAssets(publicRoot, { index: false });
    const httpAdapter = app.getHttpAdapter().getInstance();
    const manifestPath = path.join(publicRoot, "manifest.json");
    httpAdapter.get("/manifest.json", (_req: Request, res: Response) => {
      if (!existsSync(manifestPath)) {
        res.status(404).end();
        return;
      }
      res.sendFile(manifestPath);
    });
    httpAdapter.get("/api/client-build", (_req: Request, res: Response) => sendClientBuildResponse(res, clientBuildMetadata));
  }

  if (hasFrontendBuild) {
    const frontendIndexHtml = readFileSync(frontendIndex, "utf8");
    const sendFrontendIndex = (_req: Request, res: Response) => {
      setFrontendHtmlCacheHeaders(res);
      res.type("html").send(renderFrontendIndexHtml(frontendIndexHtml, process.env, { buildId: clientBuildMetadata?.buildId }));
    };

    const httpAdapter = app.getHttpAdapter().getInstance();
    httpAdapter.get(["/", "/app", "/auth"], sendFrontendIndex);
    httpAdapter.get(["/app/*path", "/auth/*path"], sendFrontendIndex);
  }

  const hocuspocus = app.get(HocuspocusService);
  hocuspocus.attach(app.getHttpServer());
  installShutdownHandlers(async () => {
    try {
      const httpClosed = drainHttpServer(app.getHttpServer());
      app.get(RealtimeService).disconnectAll();
      await Promise.all([httpClosed, hocuspocus.drain()]);
      await app.get(BossService).onModuleDestroy();
      await app.close();
    } finally { await shutdownPosthog(); }
  });
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`API listening on ${port}`);
}

withStartupTimeout(bootstrap(), { label: "API startup", timeoutMs: resolveStartupTimeoutMs() }).catch((error) => {
  console.error(error);
  process.exit(1);
});
