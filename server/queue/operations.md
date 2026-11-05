# Queue operations

Run `node bin/queue-status.mjs` with an explicit `QUEUE_STATUS_DATABASE_URL`.
It bounds connection establishment to ten seconds and executes a read-only,
consistent snapshot with a ten-second server statement timeout
and prints queue/state counts, oldest creation time, maximum retry count, and
jobs ready to run, and the oldest ready-job timestamp/age. It does not print job payloads, results, credentials or user
content. A missing queue schema or database error fails the command; it must not
be interpreted as an empty queue. Failures exit nonzero with a fixed diagnostic and no successful JSON report;
raw driver errors and target credentials are not printed. The server statement
timeout is not a guarantee against every established-connection network stall.
This report does not alter liveness/readiness.

Investigate failed jobs and increasing ready-job age. A queued future job is
not necessarily overdue: `ready_jobs` excludes jobs whose start time has not
arrived. `oldest_ready_at` is the earliest `start_after` among created/retry jobs
that are due now; `oldest_ready_age_seconds` measures elapsed database time since
that timestamp. Both are null when no job in the group is ready. Retry backoff
therefore starts a new readiness window; this is not total job lifetime or worker
execution time. Future-scheduled jobs never increase the reported ready age.
The oldest creation time describes the entire state group, not time
spent in that state. Use repeated snapshots to distinguish a growing backlog
from an ordinary burst. Counts cover currently retained Boss job rows, not
historical jobs already removed by retention.

For `uploads.purge-orphan`, failure may mean storage is unavailable. Restore
storage access before retrying the existing job through Boss tooling. The worker
uses ImageVariantsService.purgeOrphan and rechecks references under the blob
lock; never bypass it with direct blob-row or object deletion. Do not infer
that every unattached blob is abandoned: drafts and active writers can still
own uncommitted uploads. Process-death discovery needs a separate ownership and
age policy before any broad sweep is safe.

This is on-demand visibility. Scheduled alerts, alert thresholds and operator
retry tooling remain to be established; the report alone is not monitoring.

## Verification

The real-queue integration test completes orphan and retained-blob jobs, then
submits an invalid test payload with a test-only zero-retry override. It waits
for the actual Boss failed state and checks that this report includes the failed
count while excluding job error output and storage keys. It also enqueues an
unconsumed due job and a future-scheduled job created earlier, verifying that
backlog age follows readiness rather than creation time and is null for groups
without ready jobs. Production retries use
Boss defaults. This verifies failure visibility on demand; no alert delivery is
claimed by this test.

## Worker availability

After migration `20261030143000_queue_worker_heartbeats` and the matching app/worker
release, `GET /api/v1/health/workers` reports worker availability independently of
web liveness:

- HTTP 200: `{ "status": "ok", "workers": "ok" }` when at least one recent lease exists.
- HTTP 503: `workers` is `missing` when no lease is recent, or `error` when the
  database check fails or exceeds one second. Neither result means an empty queue.
  Concurrent probes share an outstanding database read, including after a response
  timeout, so a stalled driver cannot accumulate queries from repeated probes.
  Once that read settles, the next probe reads again; no settled result is cached.

The worker entry point starts its lease only after Nest finishes registering all
Boss handlers. Each process has its own random identity and renews using database
time every 20 seconds. Reads never create or renew leases. A lease expires after
90 seconds without renewal; graceful shutdown withdraws its own lease before Boss
drains active jobs and Prisma closes. Shutdown waits for an in-flight renewal to
finish so that it cannot recreate a stopped lease. Withdrawal failure leaves a
lease to expire and does not prevent normal job draining. Leases older than one
day are removed during renewal; these are ephemeral process metadata, not retained
business records.

Use this endpoint as a separate availability monitor. Keep `/api/v1/health/live`
for web process liveness; restarting healthy web machines cannot repair an absent
worker. Existing `/api/v1/health` retains its database/VAPID contract. A lease proves
that a registered worker process recently reached the database, not successful job
execution, a healthy queue polling connection, or acceptable backlog age. Combine
it with the read-only queue report and investigate failed jobs and increasing
ready-job age. Alert delivery is not configured by this code change.

