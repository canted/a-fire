// @vitest-environment node
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";

const launcher = path.resolve("bin/dev");

it.each([undefined, "http://localhost:4999/api", "test"])("launches Expo after database preparation (API override: %s)", override => {
  const directory = mkdtempSync(path.join(tmpdir(), "afire-dev-launcher-"));
  try {
    writeFileSync(path.join(directory, ".env"), "API_PORT=4015\nWEB_PORT=5511\n");
    const log = path.join(directory, "calls.jsonl");
    writeFileSync(path.join(directory, "pnpm"), `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({ args, api: process.env.EXPO_PUBLIC_API_URL, mode: process.env.NODE_ENV, noDotenv: process.env.EXPO_NO_DOTENV }) + '\\n');
if (args[0] === 'db:prepare') process.exit(0);
if (args.includes('--web')) setTimeout(() => process.exit(0), 150);
else setInterval(() => {}, 1000);
`, { mode: 0o755 });
    const env: NodeJS.ProcessEnv = { ...process.env, NODE_ENV: "development", PATH: `${directory}${path.delimiter}${process.env.PATH}` };
    delete env.API_PORT;
    delete env.WEB_PORT;
    delete env.EXPO_PUBLIC_API_URL;
    if (override === "test") {
      env.NODE_ENV = "test";
      env.TEST_DATABASE_URL = "postgres://localhost/afire_test_launcher";
      env.API_PORT = "4100";
      env.WEB_PORT = "5174";
    } else if (override) env.EXPO_PUBLIC_API_URL = override;
    delete env.EXPO_NO_DOTENV;
    const result = spawnSync(process.execPath, [launcher, "--clear"], { cwd: directory, env, timeout: 10_000, encoding: "utf8" });
    expect(result.status, result.stderr).toBe(0);
    const calls = readFileSync(log, "utf8").trim().split("\n").map(line => JSON.parse(line));
    expect(calls[0].args).toEqual(["db:prepare"]);
    expect(calls).toHaveLength(4);
    expect(calls.find(call => call.args.includes("--web"))).toEqual({
      args: ["--dir", "frontend", "exec", "node", "--dns-result-order=ipv4first", "node_modules/expo/bin/cli", "start", "--web", "--localhost", "--port", override === "test" ? "5174" : "5511", "--clear"],
      api: override === "test" ? "http://localhost:4100/api" : override ?? "http://localhost:4015/api",
      mode: "development",
      ...(override === "test" ? { noDotenv: "1" } : {}),
    });
    expect(calls.some(call => call.args.includes("vite"))).toBe(false);
    if (override === "test") expect(calls.find(call => call.args[0] === "dev:api").mode).toBe("test");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
