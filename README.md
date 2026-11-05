# A Fire

A place for artists, especially musicians, to document work in progress, share it with peers, and use feedback to shape what they make next.

Designed and built by William Kingston Davies. This repository is a standalone public source snapshot with a fresh history. It includes the application, server, tests, and component stories; private deployment records and development media are excluded.

## Product and engineering

- Private Projects collect creative work; sharing creates a deliberate, separately authorized copy.
- Text, audio, images, video, peer feedback, and realtime chat support the creative process.
- Shared components, design tokens, rich-document editing, browser keyboard/viewport handling, and media processing carry the experience through desktop and mobile web.
- An experimental MCP endpoint supports scoped private link capture. The first slice was verified locally; a production Codex connection, media capture, and automated sharing are not claimed.

The current acceptance target is web. iOS and Android runtime validation is deferred.

## Explore the source

- `PRODUCT.md`: audience, purpose, and product principles.
- `frontend/src/features`: product interfaces and component stories.
- `frontend/src/components` and `frontend/src/styles`: shared controls, artwork, fonts, and tokens.
- `frontend/src/hooks`: application data and mutation ownership.
- `server/api/v1/agent-connections`: scoped MCP capture pilot and its documented limits.
- `tests`: frontend, backend, integration, and browser tests.

A Fire is a full-stack TypeScript app with an Expo / React Native Web frontend and a NestJS backend.

## Stack

- Application: Expo Router, React Native / React Native Web, TypeScript, SWR (`frontend/src`)
- Public website: Vite, React 18 and shared MUI components (`frontend/site`), isolated from the app runtime.
- Backend: NestJS, Prisma, PostgreSQL, Socket.IO/WebSockets, pg-boss workers
- Tooling: pnpm, Vitest, Playwright, Storybook

## Prerequisites

- Node.js from [`.node-version`](.node-version) (currently 24.3.0)
- pnpm from the `packageManager` field in [`package.json`](package.json) (currently 11.21.0)
- A running local PostgreSQL server and its `createuser`/`createdb` client tools; CI uses PostgreSQL 16
- For real login, invitations, and browser tests: a local SMTP catcher listening on `127.0.0.1:1025`, or another SMTP server configured in the environment files

## Quick Start (Local)

1. Activate the pinned package manager and install locked dependencies:

```bash
corepack enable
corepack install
pnpm install --frozen-lockfile
pnpm --dir frontend install --frozen-lockfile
```

If Corepack is unavailable in your Node installation, install the pnpm version pinned in `package.json` before running the install command.

2. Create local environment files, keeping development and test data separate:

```bash
cp -n .env.example .env
cp -n .env.test.example .env.test
```

The templates use an `afire_local` PostgreSQL role, the example password `afire-local-only`, and two databases: `afire_development` and `afire_test`. Adjust these values to your local PostgreSQL setup. The JWT secrets and database password in these templates are for local use only. Actual `.env` files are ignored by Git.

3. Create the local role and databases if they do not already exist. Run these as your local PostgreSQL administrator; enter the password chosen above when prompted:

```bash
createuser --createdb --pwprompt afire_local
createdb --owner=afire_local afire_development
createdb --owner=afire_local afire_test
```

The development role needs database-creation permission when using Prisma's shadow database to create new migrations. Ordinary startup applies existing migrations without a shadow database.

4. Generate the Prisma client and apply the committed migrations to the development database configured in `.env`:

Check that an exported `DATABASE_URL` is not pointing elsewhere: Prisma gives it precedence over `.env`.

```bash
pnpm prisma:generate
pnpm db:prepare
```

`pnpm db:prepare` uses the shared migration runner, including verification of the one historical duplicate index already present in the baseline. It applies committed migrations without running content backfills. Use `pnpm exec prisma migrate dev --schema server/prisma/schema.prisma --name <change>` when creating a new schema migration.

5. Install the isolated Expo dependencies, then start the app (API + worker + Expo web):

```bash
pnpm expo:install
pnpm dev
```

`pnpm dev` also applies pending committed migrations before starting the services. Local uploads go to `storage/development` with the example configuration; no S3 account is needed for this setup.

An empty database has no users or Rooms. Sign-in requires an existing user or a valid invitation; entering an arbitrary email will not create an account. Browser tests create their own fixtures. Development login codes are logged by the API, but the mailer still requires a working SMTP server to complete the request.