An older deployed worker does not publish this lease. Apply the additive migration
and deploy the matching worker before treating a missing lease as evidence of a
new runtime failure. This implementation has been verified locally with PostgreSQL,
shutdown races and real HTTP status tests; it has not been deployed to production
and does not resolve the previously observed stopped production worker.

## Failed audio and video recovery

After building the matching release, use `pnpm retry:failed-audio` or
`pnpm retry:failed-video` with an explicitly targeted `DATABASE_URL`. Both commands
use `server/runtime/retryFailedMedia.ts`; the former audio API remains a compatibility
adapter. The shared command runner starts Boss only for `--execute`, so preview
works with a read-only database connection and does not initialize queue objects.

The default preview selects at most 100 failed assets created since midnight UTC
whose error contains `ffmpeg`. Use `--since` and optional exclusive `--until` to
select a creation-time window, `--error-contains` for another substring or
`--all-errors` to remove that filter. `--limit` accepts 1–1000. These timestamps
refer to asset creation, not the time of failure. Preview lists asset titles and
error details; treat its output as private operational data.

Inspect the selected failures and restore their dependency before adding
`--execute` with the same filters. Each selected asset is rechecked in a database
transaction under the canonical blob lock. A created/retry/active Boss job for any
copy sharing that blob prevents another recovery enqueue. The claim also rechecks
the selected blob identity so a changed asset cannot be recovered under the wrong
lock.
The failed-to-pending update and new job insertion commit together; enqueue errors
leave the failed asset unchanged. Concurrent recovery commands can enqueue only one replacement for a shared blob,
even when several failed copies match the filters. Audio enqueues `uploads.audio` with `audioAssetId`; video
uses `uploads.video` with `videoAssetId`. Production Boss retry defaults are retained.

Enqueued count is not a success count. The worker must subsequently process the
asset; inspect status and queue diagnostics afterward. Recovery preserves media
identity and uses the existing generation-fenced processors. It neither deletes
objects nor declares old processes dead. Pending/processing assets, unfinished
attempt reconciliation, image variants and orphan cleanup are outside this command.
Selection returns `next_after_id` when more matching rows exist. Pass that value as
`--after-id` with the same media kind and filters to continue in ascending asset-ID
order. The continuation advances over inspected assets even if all were skipped
for outstanding work, and remains usable after successful retries leave the failed
set. Date filters still refer to creation time; creation time no longer determines
batch order. The command reads one lookahead row but processes at most `--limit`.
A null continuation means no later match at that read, not a permanently empty
failure inventory. Restart without `--after-id` for a fresh sweep to revisit skipped
assets or older IDs that subsequently fail. Large failed-asset query plans still
need separate review.

## Interrupted processing attempts

Use `pnpm inspect:media-attempts --before <timestamp>` to inspect unfinished
attempts, then target one explicitly with
`pnpm recover:media-attempt --attempt-id <uuid> --before <timestamp>`.
Both required arguments make the selected attempt and age cutoff reviewable.
Use an explicitly targeted `DATABASE_URL`. Recovery defaults to preview and does
not start Boss; it can run with a database-enforced read-only connection.

Preview includes attempt/blob IDs, kind, state, creation/completion timestamps and
current generation. It excludes source/output storage keys and media contents.
`writer_status` remains `unknown`. Preview is metadata, not a promise of eligibility:
queue state and attempt state can change before execution.

After inspecting the attempt and restoring failed dependencies, add `--execute`.
The canonical recovery transaction locks the blob and rechecks the selected
attempt, cutoff, unfinished processing state and current generation. Any
created/retry/active job on any asset sharing that blob prevents recovery. A
successful recovery advances the generation, supersedes the old attempt, moves
shared assets to pending and inserts one replacement job atomically. An enqueue
failure rolls back those changes. The worker continues to read the retained source
and publish through the generation-fenced owner.

