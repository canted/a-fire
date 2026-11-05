#!/usr/bin/env node
// Isolated production-build stack. Never loads a development .env or deletes a database.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const directory = path.join(root, 'tmp/lighthouse');
const configFile = path.join(directory, 'environment.json');
const marker = 'A Fire isolated Lighthouse fixtures v1';
const psql = process.env.LIGHTHOUSE_PSQL ?? ['/opt/homebrew/bin/psql', '/usr/bin/psql'].find(existsSync) ?? 'psql';
const command = process.argv[2] ?? 'prepare';
if (existsSync(path.join(root, '.env'))) throw new Error('Refusing to load a worktree containing .env. Use a clean isolated worktree.');
mkdirSync(directory, { recursive: true, mode: 0o700 });

function run(executable, args, env, options = {}) {
  const result = spawnSync(executable, args, { cwd: root, env, stdio: 'inherit', ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${path.basename(executable)} failed (exit ${result.status}).`);
  return result.stdout?.trim();
}

function validate(config) {
  const url = new URL(config.DATABASE_URL);
  if (url.protocol !== 'postgresql:' || url.hostname !== '127.0.0.1' || !/^\/afire_lighthouse(?:_[a-z0-9]+)*_test$/.test(url.pathname)) {
    throw new Error('Lighthouse requires a named afire_lighthouse*_test database on 127.0.0.1.');
  }
  if (config.API_PORT !== '4300' || config.APP_BASE_URL !== 'http://127.0.0.1:4300' || config.UPLOADS_STORAGE_BACKEND !== 'local' ||
      config.UPLOADS_STORAGE_ROOT !== path.join(directory, 'storage')) throw new Error('Unexpected Lighthouse stack configuration.');
  return url;
}

const baseEnvironment = Object.fromEntries(['PATH', 'HOME', 'TMPDIR', 'USER', 'LANG'].flatMap(key => process.env[key] ? [[key, process.env[key]]] : []));
let config;
if (command === 'prepare' && !existsSync(configFile)) {
  const database = process.env.LIGHTHOUSE_DATABASE_NAME ?? 'afire_lighthouse_test';
  const role = process.env.LIGHTHOUSE_DATABASE_USER ?? process.env.USER;
  if (!role) throw new Error('Set LIGHTHOUSE_DATABASE_USER to a local PostgreSQL role.');
  const url = new URL(`postgresql://127.0.0.1:5432/${database}?schema=public`);
  url.username = role;
  url.password = process.env.LIGHTHOUSE_DATABASE_PASSWORD ?? '';
  config = {
    NODE_ENV: 'production', DATABASE_URL: url.href, JWT_SECRET: randomBytes(48).toString('hex'),
    API_PORT: '4300', APP_BASE_URL: 'http://127.0.0.1:4300', UPLOADS_STORAGE_BACKEND: 'local',
    UPLOADS_STORAGE_ROOT: path.join(directory, 'storage'), BREVO_SMTP_SERVER: '127.0.0.1', BREVO_SMTP_PORT: '9',
    BREVO_SMTP_LOGIN: '', BREVO_SMTP_PASSWORD: '', BREVO_SENDER: 'lighthouse@example.invalid',
    POSTHOG_KEY: '', VITE_POSTHOG_KEY: '', POSTHOG_HOST: '', VITE_POSTHOG_HOST: '',
    AWS_ACCESS_KEY_ID: '', AWS_SECRET_ACCESS_KEY: '', AWS_EC2_METADATA_DISABLED: 'true',
    VAPID_PUBLIC_KEY: '', VAPID_PRIVATE_KEY: '', VITE_VAPID_PUBLIC_KEY: '', TSX_DISABLE_IPC: '1',
  };
  validate(config);
  writeFileSync(configFile, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
} else {
  config = JSON.parse(readFileSync(configFile, 'utf8'));
}
const url = validate(config);
const database = url.pathname.slice(1);
const env = { ...baseEnvironment, ...config };
const pgEnv = { ...baseEnvironment, PGPASSWORD: decodeURIComponent(url.password) };
const pgArgs = ['--no-psqlrc', '--no-password', '-h', '127.0.0.1', '-p', url.port || '5432', '-U', decodeURIComponent(url.username), '-v', 'ON_ERROR_STOP=1'];
const sql = query => run(psql, [...pgArgs, '-d', 'postgres', '-Atqc', query], pgEnv, { stdio: ['ignore', 'pipe', 'inherit'], encoding: 'utf8' });
const comment = sql(`SELECT coalesce(shobj_description(oid, 'pg_database'), '') FROM pg_database WHERE datname='${database}'`);
const exists = sql(`SELECT count(*) FROM pg_database WHERE datname='${database}'`) === '1';
if (!exists && command === 'prepare') {
  sql(`CREATE DATABASE "${database}"`);
  sql(`COMMENT ON DATABASE "${database}" IS '${marker}'`);
} else if (!exists || comment !== marker) {
  throw new Error('Database is absent or lacks the Lighthouse ownership marker; existing unmarked databases are never changed.');
}

if (command === 'prepare') {
  run('pnpm', ['exec', 'tsx', '--tsconfig', 'tsconfig.server.json', 'server/scripts/prepare-database.ts'], env);
  run('pnpm', ['exec', 'tsx', '--tsconfig', 'tsconfig.server.json', 'tests/e2e/lighthouse/seed.ts'], env);
} else if (command === 'start') {
  if (!existsSync(path.join(root, 'dist/server/main.js')) || !existsSync(path.join(root, 'public/frontend/index.html'))) {
    throw new Error('Build both the application and API before starting Lighthouse.');
  }
  run(process.execPath, ['dist/server/main.js'], env);
} else if (command === 'auth') {
  run('pnpm', ['exec', 'tsx', '--tsconfig', 'tsconfig.server.json', 'tests/e2e/lighthouse/seed.ts', '--auth-only'], env);
} else throw new Error('Usage: node bin/lighthouse-local.mjs prepare|start|auth');