For your first account in a **fresh local development database only**, confirm `.env` and any exported `DATABASE_URL` select that database, then open the application console in a separate terminal:

```bash
pnpm console
```

At the `afire>` prompt, create a local example user with the required fields from the [Prisma schema](server/prisma/schema.prisma):

```js
await prisma.user.create({ data: {
  email: "local-developer@example.test",
  username: "local_developer",
  created_at: new Date(),
  updated_at: new Date(),
} })
```

Enter `.exit` to close the console. Sign in to the running app with `local-developer@example.test` and use the code from your SMTP catcher or API log. Once signed in, create your first Room through the app at `/app/rooms/new`.

## Local Services and URLs

- Frontend (Expo web): `http://localhost:5173`
- API (NestJS): `http://localhost:4000` (default, configurable via `API_PORT`)

`WEB_PORT` changes the frontend port; `API_PORT` changes the API port. The launcher supplies the matching local API URL to Expo; an explicit `EXPO_PUBLIC_API_URL` overrides it. Additional arguments to `bin/dev` are Expo CLI arguments (for example, `--clear`). Stop the old Vite process before restarting on the same port.

For local release builds, including local preflight, create a root `.env.production`:

```dotenv
EXPO_PUBLIC_API_URL=http://localhost:4000/api
```

The release builder reads this ignored file automatically; exported environment values take precedence. `pnpm dev` continues to use `.env` and its local API default. Configure your own deployment separately; this snapshot contains no hosted environment configuration.

`pnpm dev` starts:

- `pnpm dev:api`
- `pnpm dev:worker`
- Expo web from `frontend`

## Useful Scripts

- `pnpm dev` - run frontend, API, and worker
- `pnpm dev:api` - run API only
- `pnpm dev:worker` - run worker only
- `pnpm dev:site` - run site build target
- `pnpm lint` - run ESLint
- `pnpm typecheck` - check app, strict backend, tests, stories, and tooling
- `pnpm storybook` - start Storybook
- `pnpm build` - build app + site + API
- `pnpm start:api` - run built API
- `pnpm start:worker` - run built worker

## Testing

Tests use the disposable database in `.env.test`. The shared [test environment loader](server/runtime/test-environment.mjs) selects and validates the test target for the launchers and test runners. Use a database name with a distinct `test` segment, such as `afire_test`; the development database is rejected. Browser authentication setup clears test data before creating fixtures.

Install the browsers once:

```bash
pnpm exec playwright install chromium webkit
```

Run the managed browser-test stack:

```bash
pnpm test --playwright-only
```

This applies test-database migrations, starts the API, worker, and Vite, waits for readiness, runs Playwright, and stops the services. Its default URLs are `http://127.0.0.1:5174` for the frontend and `http://127.0.0.1:4100` for the API. PostgreSQL and the local SMTP catcher must already be running; these ports must be free. Run `pnpm test` to include Vitest before Playwright.

The full Vitest suite includes real PostgreSQL integration tests. Backend Vitest runs apply committed migrations to the validated test database once before workers start, including standalone `pnpm vitest` and `pnpm exec vitest run` calls. Preparation failures stop the suite before tests run; frontend-only runs do not prepare a database. No reset or content backfill is performed. To prepare the same test database explicitly:

```bash
pnpm test:prepare
```

Run the unit/integration suite with:

```bash
pnpm vitest
```

The backend suite also exercises Note conflict retention in two Chromium tabs against real authenticated HTTP endpoints and PostgreSQL. Install its browser with `pnpm exec playwright install chromium` (Linux CI uses `--with-deps`). The fixture starts and closes its own local HTTP server; it does not require the app development servers. It tests production draft/API owners, not the complete Note screen.

Pure unit tests can be selected by file or directory, for example `pnpm vitest tests/frontend/unit/utils/time.test.ts`.

For focused browser debugging, `pnpm playwright` and `pnpm playwright:ui` use an already running test stack; they do not start one. The setup project handles authentication automatically. Reports, traces, screenshots, and videos are written under `tests/e2e/reports/`.

See [the testing guide](skills/e2e-tests/SKILL.md) for maintained fixture and provider examples.

## Project Structure