The JSON outcome is `preview`, `not_found`, `skipped` or `enqueued`. `skipped`
means no recovery was applied; inspect current attempt and queue metadata again.
`enqueued` means replacement work was committed, not that processing succeeded.
Repeat execution for an already superseded/completed attempt does not enqueue again.

This operation never declares the old process dead or deletes unfinished output.
A late old writer may finish its own immutable output, but cannot publish it as the
current generation. Source availability, storage outages, failed replacement work
and old unfinished-output retention still need monitoring. Pending assets with no
attempt are outside this command. No broad automatic age-based sweep is enabled.

### Process-interruption verification

The media process recovery regression starts the production AudioProcessor or
VideoProcessor in a separate Node process with real PostgreSQL and temporary local
storage. A test-only transcode result provides deterministic bytes; a storage gate
pauses after upload and before publication. The parent confirms the output exists,
kills the process with SIGKILL and verifies the actual exit signal. Recovery then
commits a replacement job; its stored payload is dispatched to a fresh processor
process. Both copied assets become ready, the original source remains unchanged,
and the old unfinished output/attempt remain retained and superseded.

This proves process death at that write/publication boundary and subsequent
replacement publication. It does not exercise codec correctness, S3 consistency,
Boss worker lease expiration/acknowledgement, deployment restart, or every other
interruption point. Temporary processor directories are contained in the fixture's
own directory and removed afterward. No production consumer is used.

## Reconcile historical Reply notification references

After migration `20261030180000_notification_reply_reference`, use the built
`reconcile:notification-replies` command with an explicitly selected DATABASE_URL.
It does not start Boss or deliver notifications. The default is read-only preview:

```sh
pnpm reconcile:notification-replies --limit 100 --after-id 0
```

`--execute` fills only verified `notification_events.reply_id` values. The command
prints aggregate counts and `next_after_id`; continue from that cursor until null.
Limits are 1–1000. Each event is rechecked in its own transaction, locking parent,
Reply and event in that order. A partial command failure can be retried from its
previous cursor. Original payloads, event IDs and timestamps are retained.

Resolution accepts numeric Reply-created payload IDs or canonical Reply-mention
paths, checks conflicting path/payload identities, and requires an existing Reply
with matching parent Entry, Room and author. Deleted-but-retained Replies can
still be linked. Unknown, missing or mismatched identities remain untouched.
`unresolved` also includes ordinary mentions without a supported Reply identity;
it is not a count of proven corruption. Inspect classifications before deciding
whether a record needs manual review. No automatic content or scope repair occurs.

Concurrent workers use the same resolver. Older application instances can still
write null references, so perform a fresh sweep after retiring those instances.
The first lookup of an unresolved legacy event can still scan JSON; typed retries
use the indexed reference. Do not remove that compatibility lookup based only on
one completed sweep. Reconciliation adds a reference, not notification permission;
delivery must continue to authorize the recipient against current content access.

## Local storage publication

Local buffer and file uploads write into a private `.afire-write-*` directory
beside the destination, then rename the completed file to its final key. Readers
see the previous complete object until publication. Errors and cancellation before
publication clean up that writer's staging directory. S3 writes are unchanged.

A SIGKILL can leave a staging directory behind; it is not an authoritative object
and is not a reason to delete the destination or regenerate its database owner.
Do not delete staging directories based only on age while writers may still be
active. A bounded inventory and coordinated maintenance cleanup remain needed.
The tests verify process interruption and retry, not filesystem durability after
power loss; this implementation does not add file/directory fsync guarantees.

## Repair missing or unrecorded image variants

After building, select DATABASE_URL and storage backend/root explicitly, then
preview a bounded, explicit set of variants for one blob:

```sh
pnpm repair:image-variants --blob-id 123 --digest w320 --digest w600
```

