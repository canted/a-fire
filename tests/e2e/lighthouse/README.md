# Local production Lighthouse fixtures

Use a clean isolated worktree. These fixtures never read a production database or
copy user content, and never reset, truncate, or drop a database. The existing E2E
authentication setup is deliberately not used because it clears its test database.

Prerequisites: project dependencies, PostgreSQL on `127.0.0.1:5432`, a local role
with `CREATEDB`, and `ffmpeg`/`ffprobe` on `PATH`. The default PostgreSQL role is the
current OS user; set `LIGHTHOUSE_DATABASE_USER` and, if needed,
`LIGHTHOUSE_DATABASE_PASSWORD` before preparing. `LIGHTHOUSE_PSQL` can select the
local `psql` binary.

```sh
pnpm install --frozen-lockfile
pnpm prisma:generate
pnpm build:app
pnpm build:api
node bin/lighthouse-local.mjs prepare
node bin/lighthouse-local.mjs start
```

The production-built Nest server serves both the API and built application at
`http://127.0.0.1:4300`. The stack uses `NODE_ENV=production`, local disk uploads,
blank telemetry/push/cloud credentials, and an unused loopback SMTP port. It does
not run an email sender or the queue worker. The API's ordinary authorization and
private-media checks remain enabled. API startup itself uses the application's
normal listener; it does not configure a production reverse proxy or TLS.

The helper refuses a worktree containing `.env`, builds a minimal child-process
environment, permits only `127.0.0.1` databases named `afire_lighthouse*_test`, and
requires its database ownership comment before reusing a database. It runs the
normal migration preparation, including the project's existing baseline-index
reconciliation. An existing unmarked database is never changed. A nonempty marked
database without its fixture manifest is also refused; no cleanup is attempted.

Configuration, local storage, an expiring OTP, and the fixture manifest are under
gitignored `tmp/lighthouse`. Configuration and the manifest use mode `0600`.
Do not attach those files to public reports: they include local test credentials.
The manifest contains route IDs, paths, expected visible content, entity counts,
and the source path/hash/dimensions for each media fixture.

The seed creates three fictional users, three closed circles, three private
projects (one with an accepted collaborator), nine project entries, a resumable
draft, active and archived activities, shared contributions, replies, chat,
a note, and notices. Each user/circle/project has its own image attachment. Images
reuse the repository's committed presentation assets; fictional names do not
identify the people pictured. Canonical server image validation, metadata, variant
creation and local storage are used. The committed `spunky.mp3` is processed by
the actual `AudioProcessor` and retains its real duration and waveform peaks.

The initial OTP lasts ten minutes. Authentication consumes it through the real
`/api/v1/auth/verify_otp` endpoint; requesting mail is unnecessary. Reissue an OTP
without changing fixture content:

```sh
node bin/lighthouse-local.mjs auth
```

Rerunning `prepare` preserves fixture content and issues another OTP. Keep the
same data and server configuration for before/after comparisons. Dates are
relative to initial seed time; for a later independent study, use a new name via
`LIGHTHOUSE_DATABASE_NAME` after moving the previous ignored `tmp/lighthouse`
directory aside. Its database remains intact. There is intentionally no reset or
cleanup command.

## Measure and compare

Install Lighthouse separately from the application's locked dependencies. The
recorded study used Lighthouse 13.5.0 and the project's Playwright Chromium.

```sh
npm install --prefix tmp/lighthouse-tools --ignore-scripts lighthouse@13.5.0
AUDIT_PHASE=baseline node bin/lighthouse-audit.mjs
AUDIT_PHASE=baseline AUDIT_ROUTES=home,project-detail,circles,chat,entry-composer,activity-contribution AUDIT_RUNS=3 node bin/lighthouse-audit.mjs
# Apply the changes, rebuild app/API, and restart the same fixture server.
AUDIT_PHASE=after node bin/lighthouse-audit.mjs
AUDIT_PHASE=after AUDIT_ROUTES=home,project-detail,circles,chat,entry-composer,activity-contribution AUDIT_RUNS=3 node bin/lighthouse-audit.mjs
node bin/lighthouse-report.mjs
# After all measurements, exercise playback and mutate only the seeded draft:
node bin/lighthouse-verify.mjs
```

Run measurements serially without builds or tests competing for CPU. Each phase
covers sixteen authenticated routes at the standard Lighthouse mobile simulation
and desktop preset. Six representative routes have three runs per device; report
medians and ranges, not the best run. Each batch resumes valid existing reports.
Use a new phase directory after any build change to avoid mixing implementations.

