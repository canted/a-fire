import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const smoke = await import(pathToFileURL(path.resolve("bin/server-smoke")).href);

describe("server-smoke", () => {
  const originalFlyAppName = process.env.FLY_APP_NAME;
  const originalFlyConfig = process.env.FLY_CONFIG;
  const originalSmokeBaseUrl = process.env.SMOKE_BASE_URL;
  const originalSmokeRequireVapid = process.env.SMOKE_REQUIRE_VAPID;

  beforeEach(() => {
    delete process.env.FLY_APP_NAME;
    delete process.env.FLY_CONFIG;
    delete process.env.SMOKE_BASE_URL;
    delete process.env.SMOKE_REQUIRE_VAPID;
  });

  afterEach(() => {
    restoreEnv("FLY_APP_NAME", originalFlyAppName);
    restoreEnv("FLY_CONFIG", originalFlyConfig);
    restoreEnv("SMOKE_BASE_URL", originalSmokeBaseUrl);
    restoreEnv("SMOKE_REQUIRE_VAPID", originalSmokeRequireVapid);
  });

  it("parses Fly deploy app and config arguments", () => {
    process.env.SMOKE_BASE_URL = "https://env.example.test";

    expect(smoke.parseSmokeArgs(["--app", "stage-app", "--config=fly.stage.toml"])).toEqual({
      app: "stage-app",
      baseUrl: "https://env.example.test",
      configPath: "fly.stage.toml",
    });
  });

  it("builds a base URL from an explicit URL, app argument, or Fly config", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "server-smoke-"));
    const configPath = path.join(tempDir, "fly.toml");
    fs.writeFileSync(configPath, 'app = "config-app"\n', "utf8");

    try {
      expect(smoke.smokeBaseUrl({ baseUrl: "https://example.test/" })).toBe("https://example.test");
      expect(smoke.smokeBaseUrl({ app: "stage-app" })).toBe("https://stage-app.fly.dev");
      expect(smoke.smokeBaseUrl({ configPath })).toBe("https://config-app.fly.dev");
    } finally {
      fs.rmSync(tempDir, { force: true, recursive: true });
    }
  });

  it("requires healthy database and VAPID configuration by default", () => {
    expect(smoke.healthFailures({ status: "ok", db: "ok", vapid: "missing" })).toEqual(["vapid=missing"]);
    expect(smoke.healthFailures({ status: "ok", db: "ok", vapid: "missing" }, { requireVapid: false })).toEqual([]);
    expect(smoke.healthFailures({ status: "bad", db: "missing", vapid: "missing" })).toEqual([
      "status=bad",
      "db=missing",
      "vapid=missing",
    ]);
  });
});

function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[key];
    return;
  }
  process.env[key] = value;
}