The command defaults to preview and reports source existence plus each variant's
stored/recorded state. It reads no source bytes in preview and starts no queue.
Unsupported IDs/digests are rejected before initializing the application context.
Use `--execute` to call the canonical materializer under its shared blob lock.
It regenerates missing or unrecorded variants, restores records/metadata and
leaves completed recorded variants alone. Retry the same command after failure.
Execution logs may precede its final JSON summary. Storage errors propagate; a
permission error is not reported as a missing object.

Preview is advisory and can race with deletion or another materializer; execution
rechecks independently under the lock. The command does not verify checksums of
already-recorded existing variants, remove orphan objects, or discover all blobs
requiring work. Those are separate inventory/cleanup operations. It does not
change source documents or original image bytes.

## Inventory requested image variants

Use the read-only inventory command to find blob IDs for targeted repair:

```sh
pnpm inspect:image-variants --digest w320 --digest w600 --limit 25 --after-id 0
```

Select database and storage explicitly as for repair. `--digest` is required and
repeatable. Pages default to 25 images and allow at most 100. Continue using
`next_after_id` until null. The command reports only blob IDs, requested variant
states and source existence; it does not download image bytes, mutate records,
start queues, or print storage keys. `--execute` is not supported.

This inventories requested presets, not attachment-specific requirements. A
missing preset is not automatically an app defect or permission to generate it.
Images deleted between selection and inspection are marked unavailable and the
cursor still advances. Storage/database errors fail the command instead of being
classified as missing files. Retry from the previous cursor on failure; start a
new sweep when checking older IDs whose state may have changed. Page size bounds
returned work, not necessarily all database index entries examined for sparse
image records; query plans for large mixed-media stores remain unmeasured.

### Pending media with no current processing attempt

After building the server, run `pnpm inspect:pending-media --kind audio --before 2026-10-30T00:00:00Z --limit 100` (or `--kind video`). Continue with the returned
`nextAfterId` as `--after-id`. The command is read-only, does not start pg-boss,
and returns only asset/blob IDs, update time and generation. Maximum page size is
1,000. The cutoff applies to the asset's last update, not its original upload time.

These are pending assets with no attempt for their blob's current generation.
Historical attempts do not establish current ownership. Queue state is explicitly
unchecked: queued work may still be valid, so this report alone does not establish
that an asset is stranded or authorize a replacement job. Never bulk-reset statuses
or delete bytes based on age. Use the targeted pending recovery command below; the existing attempt recovery
command requires an actual attempt ID and is not a substitute. Existing failed-media retry commands remain
limited to failed assets.


### Recover one pending upload without a current attempt

`pnpm recover:pending-media --kind audio --asset-id 123 --before 2026-10-30T00:00:00Z`
previews only. Use `--kind video` for video. Add `--execute` only for the selected
asset after reviewing the target and cutoff; execution initializes queue metadata
and enqueues work but does not start a consumer. The normal worker processes it.

Under the existing blob lock, execution requires all copies of that kind to be
pending and last updated by the cutoff, no opposite-kind asset, no current/future
attempt or historical kind mismatch, and no created/retry/active job for any copy.
A skip is a safe refusal, not a failed upload. Queue absence is necessary but is
not by itself proof of eligibility. Inconsistent copies need investigation.

The pending timestamp refresh and queue insertion commit together. Concurrent
requests for different copies enqueue only one job. This operation neither marks
old writers dead nor changes source bytes or blob generations; the canonical
worker allocates its own generation when it begins. Existing current attempts
must use attempt recovery instead. No automatic age-based batch retry is enabled.

### Application-owned queue lookup index

Migration `20261030200000_queue_live_lookup_index` owns the additive
`pgboss.afire_job_name_state_idx (name,state)` index and the public
`afire_ensure_queue_indexes()` installer. It leaves pg-boss queue policies,
retention, retries, and payloads unchanged. If the queue schema is absent during
migration, installation is deferred. BossService calls the same installer after
pg-boss starts and creates its queues, before exposing the ready client.
PostgreSQL attaches equivalent indexes to new queue partitions.

