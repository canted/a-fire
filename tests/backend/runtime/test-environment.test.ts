import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { resolveTestEnvironment } from "@server/runtime/test-environment.mjs";

const directories: string[] = [];
function fixture(files: Record<string, string> = {}) {
  const cwd = mkdtempSync(path.join(tmpdir(), "afire-test-env-"));
  directories.push(cwd);
  for (const [name, contents] of Object.entries(files)) writeFileSync(path.join(cwd, name), contents);
  return cwd;
}
afterEach(() => directories.splice(0).forEach((cwd) => rmSync(cwd, { recursive: true, force: true })));

describe("test database isolation", () => {
  it("uses the test file instead of an inherited development database", () => {
    const result = resolveTestEnvironment({
      cwd: fixture({ ".env": "DATABASE_URL=postgres://localhost/afire", ".env.test": "DATABASE_URL=postgres://localhost/afire_test" }),
      env: { DATABASE_URL: "postgres://localhost/afire", NODE_ENV: "development" },
      requireDatabase: true,
    });
    expect(result.DATABASE_URL).toBe("postgres://localhost/afire_test");
    expect(result.NODE_ENV).toBe("test");
  });

  it("preserves an explicit test target through child processes and runtime reloads", () => {
    const cwd = fixture({ ".env.test": "DATABASE_URL=postgres://localhost/file_test" });
    const first = resolveTestEnvironment({ cwd, env: { TEST_DATABASE_URL: "postgres://localhost/override_test", API_PORT: "4100" } });
    expect(resolveTestEnvironment({ cwd, env: first })).toEqual(first);
    expect(first.DATABASE_URL).toBe("postgres://localhost/override_test");
    expect(first.API_PORT).toBe("4100");
  });

  it.each([
    ["postgres://localhost/afire_test", "postgresql://127.0.0.1:5432/afire_test"],
    ["postgres://localhost/afire_test", "postgres://[::1]/afire_test"],
    ["postgres://localhost/afire_test", "postgres://LOCALHOST./afire_test"],
    ["postgres://localhost/afire_test", "postgres://%6cocalhost/afire_test"],
    ["postgres://user:secret@localhost/afire_test?schema=public", "postgres://other:password@localhost:5432/afire_test?schema=other"],
  ])("rejects the development database even with equivalent URL spellings", (development, test) => {
    expect(() => resolveTestEnvironment({ cwd: fixture({ ".env": `DATABASE_URL=${development}` }), env: { TEST_DATABASE_URL: test } })).toThrow("development database");
  });

  it.each(["postgres://localhost/afire", "postgres://localhost/latest", "mysql://localhost/afire_test", "not-a-url"]) (
    "rejects an unsafe inherited target: %s", (DATABASE_URL) => {
      expect(() => resolveTestEnvironment({ cwd: fixture(), env: { DATABASE_URL } })).toThrow();
    },
  );

  it("accepts a CI test database without local env files", () => {
    expect(resolveTestEnvironment({ cwd: fixture(), env: { DATABASE_URL: "postgresql://localhost/ci_test" }, requireDatabase: true }).DATABASE_URL).toBe("postgresql://localhost/ci_test");
  });

  it.each(["host=localhost", "port=5432", "database=afire_development", "dbname=afire_development"])(
    "rejects connection-target query overrides: %s", (query) => {
      expect(() => resolveTestEnvironment({ cwd: fixture(), env: { TEST_DATABASE_URL: `postgres://test-host/afire_test?${query}` } })).toThrow("query overrides");
    },
  );

  it("accepts TEST_DATABASE_URL in the test file", () => {
    expect(resolveTestEnvironment({ cwd: fixture({ ".env.test": "TEST_DATABASE_URL=postgres://localhost/file_test" }), env: {}, requireDatabase: true }).DATABASE_URL).toBe("postgres://localhost/file_test");
  });

  it("allows database-free unit tests but requires an explicit target for database fixtures", () => {
    const cwd = fixture({ ".env": "DATABASE_URL=postgres://localhost/afire" });
    expect(resolveTestEnvironment({ cwd, env: {} }).DATABASE_URL).toBeUndefined();
    expect(() => resolveTestEnvironment({ cwd, env: {}, requireDatabase: true })).toThrow("TEST_DATABASE_URL");
  });

  it("does not expose connection credentials in errors", () => {
    const run = () => resolveTestEnvironment({ cwd: fixture(), env: { DATABASE_URL: "postgres://private-user:private-password@localhost/production" } });
    expect(run).toThrow("test");
    try { run(); } catch (error) { expect(String(error)).not.toMatch(/private-user|private-password/); }
  });

  it.each(["playwright.config.ts", "tests/e2e/fixtures/database.ts", "server/runtime/loadEnv.ts", "bin/dev", "bin/test"])(
    "blocks unsafe database access through the real %s entry point", (entry) => {
      const root = fileURLToPath(new URL("../../../", import.meta.url));
      const source = `const entry = await import(${JSON.stringify(path.join(root, entry))}); ${entry.endsWith("loadEnv.ts") ? "entry.loadEnv();" : ""}`;
      const result = spawnSync(process.execPath, ["--import", import.meta.resolve("tsx"), "--input-type=module", "--eval", source], {
        cwd: fixture(),
        env: {
          PATH: process.env.PATH,
          NODE_ENV: "test",
          DATABASE_URL: "postgres://localhost/afire_development",
          TEST_DATABASE_URL: "postgres://localhost/afire_development",
        },
        encoding: "utf8",
      });
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("Refusing to run tests");
    },
  );
});
