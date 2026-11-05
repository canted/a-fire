import path from "node:path";
import { pathToFileURL } from "node:url";

const stage = await import(pathToFileURL(path.resolve("bin/stage")).href);

describe("stage script helpers", () => {
  it("uses safe defaults for the staging app and shared MPG cluster", () => {
    expect(stage.stageConfig({})).toEqual({
      app: "afire-staging",
      configPath: "fly.staging.toml",
      database: "afiredb_staging",
      databaseUser: "fly-user",
      downMode: "stop",
      mpgCluster: "gjpkdonm45d0yln4",
      org: "",
      secretsFile: ".env.staging",
    });
  });

  it("filters reserved and placeholder secrets before Fly import", () => {
    expect(
      stage.secretsForImport(`
DATABASE_URL=postgres://prod
JWT_SECRET=real-secret
VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=change-me
BREVO_SMTP_SERVER=smtp.example.test
`),
    ).toBe("JWT_SECRET=real-secret\nBREVO_SMTP_SERVER=smtp.example.test\n");
  });

  it("passes only public frontend values as Docker build args", () => {
    expect(
      stage.buildArgsFromEnv({
        JWT_SECRET: "private",
        VITE_API_BASE_URL: "/api",
        VITE_POSTHOG_KEY: "public-key",
      }),
    ).toEqual(["--build-arg", "VITE_API_BASE_URL=/api", "--build-arg", "VITE_POSTHOG_KEY=public-key"]);
  });

  it("forwards the Expo endpoint and ignores the retired frontend selector", () => {
    expect(stage.buildArgsFromEnv({ AFIRE_FRONTEND: "expo", EXPO_PUBLIC_API_URL: "https://stage.example.test/api", DATABASE_URL: "private", VAPID_PRIVATE_KEY: "private" })).toEqual([
      "--build-arg", "EXPO_PUBLIC_API_URL=https://stage.example.test/api",
    ]);
  });

  it("parses refresh-db arguments with an explicit destructive confirmation", () => {
    expect(stage.parseRefreshDbArgs(["--yes", "/tmp/prod.dump"], {})).toEqual({
      dumpFile: "/tmp/prod.dump",
      help: false,
      yes: true,
    });
    expect(stage.parseRefreshDbArgs(["/tmp/prod.dump"], { STAGE_REFRESH_YES: "1" })).toEqual({
      dumpFile: "/tmp/prod.dump",
      help: false,
      yes: true,
    });
  });

  it("builds pg_restore args for a SQL stream into Fly MPG connect", () => {
    expect(stage.pgRestoreArgs("/tmp/prod.dump", ["--use-list", "/tmp/restore.list"])).toEqual([
      "--clean",
      "--if-exists",
      "--no-owner",
      "--no-acl",
      "--no-comments",
      "--no-publications",
      "--no-subscriptions",
      "--single-transaction",
      "--exit-on-error",
      "--use-list",
      "/tmp/restore.list",
      "--file",
      "-",
      "/tmp/prod.dump",
    ]);
  });

  it("keeps refresh-db pointed at staging-looking targets by default", () => {
    expect(stage.isSafeStageRefreshTarget({ app: "afire-staging", database: "afiredb_staging" }, {})).toBe(true);
    expect(stage.isSafeStageRefreshTarget({ app: "afire", database: "afiredb" }, {})).toBe(false);
    expect(
      stage.isSafeStageRefreshTarget({ app: "afire", database: "afiredb" }, { ALLOW_STAGE_REFRESH_ANY_DB: "1" }),
    ).toBe(true);
  });

  it("scrubs account identifiers and delivery state after restoring a production dump", () => {
    const sql = stage.stageScrubSql();

    expect(sql).toContain("DELETE FROM public.push_subscriptions");
    expect(sql).toContain("DELETE FROM public.one_time_tokens");
    expect(sql).toContain("DROP SCHEMA IF EXISTS pgboss CASCADE");
    expect(sql).toContain("stage-user-");
    expect(sql).toContain("@example.invalid");
    expect(sql).toContain("push_enabled = false");
  });

  it("drops pg-boss before restore so inherited queue constraints do not block clean restore", () => {
    expect(stage.stagePreRestoreSql()).toBe("DROP SCHEMA IF EXISTS pgboss CASCADE;\n");
  });

  it("filters Fly-managed archive entries from restored production dumps", () => {
    expect(stage.isSkippedArchiveEntry("1; 2615 123 SCHEMA - pgboss owner")).toBe(true);
    expect(stage.isSkippedArchiveEntry("2; 1259 456 TABLE pgboss job owner")).toBe(true);
    expect(stage.isSkippedArchiveEntry("3; 2606 789 CONSTRAINT pgboss job job_pkey owner")).toBe(true);
    expect(stage.isSkippedArchiveEntry("4; 1255 234 FUNCTION pgbouncer get_auth(text) owner")).toBe(true);
    expect(stage.isSkippedArchiveEntry("5; 2615 345 SCHEMA - pgbouncer owner")).toBe(true);
    expect(stage.isSkippedArchiveEntry("6; 1247 456 TYPE pgboss job_state owner")).toBe(true);
    expect(stage.isSkippedArchiveEntry("4; 1259 101 TABLE public users owner")).toBe(false);
  });

  it("parses Fly secret names from JSON output", () => {
    expect(
      Array.from(
        stage.secretNamesFromFlyListJson(
          JSON.stringify([
            { name: "DATABASE_URL", digest: "abc", status: "Staged" },
            { name: "JWT_SECRET", digest: "def", status: "Deployed" },
          ]),
        ),
      ),
    ).toEqual(["DATABASE_URL", "JWT_SECRET"]);
  });

  it("plans staging Machine actions and only toggles autostart for app Machines", () => {
    expect(
      stage.stageMachinePlan([
        { id: "app-running", state: "started", process_group: "app" },
        { id: "app-stopped", state: "stopped", processGroup: "app" },
        { id: "app-starting", state: "starting", config: { env: { FLY_PROCESS_GROUP: "app" } } },
        { id: "worker-started", state: "started", process_group: "worker" },
        { id: "worker-stopped", state: "stopped", config: { metadata: { fly_process_group: "worker" } } },
        { id: "worker-suspended", state: "suspended", ProcessGroup: "worker" },
        { id: "old-machine", state: "destroyed", process_group: "app" },
      ]),
    ).toEqual({
      startIds: ["app-stopped", "worker-stopped", "worker-suspended"],
      shutdownIds: ["app-running", "app-starting", "worker-started", "worker-suspended"],
      autostartIds: ["app-running", "app-stopped", "app-starting"],
    });
  });
});
