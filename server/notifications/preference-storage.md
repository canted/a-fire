# Notification preference storage

`NotificationPreferencesService` owns preference updates and resolves delivery
settings in Post, Square, Board, Circle, Global order. Room preference updates
hold the active Room lock and recheck membership in the transaction. The
notification-precedence integration test verifies scope precedence against
PostgreSQL and concurrent first saves against that owner.

Delivery resolution now reads the applicable scopes in one query, selects only
the scope and setting fields, and applies precedence in application code. With
database uniqueness, at most five rows can match. The query also caps its result
at the applicable scope count. Deploy the uniqueness migration before this reader;
on an unmigrated database duplicates could consume that bound. The real-database
precedence regression counts emitted Prisma queries and requires one read for
each step through Post, Square, Board, Circle and Global fallbacks, independently
of row insertion order.

Delayed push delivery resolves these current settings again when the job runs.
Disabling push, muting delivery, selecting no notifications, or excluding that
event type cancels the scheduled delivery with `preferences_changed` before
badge calculation or external sending. Lookup failures propagate to the worker
without changing delivery state, so the queue can retry. Persisted-preference
regressions cover all four suppression cases; the delivery record is a test
double in those cases. This does not make an external push atomic with later
preference changes or solve duplicate external sends after uncertain responses.

## Lookup index

Migration `20261030040000_notification_preference_lookup_index`, generated with
Prisma migrate diff, adds `(user_id, scope_type, scope_id)`. This supports scoped
delivery lookups and Room preference lists without changing precedence or data.
The following uniqueness migration replaces it with a unique index on the same
columns and adds a partial unique index on `(user_id, scope_type)` for NULL scope
IDs. This also prevents duplicate Global preferences.

On 2026-10-30 UTC the migration and 13 notification tests passed against
`afire_remediation_20261029_test`. A separate transaction inserted 10,000 Post
preferences for a synthetic user, then ran EXPLAIN ANALYZE with buffers for a
lookup of scope 9,999. PostgreSQL chose the new index without planner overrides:
one returned row, three shared buffer hits, zero disk reads, 0.009 ms execution.
The transaction was rolled back. This is a warm local query-plan check, not a
production latency benchmark or a bound on total notification fanout cost.

The migration uses ordinary CREATE INDEX and can block writes while building.
Measure build duration on a restored retained database before deployment; this
checkpoint applied it only to the isolated test database. No production or
retained local database was migrated.

## Database uniqueness

Migration `20261030041000_notification_preference_uniqueness` runs both index
changes in one explicit transaction. It never merges or deletes records. Existing
duplicates cause failure and rollback; resolve their meaning before retrying,
preserving source values. The Room transaction still owns access checks and
concurrent first-save behavior; indexes additionally protect against other writers.

The ordinary unique index is declared in Prisma. The companion partial index is
SQL-owned because this Prisma schema cannot express it. Preserve that index in
future baseline/consolidation work. No enum or scope-shape constraint is added by
this change; polymorphic target integrity remains a separate concern.

Four targeted files / 17 tests passed after applying the migration to the isolated
database. Real PostgreSQL tests reject duplicate scoped and NULL-scope records,
allow different scope types with the same numeric ID, and exercise both failure
points on a pre-upgrade table. Conflicting rows and the original nonunique index
remain unchanged after rollback. These tests use isolated transactions; they are
not a restored production upgrade rehearsal.

The subsequent full backend run passed 189 files / 1,243 tests in 128 seconds
with all 47 migrations applied to the isolated database. Type checking and
touched-test lint also passed.

## Retained local data checkpoint

`../prisma/inventory/retained-notification-preferences.json` records read-only
aggregate checks on 2026-10-30 UTC. Development has no preference records;
retained test has three Circle preferences. Neither contains duplicate scopes,
unknown scope names, invalid Global/non-Global scope-ID shapes, unsupported
notification/delivery settings, or incoming foreign keys to preference records.
No user IDs, settings contents, or credentials are included in the report.

For these snapshots, enforcing uniqueness needs no row merges or deletions.
Production is still unverified. A migration can fail atomically on duplicates
instead of inventing a winner; if that happens, preserve those rows and classify
them before retrying. The index must cover both ordinary scoped records and
Global records with NULL scope IDs. Pre-upgrade duplicate fixtures live in isolated schemas in the migration tests.
Current-schema inventory fixtures comply with uniqueness; they still exercise
dangling preferences and conflicting Room structure detection.