Apply the migration before deploying this application version. Installation uses
an advisory transaction lock and checks index structure/validity, not only its
name. An incompatible index fails startup visibly. Index creation is ordinary
blocking DDL, so the first installation belongs in the maintenance window; later
starts verify the installed index. Include the installer and partition indexes
when comparing fresh and restored schemas or building a future baseline.

### Introduction delivery

New introductions persist the introduction, its two recipient events, and two
`notifications.fanout` jobs in one Room-locked database transaction. The API no
longer delivers these notices synchronously. A healthy worker is required for
inbox/realtime/push delivery; worker health and queue backlog therefore apply to
introductions as well. Failed jobs use the existing queue retry policy. Replaying
an event reuses the unique event/user inbox record. This is not an exactly-once
external push guarantee. Existing introductions with historical partial delivery
are not repaired by retrying creation; they require a separate evidence-based
reconciliation. Older application instances do not use this transaction boundary.

## Production worker follow-up — 2026-10-30

A read-only follow-up confirms release 319 still has a stopped worker, with the
same October 16 exit code 1 after ten restarts and no retained worker log lines.
The running web machine uses the same deployed image. Static inspection there
resolved all 33 imports referenced by the worker bundle and found ffmpeg and
ffprobe binaries. No application modules were imported or jobs consumed. The
bundle predates WorkerHealthService, so the new heartbeat cannot diagnose this
old release. Its SHA-256 and sanitized findings are recorded in
[production-worker-static-readiness.json](../prisma/inventory/production-worker-static-readiness.json).

These checks rule out missing resolution targets and absent media executables
in the inspected image; they do not establish successful module initialization,
codec operation, database/schema compatibility or adequacy of the worker's
256 MiB memory limit. The root cause remains unproven. Next recovery evidence
requires an isolated startup rehearsal using the deployed artifact and a restored
database/object set, followed by the matching release's full migration/backfill
rehearsal. Do not interpret the passing web probe as worker recovery.

### Exact-image isolated startup preflight

The release-319 image was pulled by its immutable digest and run locally on
linux/amd64 with networking disabled, one CPU, 256 MiB memory and a dummy local
database URL. No production credentials or host files were mounted. Module
construction reached ActivityNotificationsService.scheduleActiveActivityNotifications
and exited with PrismaClientInitializationError because no database was provided.
The container was removed automatically. Sanitized evidence is in
[production-worker-isolated-startup.json](../prisma/inventory/production-worker-isolated-startup.json).

This is a startup preflight, not a restored-database rehearsal or a reproduction
of the production incident. It narrows the next check to database-backed startup
while retaining the exact image and dependency versions. No memory-capacity or
successful job-processing claim follows from reaching this initialization stage.

### Exact-image database-backed startup

The same deployed image's migrate.js completed on empty PostgreSQL 16 in an
internal Docker network: 37 migrations and zero-record backfills succeeded.
The worker remained running with its 256 MiB limit, registered nine queues and
had zero jobs. One idle memory sample was 122.1 MiB. This verifies fresh-database
startup only, not production restore, external dependencies or media execution.

The deployed worker failed to terminate within Docker's 45-second stop grace
period and exited 137 after forced termination; OOMKilled was false. This is a
concrete container shutdown failure, distinct from the unexplained production
exit code 1. Current source has explicit signal handling and Boss draining, but
requires the same container-level verification. All disposable containers, the
anonymous database volume and the internal network were removed. Evidence:
[production-worker-database-startup.json](../prisma/inventory/production-worker-database-startup.json).

### Current worker container verification

A backend-only container built from the current locked dependencies and production
runtime stages passed the same isolated startup/shutdown exercise. All 67
migrations and zero-record backfills succeeded. The worker registered 12 queues,
published and renewed its health lease, and completed one harmless retired
chat.expire job. At a 256 MiB limit, an idle memory sample was 131.1 MiB.