- `frontend/` - React app, routes, features, shared UI components
- `server/` - NestJS modules, APIs, runtime scripts, Prisma schema
- `tests/` - frontend/backend unit tests and e2e tests
- `types/` - contracts shared across frontend and backend
- `bin/` - local development, verification, and deployment launchers
- `skills/` - project-specific implementation and testing guidance
- `public/` - static assets and built frontend/site output

Frontend screens live in `frontend/src/features`; request and cache ownership lives in `frontend/src/hooks`. Post and reply publication reuse the draft/publishing hooks there, and `useContentDraft` owns autosave. Shared keyboard and document scrolling behavior is documented in the [canonical implementation registry](AGENTS.md).

Backend controllers call the existing service facades. Posts delegate reads and notifications to `PostsReadService` and `PostNotificationsService`; communities delegate relationships and delivery history; activities delegate notifications. Keep business transactions together when extending these services.

## Build and Run (Production-like)

```bash
pnpm build
pnpm start:api
```

Run `pnpm start:worker` in a separate terminal. These commands use the configured environment and database; deployment configuration is separate from the local example files.

## Notes

- [Image implementation policy and rollout](server/uploads/images/README.md): shared rendering, validation, variants, authorization, caching, and regression requirements.

- Data access on the frontend should go through SWR-powered hooks in `frontend/src/hooks`.
- Expo route modules live in `frontend/src/app`; the public website has a separate minimal Vite route tree.
- Universal UI uses React Native primitives and StyleSheet with shared components from `frontend/src/components`; browser adapters use CSS Modules.
- Do not reintroduce Tailwind utility styling or build tooling.
- Avoid committing secrets in `.env` files.

### Graceful process shutdown

The API and worker handle SIGINT/SIGTERM through `server/runtime/shutdown.ts`. Repeated signals share one shutdown. The API stops new HTTP connections, disconnects Socket.IO clients, drains Hocuspocus documents/in-flight writes, stops Boss, then closes Nest and telemetry. Existing HTTP requests retain their dependencies until they finish. The worker withdraws its availability lease, then stops Boss before Nest can disconnect Prisma, allowing active jobs to finish within Boss's existing graceful-stop policy. A stopped BossService cannot restart itself through a late enqueue.

The application deadline is 40 seconds; cleanup errors or deadline expiry exit unsuccessfully. Deployments must allow time for this shutdown; jobs and mutations still require retry/idempotency guarantees. The installed Boss default waits up to 30 seconds and fails remaining work on stop; this does not promise automatic recovery for every job's retry policy. Shutdown is not a substitute for failed-job monitoring or restore verification.

Tests exercise real child-process signals, held HTTP requests, a held Note database write, and an active Boss job reaching completed state before its pool closes. A production-like rollout rehearsal and long-running/forced-stop recovery remain separate operational acceptance work.


## Retrying failed audio processing

After fixing the underlying processing failure, inspect a bounded batch with the built-server command:

```bash
pnpm retry:failed-audio --since 2026-10-29 --until 2026-10-30 --limit 100
```

This defaults to a read-only preview of failures containing `ffmpeg`; use `--all-errors` or `--error-contains` to change that filter. Omit dates to start at today's UTC midnight. The default batch is 100 assets, ordered by creation time and ID; `--limit` accepts 1–1,000. Add `--execute` to claim each still-matching failed asset and enqueue its replacement job in one transaction. Recovery skips assets with an existing created, retrying or active Boss audio job. Repeated execution advances past assets already changed to pending; reported enqueue counts exclude selections changed by another process or still covered by queue work. If a batch fails partway, earlier per-asset commits remain valid and the failed transaction rolls back. Preview the next batch before executing it.

This tool retries failed assets only. It does not reconcile stuck pending/processing assets or prove that an older queue job has stopped; worker monitoring and broader recovery procedures remain separate work.


Worker availability is reported separately at `/api/v1/health/workers` after the
matching heartbeat migration and worker release. See [queue operations](server/queue/operations.md)
for lease expiry, readiness limits and backlog inspection. Web liveness alone does
not establish that background work is running.

## License

MIT for application code; see [LICENSE](LICENSE). Bundled dependencies and assets retain their own licenses; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

Storybook uses synthetic replacement media in this public snapshot. Historical operational and migration audit reports are not included; their references in retained implementation notes are context, not public verification artifacts.
