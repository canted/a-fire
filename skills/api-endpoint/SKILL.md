---
name: api-endpoint
description: Work on Downfold/A Fire's NestJS server API under server/api and server/api/v1. Use when adding, changing, inspecting, testing, documenting, or safely exercising local, staging, or production API endpoints; working with controllers, services, modules, auth behavior, Prisma-backed server logic, frontend SWR hooks, production CLI sessions, or endpoint-related Vitest coverage. Use the session stored in tmp/agent-session.json for authentication.
---

# Downfold Server API

Use this skill for server API work. Keep the API implementation aligned with existing NestJS controller/service/module patterns, and keep frontend API access behind SWR-powered hooks.

## Mandatory preflight

1. Read `AGENTS.md` and the closest existing endpoint before editing.
2. Run `git status --short` and preserve unrelated user changes.
3. Search for an existing endpoint, service method, feature API helper, and hook before adding anything new.
4. Decide the endpoint path, version, auth requirement, authorization rule, request shape, response shape, and affected frontend cache keys.
5. Stop before destructive data changes or production/staging API execution unless the user explicitly asked for it.

## Quick scan

- Controllers: `server/api/v1/*/*.controller.ts` and a few non-v1 controllers under `server/api/*`.
- Services: `server/api/v1/*/*.service.ts`.
- Modules: `server/api/v1/*/*.module.ts`.
- App module wiring: `server/app.module.ts`
- Auth guard: `server/api/v1/auth/auth.guard.ts`
- Prisma schema: `server/prisma/schema.prisma`
- Frontend API helpers: `frontend/features/<feature>/api.ts`
- Frontend API hooks: `frontend/hooks/use*.ts`
- SWR wrappers: `frontend/site/lib/swrQuery.ts`
- Backend tests: `tests/backend/**/*.test.ts`

Useful searches:

```bash
rg "@(Get|Post|Put|Patch|Delete)" server/api -n
rg "UseGuards\\(AuthGuard\\)|RequestWithUser" server/api -n
rg "useQuery|useMutation|useInfiniteQuery" frontend/hooks -n
rg "client\\.(get|post|put|patch|delete)" frontend -n
```

## Operating modes

- **Inspect**: Map existing routes, request/response shapes, auth behavior, and frontend consumers. Do not edit.
- **Add or change endpoint**: Follow the implementation workflow and tests below.
- **Wire frontend usage**: Add or update feature API helpers and hooks; components must consume hooks, not raw network clients.
- **Exercise locally**: Use the local API only unless the user asks otherwise. Dev API defaults to `http://127.0.0.1:4000`; start it with `pnpm dev:api` or the full stack with `pnpm dev`.
- **Exercise production**: Only when the user explicitly asks, use the intended actor's existing CLI session and the public production API. Follow the production authentication workflow below.

## Production authentication workflow

For user-scoped production API actions, authenticate as the intended actor through the normal application session flow.

1. Look for the established CLI session at `tmp/agent-session.json`, or a user-specified session path. Treat the entire file as sensitive.
2. Read tokens without printing them. Never include access tokens, refresh tokens, cookies, authorization headers, or server secrets in command output, logs, patches, or responses.
3. Decode only the JWT claims needed to identify the actor and expiration. Verify the actor through an authenticated endpoint when available; do not assume a user ID from database ownership or membership.
4. If the access token is expired, call `POST /api/v1/auth/refresh` with the stored refresh token. Refresh-token rotation is single-use, so atomically persist both returned tokens to the same session file and keep its mode `0600` before making further requests.
5. Resolve the target through authenticated API reads, then perform the requested write through the public production API. Use an idempotency nonce when the endpoint supports one.
6. Verify the response identifies the expected actor and target. Report the result without exposing credentials.
7. If the session is missing, belongs to the wrong actor, cannot be refreshed, or cannot be persisted safely, stop and ask the user to re-authenticate or provide the correct session. Do not substitute another user's identity.

Never mint or sign a production JWT from `JWT_SECRET`, impersonate a user by database ID, retrieve production signing secrets, or use SSH/direct database writes as a substitute for an authenticated user API action. Production shell and database access are for explicitly requested operational diagnostics, not for manufacturing user credentials.

## Implementation workflow

1. Pick the closest existing feature folder under `server/api/v1` and mirror its structure. Prefer extending an existing feature over creating a new module when the resource belongs there.
2. Keep controllers thin.
   - Use Nest decorators such as `@Controller`, `@Get`, `@Post`, `@Put`, `@Patch`, `@Delete`, `@Param`, `@Query`, `@Body`, and `@Req`.
   - Parse route/query/body fields and coerce IDs with `Number(...)`; handle invalid numbers intentionally.
   - Call one service method per action; do not put business logic or Prisma calls in controllers.
   - Use property injection with `@Inject(...)` to match this codebase.