Unlike release 319, the current worker stopped with exit code 0 in 0.217 seconds
and removed its heartbeat row. The container had no active job at shutdown;
persisted worker-shutdown tests separately cover draining an active job. This
proves the container signal/lease lifecycle, not production recovery, media
processing or load capacity. Disposable resources were removed. Evidence:
[current-worker-container-rehearsal.json](../prisma/inventory/current-worker-container-rehearsal.json).

### Repeatable container gate

Run `node bin/check-worker-container.mjs sha256:<local-image-ID>` from the
repository root after building the backend image. The PostgreSQL image pinned
inside the command must already be available locally; the gate never pulls
images implicitly. It accepts only an immutable local image ID and does not
load host environment files or mount host paths. It creates a uniquely named
internal network and disposable PostgreSQL database with no published ports.

The gate runs the image's full migration/backfill command, requires the push
device journal, and checks the packaged recovery command rejects an implicit
database target and performs an explicit read-only preview. It then verifies a worker
lease, completes a harmless retired chat.expire job, waits for lease renewal,
then requires exit code 0 within the 45-second container grace period and zero
remaining leases. It removes its own containers, database volume and network in
finally; uncertain cleanup is a failure, never silently counted as success.
A killed gate process can require manual removal of its afire-worker-check-*
resources. Commands are bounded; larger migration histories may exceed the
one-minute command timeout and fail rather than wait indefinitely.

A successful JSON report is fresh-database startup and idle-shutdown evidence,
not retained-data restore, media processing, in-flight drain or production
rollout. [repeatable-worker-container-check.json](../prisma/inventory/repeatable-worker-container-check.json)
records the first successful run: 67 migrations, 12 queues, real job completion,
lease renewal and withdrawal, exit 0 in 0.203 seconds, and verified cleanup.

### Push delivery limits and unresolved recovery

Push delivery-record allocation now uses an atomic upsert; racing workers share
one inbox-linked record and replay preserves its existing state and diagnostics.
Each Web Push request, including VAPID fallback attempts, has a 10-second socket
inactivity timeout. The installed web-push implementation destroys a timed-out
request. This is not a total wall-clock deadline across all subscriptions or an
exactly-once external delivery guarantee.

Timeouts and ambiguous transport/server failures now produce a durable uncertain
device outcome and do not unsubscribe the recipient. Explicit 400/401/403/413/429
rejections are retryable; 404/410 invalidate the endpoint. Other statuses are held
conservatively. The worker claim prevents simultaneous senders, and the per-device
journal prevents replay of successful, invalid, started or uncertain destinations.
The recovery CLI accepts failed deliveries and partial/uncertain deliveries with
known rejected destinations. Successful and uncertain device outcomes stay held. External exactly-once delivery is
not claimed.

### Explicit failed-push recovery

`node dist/server/scripts/recover-push-delivery.js --database DATABASE_NAME --delivery-id ID --before ISO_TIMESTAMP`
previews one operator-selected failed, partial or uncertain delivery. Supply its connection explicitly as
PUSH_RECOVERY_DATABASE_URL; the command never loads dotenv or uses ambient
DATABASE_URL as a fallback. The database name must match. No content, endpoint,
credentials or stored error body is printed. Exit 0 means eligible (preview) or
enqueued (execution), 2 means missing/ineligible/outstanding work, and 1 means an
operational/configuration failure. The checkout adapter is
`node --import tsx bin/recover-push-delivery.mjs` with the same arguments; both
execute the implementation in `server/scripts/recover-push-delivery.ts`. The
compiled command is included by the API build and copied into the runtime image.

Adding `--execute` starts Boss's queue client, locks that delivery, rechecks its
failed state and cutoff, refuses created/retry/active work for the same delivery,
and commits one replacement delayed-push job with the scheduled state/job ID.
Prior diagnostics are retained. It does not start a delivery worker. A worker that
later receives the job rechecks current content access, preferences and activity;
queuing is not evidence of delivery. An existing sent/skipped/cancelled/scheduled
record is never reset by this command. Preview is read-only and does not establish
that later execution will still qualify.

