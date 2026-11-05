import fs from "node:fs";
import path from "node:path";
import { parse } from "dotenv";

function readEnvironment(cwd, name) {
  const file = path.resolve(cwd, name);
  return fs.existsSync(file) ? parse(fs.readFileSync(file)) : {};
}

function databaseIdentity(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Test isolation requires a valid PostgreSQL database URL.");
  }
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !url.hostname || url.pathname.length < 2) {
    throw new Error("Test isolation requires a PostgreSQL URL with a database name.");
  }
  if ([...url.searchParams.keys()].some((key) => ["host", "hostaddr", "port", "database", "dbname", "service"].includes(key.toLowerCase()))) {
    throw new Error("Test database URLs must specify the connection target in the URL, without query overrides.");
  }
  let canonicalHostname;
  try {
    canonicalHostname = decodeURIComponent(url.hostname).toLowerCase().replace(/\.$/, "");
  } catch {
    throw new Error("Test isolation requires a valid database hostname.");
  }
  const hostname = ["localhost", "127.0.0.1", "[::1]"].includes(canonicalHostname) ? "loopback" : canonicalHostname;
  let database;
  try {
    database = decodeURIComponent(url.pathname.slice(1));
  } catch {
    throw new Error("Test isolation requires a valid database name.");
  }
  return { database, identity: `${hostname}:${url.port || "5432"}/${database}` };
}

/** Validate before constructing a database client; credentials never appear in errors. */
export function assertTestDatabaseIsIsolated(testDatabaseUrl, developmentDatabaseUrl) {
  if (!testDatabaseUrl) {
    throw new Error("Set TEST_DATABASE_URL or DATABASE_URL in .env.test to an isolated test database.");
  }
  const target = databaseIdentity(testDatabaseUrl);
  if (developmentDatabaseUrl && target.identity === databaseIdentity(developmentDatabaseUrl).identity) {
    throw new Error("Refusing to run tests against the development database. Configure a separate test database.");
  }
  if (!/(?:^|[_-])test(?:$|[_-])/i.test(target.database)) {
    throw new Error("Refusing to run tests: the database name must contain a separate 'test' segment, such as afire_test.");
  }
}

/** The launcher, runtime, and test runners share selection and validation. */
export function resolveTestEnvironment({ cwd = process.cwd(), env = process.env, requireDatabase = false } = {}) {
  const development = readEnvironment(cwd, ".env");
  const test = readEnvironment(cwd, ".env.test");
  const databaseUrl = env.TEST_DATABASE_URL || test.TEST_DATABASE_URL || test.DATABASE_URL || development.TEST_DATABASE_URL || env.DATABASE_URL;
  if (databaseUrl || requireDatabase) assertTestDatabaseIsIsolated(databaseUrl, development.DATABASE_URL);
  return {
    ...test,
    ...env,
    NODE_ENV: "test",
    // Forward the selected target explicitly so runtime reloads cannot replace it.
    ...(databaseUrl ? { DATABASE_URL: databaseUrl, TEST_DATABASE_URL: databaseUrl } : {}),
  };
}

export function loadTestEnvironment(options = {}) {
  const environment = resolveTestEnvironment(options);
  Object.assign(process.env, environment);
  return environment;
}