3. Enforce auth and authorization deliberately.
   - For authenticated endpoints, add `@UseGuards(AuthGuard)` and read `userId` from `(request as RequestWithUser).user?.id`.
   - For public endpoints, confirm an existing public analogue such as health before omitting the guard.
   - Put access checks in the service. Throw `ForbiddenException`, `NotFoundException`, `BadRequestException`, or `UnauthorizedException` as appropriate.
4. Put business logic in services.
   - Inject `PrismaService`, queue, realtime, mailer, storage, or feature services with `@Inject(...)`.
   - Keep data access, authorization, queue scheduling, websocket fanout, and payload assembly in the service layer.
   - Return plain objects unless the feature already uses DTOs or serializers.
5. Wire Nest modules.
   - Import required modules such as `AuthModule`, `PrismaModule`, `BossModule`, `RealtimeModule`, or related feature modules.
   - Register the controller and provider.
   - Add the module to `server/app.module.ts` only when creating a new API feature.
6. Handle Prisma changes through CLI-generated migrations only.
   - Edit `server/prisma/schema.prisma` only when schema changes are required.
   - Create migrations with `pnpm exec prisma migrate dev --schema server/prisma/schema.prisma --name <name>`.
   - Run `pnpm prisma:generate` after schema changes when generated types are needed.
   - Do not manually create migration files.
7. Wire frontend access when the endpoint is consumed by the SPA.
   - Put network functions in `frontend/features/<feature>/api.ts` when that pattern exists.
   - Put reads/writes in `frontend/hooks` using `useApiClient` plus `useQuery`, `useInfiniteQuery`, or `useMutation` from `frontend/site/lib/swrQuery.ts`.
   - Update cache keys, invalidations, optimistic updates, and stale data behavior explicitly.
   - Do not call `fetch` or the API client directly from components.
8. Add or update tests.
   - Backend service behavior belongs in `tests/backend/<feature>/*.test.ts`.
   - Instantiate services directly in tests and assign injected fields manually, following existing tests.
   - Cover success, missing records, forbidden access, invalid input, pagination limits, side effects, and emitted jobs/events when relevant.
   - Add frontend Vitest coverage for important hook/API-helper behavior when the frontend contract changes.

## API safety gates

- Every user-specific or community-specific endpoint must prove membership/ownership before returning or mutating data.
- Mutations must validate that the authenticated user can write to the target resource.
- Production user actions must use the intended actor's existing application session from `tmp` (or an explicitly supplied session path) and the normal token-refresh endpoint.
- Never create a token from production signing secrets or choose an actor solely by user ID, ownership, or membership records.
- Delete, publish, invite, notification, upload, queue, and websocket paths need explicit side-effect assertions in tests when changed.
- Paginated endpoints must clamp invalid and excessive page sizes.
- Upload/media payloads must preserve existing URL normalization and private upload handling patterns.
- Never bypass `AuthGuard` in production code for test convenience.

## Validation

Run the smallest relevant checks first, then broaden when the change touches shared behavior.

```bash
pnpm exec vitest run tests/backend/<feature>
pnpm exec vitest run tests/frontend/<feature-or-hook>
pnpm run build:api
pnpm lint
```

If schema or runtime startup changed, also run:

```bash
pnpm prisma:generate
pnpm exec prisma migrate dev --schema server/prisma/schema.prisma
pnpm dev:api
```

## Implementation checklist

- [ ] Closest existing endpoint and frontend consumer were inspected.
- [ ] Controller stays thin and contains no business logic.
- [ ] Auth guard and service-level authorization are correct for the endpoint.
- [ ] Service owns Prisma access, side effects, and response assembly.
- [ ] Module imports/providers/controllers are wired.
- [ ] `server/app.module.ts` is updated if a new feature module was added.
- [ ] Prisma migration was generated by CLI if the schema changed.
- [ ] Frontend API access goes through `frontend/hooks` and SWR wrappers if consumed by the SPA.
- [ ] Backend and frontend tests cover the changed contract.
- [ ] Relevant validation commands were run or explicitly reported as not run.

## Project conventions

- API base path is usually `api/v1`.
- Controllers often use `@Controller("api/v1/<resource>")`, or `@Controller("api/v1")` with explicit route decorators.
- Property injection via `@Inject(...)` is common; keep that style unless the nearby module uses constructor injection.
- `AuthGuard` pulls a bearer token, verifies it, and sets `request.user`.
- Backend tests use Vitest and usually mock Prisma/service dependencies with `vi.fn()`.

## Gotchas

- Missing `@Inject(...)` on property-injected services causes runtime `undefined` failures.
- `Number(undefined)` and `Number("bad")` can become `NaN`; handle query and body coercion explicitly.
- Frontend hooks wrap SWR with TanStack-like names in `frontend/site/lib/swrQuery.ts`; do not assume TanStack Query is installed.
- Some API helpers live in feature folders while hooks live in `frontend/hooks`; keep that split.
- The repo has legacy or non-v1 controllers under `server/api/*`; do not move them while touching v1 endpoints.