Use this only after reviewing the retained failure and accepting that a provider
may have received a push despite the client seeing an error. The command cannot
resolve that uncertainty or safely replay historical `sent` partial-device
outcomes. Journaled partial outcomes can retry only known rejected destinations,
as detailed below; uncertain destinations remain held. The preceding statement that there is
no automatic replay remains true; this is an explicit recovery operation. Local
regressions use synthetic records and no worker/subscription, and verify rollback,
concurrent invocation, outstanding-work refusal and default CLI preview.

### Unified push dispatch and atomic scheduling

Immediate inbox/realtime delivery now returns a push schedule even for an inactive
recipient; it no longer sends Web Push inline. The existing push queue worker is
the sole production caller of the send method and retains content/preference/activity
checks. An immediate push becomes a due-now job, so worker availability and queue
latency apply to all pushes.

schedule-push-delivery locks the scheduled delivery, skips terminal/already-linked
records and outstanding jobs, then commits the Boss job and scheduled_job_id in one
transaction. It uses the stored due_at, not a fresh retry calculation. A fanout retry
can fill an unlinked scheduled record after interruption; concurrent fanout attempts
do not allocate duplicate jobs. The old enqueue-then-mark method has been removed.

This closes the competing inline sender and split scheduling commit. It does not
claim external exactly-once delivery after worker crashes, eliminate historical
already-duplicated jobs, or recover partial-device success. The explicit failed-push
recovery command remains the operator path for aggregate failed records.


### Partial push outcomes

A delivery with at least one successful device and at least one nonterminal
failure is recorded as `partial`, with `skip_reason=partial_device_failure`.
`sent_at` records that at least one send succeeded; it does not imply every device
received the notification. `last_error` contains JSON sent/invalid/failed/uncertain counts
and the last error message. Successful sends with only invalid, unsubscribed
endpoints remain `sent`; invalid endpoints are disabled by the existing flow.

Normal scheduling refuses `partial` records. The recovery command permits them
only when the durable journal has a known rejected destination; the worker skips
successful and uncertain attempts. Do not manually change states to force replay. No
historical records are rewritten by this change.


### Push worker claims and uncertain completion

The worker atomically changes `scheduled` to `sending` before evaluating and
sending a delivery. Duplicate jobs that lose this claim return without sending.
Preparation errors before any external attempt release the claim back to
`scheduled` and throw so the queue can retry. Once an external send may have
happened, an unexpected failure retains `sending`; a process crash does likewise.
Normal send outcomes become sent, partial, failed, uncertain, skipped or cancelled.

A lingering `sending` record requires investigation. Normal scheduling does not
replay it. The guarded interrupted-delivery procedure below can resume untouched
destinations while retaining uncertain attempts.
Never clear a claim solely because a time threshold elapsed while a worker might
still be active. No network call runs inside a database transaction.


### Journaled sender behavior

Migration 20261031030000 must be applied before deploying this sender. Each actual
send is preceded by a durable destination claim. Duplicate subscription rows for
the same endpoint are deduplicated within the pass. A known rejected destination
can start another numbered attempt; sent/invalid/started/uncertain destinations
are skipped. Completion persists before the aggregate delivery is marked finished.
A journal write failure escapes and retains the parent claim rather than being
misclassified as a transport failure. Current content access is checked before
each destination, so revocation stops subsequent sends.

A crash between provider acceptance and journal completion leaves started, which
is deliberately held as uncertain. The journal contains destination hashes and
subscription IDs, never endpoints or push keys. Do not manually reset aggregate
states to bypass the recovery command's restrictions.


### Recovering known rejections from mixed outcomes

The existing explicit-target recovery CLI now previews and requeues failed,
partial or uncertain aggregate deliveries when journaled `rejected` destinations
remain. Its output includes `device_outcomes` counts. `uncertain_external_outcome`
reports held uncertainty, not permission to retry those devices. A delivery with
only successful/invalid/started/uncertain device records returns
`no_retryable_devices`. Historical failed records without a journal retain their
previous explicitly uncertain recovery path; historical partial records without
journal evidence are refused.