The runner checks expected route content and records browser errors, HTTP errors,
image loading, overflow, and screenshots. Between measured navigations it clears
HTTP cache, service workers, Cache Storage, and IndexedDB, preserving only the
login state. It never intercepts requests or mocks APIs. Its saved session remains
private under `tmp/lighthouse`; if expired, run `auth` and remove only that saved
session before starting a new batch.

Reports are under gitignored `tests/e2e/reports/lighthouse`: standalone summary
HTML, comparison CSV/JSON, and per-run Lighthouse HTML/JSON plus screenshots and
preflight evidence. Share those report directories, never `tmp/lighthouse`.
SEO is outside the scope of this authenticated-app study; existing indexing
behavior is unchanged. Baseline raw reports also contain an unused SEO category.
Final runs and comparisons cover Performance, Accessibility, and Best Practices.
These local lab
measurements do not establish production field Core Web Vitals or a full
accessibility certification. Service-worker-mediated resource transfer sizes can
be zero despite nonzero decoded bytes; inspect both in the raw reports.

The optimized artwork was derived from the existing PNG sources with Sharp,
resized and encoded as WebP. WOFF2 fonts were
converted from the committed TTF files with FontTools 4.60.2 and Brotli 1.2.0;
their glyph order and Unicode mappings were verified unchanged. Original source
images and fonts remain in the repository.

## Home → Room interaction profile

`bin/room-performance-audit.mjs` measures the actual Home link click with Chrome's
CPU profiler, Performance metrics, and long-task observer. This supplements
Lighthouse's full-page-load audits: the reported delay is a client-side navigation.
Use the production fixture setup above in a **non-hidden checkout path** (for
example `/private/tmp/afire-room-performance`); Express refuses static assets
served from a `.codex` directory.

New fixtures contain 70 ordinary messages. The application can also generate a
wall announcement, yielding 71 timeline items. Existing manifests are preserved;
use a new dedicated fixture database for this scenario if yours has only six
messages. The runner dismisses synthetic walls through the real presentation API
before measuring, so the chat is visible in both phases. No API responses are mocked.

```sh
AUDIT_PHASE=baseline-chat node bin/room-performance-audit.mjs
# Apply changes, rebuild the app, and restart the same fixture server.
AUDIT_PHASE=final-verified AUDIT_VERIFY=1 node bin/room-performance-audit.mjs
```

Each phase uses three fresh browser contexts per device: 1350×940 desktop at
normal CPU speed and 390×844 mobile at 4× CPU slowdown, with local unthrottled
networking. It waits for Home to settle, then measures from the actual Room link
click to two animation frames after messages mount. CPU metrics cover that
navigation and the following 2.5 seconds. The first run per device also records a
`.cpuprofile`; all runs record API timings, mounted editor counts, and errors.
`AUDIT_VERIFY=1` checks older-history loading, canonical image rendering, reading
position restoration through Home, composer input, and returning to the latest
message. These checks run after measurement.

Results and screenshots are saved under the ignored
`tests/e2e/reports/room-performance/<phase>/` directory. They contain synthetic
content; authentication stays in the private fixture directory.

The October 13, 2026 investigation traced the delay to read-only Tiptap editors
mounted for each text message, unused generated avatar patterns, and message-list
identity churn on unrelated rerenders. Chat text now uses the existing Tiptap
schema and ProseMirror serializer without editor instances; interactive nodes
retain the canonical editor-backed renderer. Avatar fallbacks are generated only
when needed and memoized. The SWR hook retains the initial message-list reference
across unrelated renders.

Fetching already uses cursor pagination (latest 50, earlier pages on demand).
This change adds no virtualization dependency: loaded rows remain mounted, and
media-heavy or much longer histories remain a separate performance case. The
socket's post-subscription snapshot is retained to prevent missed messages.

Measured on Apple M2 / macOS (Darwin 25.6.0), three runs per device. Values are
median milliseconds, with min–max in parentheses, comparing `baseline-chat` with
`final-verified` on the same local dataset:

| Metric | Before | After |
| --- | ---: | ---: |
| Desktop messages painted | 273 (268–279) | 135 (132–139) |
| Mobile messages painted, 4× CPU | 891 (851–923) | 367 (344–375) |
| Mobile longest main-thread task | 647 (641–673) | 168 (156–170) |
| Mobile JavaScript CPU time | 1,015 (969–1,066) | 415 (398–430) |

The initial timeline still contains 50 rows; mounted editor instances fell from
50 to one (the composer). Desktop runs had no tasks above 50 ms after the change.
Both desktop and mobile passed the real-route interaction checks with all 71
history items available, and no browser errors. The 136 targeted frontend tests,
application and quality type checks, targeted ESLint, production build, and shared
layout/focus boundary check passed. These are local lab results, not field INP
or measurements of large media-heavy histories.