Execution locks the parent, checks the cutoff and outstanding queue jobs, then
atomically queues one job and returns the parent to scheduled. Attempt records
are not rewritten. The worker rechecks access/preferences and retries only known
rejections, skipping already successful or uncertain destinations. Interrupted parents use the additional procedure below. Resolving an uncertain
individual device outcome remains a separate unfinished workflow.


### Interrupted push delivery recovery

For a `sending` parent, first stop and verify termination of every worker that
could own the delivery. Age alone is not evidence that a worker stopped. Inspect
its outstanding queue job and let it reach a terminal state through the queue's
normal lifecycle before attempting recovery. Do not delete active jobs to bypass
this check.

Use the explicit database, delivery ID and cutoff arguments above, adding
`--worker-stopped` for both preview and execution. This flag is the operator's
assertion, not an automated worker shutdown or lease check. Preview without it
returns `worker_stop_confirmation_required`. Records without a device journal
return `interrupted_without_journal`; their external outcomes cannot be inferred.

With `--execute`, recovery atomically marks unfinished device attempts uncertain,
enqueues one job and schedules the parent. Failure rolls all three changes back.
`unfinished_attempts_held` reports the number held. Existing successful, rejected,
invalid and uncertain outcomes are preserved. The sender reauthorizes access,
retries known rejections and visits untouched current destinations; it never
resends the interrupted uncertain attempts. This can leave missed notifications
unresolved, but avoids guessing whether the provider accepted a prior send.


The expanded gate passed against the backend-only production-stage image built
from committed snapshot d20305d7. The report is
`server/prisma/inventory/worker-container-d20305d7-verification.json`: 68 migrations,
explicit-target push and Round-repair previews, 12 registered queues, completed
job, renewed heartbeat, clean exit and withdrawn lease, with disposable-resource
cleanup confirmed. The earlier 67-migration report remains historical. This is
isolated container evidence, not production deployment or worker recovery.

### Round-result read-path cutover

The bounded results list no longer creates historical result snapshots or repairs
announcements during reads. Before releasing this cutover against a retained
database, inventory Rooms with archived, closed Rounds and complete the following
maintenance for each affected Room. Keep the previous application available until
all batches succeed; this has not been executed on production.

Supply the selected connection through `ROUND_REPAIR_DATABASE_URL` using the
normal secret mechanism. The command never reads dotenv or falls back to
`DATABASE_URL`. Verify its database name matches the explicit argument.

```sh
node dist/server/scripts/repair-round-results.js --database DATABASE_NAME --room ROOM_ID
```

Preview reports `through`, `inspected`, `candidates`, `repaired` and `nextAfter`.
It changes nothing. Review the selected Room and candidates, then rerun the same
batch with its returned `--through THROUGH_ID` and `--execute`. Follow each
returned `nextAfter` with `--after AFTER_ID`, keeping the same `--through` boundary,
until `nextAfter` is null. Each batch examines at most 50 Rounds. A new run without
`--through` captures a fresh upper boundary for later history.

A failure may follow earlier per-Round commits. Replay that same batch: Round
locks and canonical publication prevent duplicate results or announcements.
Do not skip the failed boundary. Scope conflicts require investigation; preserve
the original data. Active or unclosed Rounds are excluded. Repair uses the normal
transactional Room-change hint, so connected clients may refresh; it does not
invoke push or email delivery.

After execution, repeat a preview traversal from `after=0` through the same upper
boundary. Every page must have an empty candidates array. Record the database,
Room, boundary and results as release evidence, then verify current and old direct
links using the application. Restore/rehearsal evidence is not production rollout.

The isolated worker container gate also executes the packaged Round-result repair
preview. It requires rejection of an ambient database target and a successful
explicit, empty, read-only preview on its disposable database. This verifies
packaging and target selection; persisted repair semantics are covered separately
by the integration tests and restored-copy rehearsal.
