# Notification content access: remediation checkpoint

## Implemented boundary

`canReadContentNotice` now guards inbox serialization, immediate delivery and
push sending. Entry targets, including legacy path-only targets, require a
published Room Entry and current access through the canonical parent-visibility
owner. Replies additionally require published status and a matching parent.
The event Room must match the current Entry Room. Invalid explicit Entry IDs
cannot fall back to a different target path. Reads do not renew leases.

A PostgreSQL regression changes a Reply's parent and status, withdraws its
Entry, disables membership, and deletes the Room. Each state withholds the
retained notice from the guard, inbox and immediate delivery without deleting
source records. Unit coverage verifies delayed-push cancellation and propagation
of authorization-query failures. Presentation fixtures now supply authorized
parents instead of relying on the old permissive guard.

Verification: at revision `af132d0a`, the complete backend suite passes
192 files / 1,260 tests in 127.49 seconds against the isolated remediation
database. This includes the corrected preference-reader fixture, notification
source-access tests and published Reply recovery regressions. It does not prove
Round notice access, which remains a source-audited gap below.

An additional PostgreSQL regression covers limited-visitor current-selection
changes, Open history, preceding-published fallback after withdrawal, removal of
the contributing member, loss of parent membership, and lease expiry. Denied
Entry notices are withheld from inbox serialization. Repeated successful and
denied notification reads leave the lease timestamps unchanged and retain both
source Entries. The fixture uses the existing composite Room/user lease key.

Active mention creation was traced to `PostNotificationsService` and
`RepliesService`; both store a Room Entry ID and an Entry/Reply link. Mentions
without an authorizable Entry target are now withheld. Explicit Entry IDs and
path IDs must agree; Reply payload aliases and link fragments must also agree.
Malformed targets do not fall back to permissive delivery. Focused regressions
cover missing, negative, fractional, malformed and conflicting Entry IDs and
conflicting Reply aliases/fragments. Valid path-only legacy targets remain usable.

Check-to-send races remain possible:
these checks are not an atomic transaction with external push delivery. The
historical finding and broader acceptance requirements below remain relevant;
this checkpoint does not claim that every notification audience is finalized.

## Historical Entry gap (addressed above)

At revision `0ca014d2`, `notification-access.ts` authorizes only
`chat_message_created`; every other event returns true. Both
`NotificationInboxSerializer.serialize` and `NotificationDeliveryService` use
that guard. The serializer then loads Post and Reply documents by ID, without
published-status or current Room-access predicates. Delayed push delivery can
send a retained event excerpt without invoking the serializer.

This was a privacy defect, not merely a performance concern. An
Entry notification does not constitute a separately saved copy. Membership
removal, Room deletion, visitor expiry, or a limited visitor's current Entry
changing must affect notification visibility too. Existing Chat regressions do
not establish Entry notification safety. No external disclosure was attempted
as part of this source audit.

## Round notification boundary

The shared guard now validates Round identities across payload aliases and
legacy Board/activities paths, rejects Board/Room mismatches and missing sources,
and resolves current Room access without granting or renewing visits. Active
Round notices follow existing detail visibility; archived Round notices require
member access or Open visitor history. Draft/other statuses remain unavailable
to visitors. Entry-target checks still apply when a notice also names an Entry.

Persisted regressions exercise active/archived/draft transitions, Open versus
limited history, parent membership loss and expiry, including inbox and immediate
delivery suppression. Lease records remain unchanged. Delayed-delivery tests
prove missing Round sources cancel sending and database errors remain retryable.
Malformed identities and mismatched Room/Board/path references are covered.
All seven targeted notification files pass 57 tests; TypeScript and lint pass.
The earlier complete backend result predates this change.

Producers traced: ActivityNotificationsService creates reminders, deadlines and
phase notices; ArtBeforeChorusActivityService creates contribution-removal
notices with moderation text. The guard does not call ActivitiesService.show,
which has lifecycle side effects. Invitation/introduction semantics and external
check-to-send races remain separate work. Round audience changes after an
external send cannot retract already delivered content.

## Ownership and compatibility requirements

- Keep one shared content-access guard for inbox serialization, immediate
  delivery and delayed push. Apply it before identity/document hydration or
  external delivery. Database errors must propagate for retry, not allow access.
- Reuse `CircleAccessService.resolve` and
  `canReadPublishedPostWithRoomHistory`; notification reads must not grant or
  renew visits. `replies/reply-access.ts` already composes published-parent
  visibility for Room entries and excludes private Project entries.
- Resolve legacy target paths as well as `event.post_id`. The serializer
  currently recognizes `/post/:id` and `/posts/:id`; a retained reply fixture
  uses a null post_id with `/app/entries/4#reply-7`.
- Reply identity may be stored as payload `replyId`, `reply_id`, or a
  `#reply-...` fragment. Verify that the current Reply belongs to the authorized
  parent and is published before exposing its retained excerpt or document.
- Current producers in `PostNotificationsService`, `RepliesService` and legacy
  Boss handlers write Room-scoped Post/Reply events. Mention events must be
  classified by their actual content target rather than treated as globally
  readable by event name. Invitation and introduction notices have different
  access purposes and must not accidentally require existing Room membership.

## Required evidence before closing

Exercise inbox, immediate delivery and delayed delivery with actual persisted
Room/member/lease/Entry/Reply changes: active member, removed member, deleted
Room, expired visitor, changed current Entry, unpublished parent, unpublished
Reply, and a Reply paired with another Entry. Include legacy path-only targets,
missing or malformed IDs, and authorization-query failures. Ensure suppression
occurs before document/identity hydration and external sending. Retain records;
withholding a notice must not delete the event or its source content.

The existing tests use mocked access for most notification presentation cases.
Those fixtures need explicit authorized parents; adding permissive fallbacks
to production code to preserve them would retain the defect.

## Shared Round visibility owner

`server/api/v1/activities/activity-visibility.ts` owns the status-visibility rule
used by both ActivitiesService.show (including rechecks after lifecycle changes)
and the notification guard. Callers establish current Room access first. The
function grants neither participation nor result-content access. No existing
access owner was found under the activities service directory; extracting the
existing detail rule removes the duplicate introduced by notification enforcement.
Eight targeted backend files / 78 tests, quality TypeScript and lint pass.

## Introduction source boundary

Introduction notices now require a valid consistent source identity, an
unretracted Introduction, the viewer's unhidden recipient record and current
Room membership. This follows the existing Square introduction read boundary,
which excludes visitors. Creator visibility on a Square does not make the
creator a recipient of someone else's notification. Associated Entry identity
comes from the source Introduction and must pass the existing Entry guard;
a conflicting event Room or Entry is rejected.

Persisted tests verify hiding, retraction and membership loss suppress inbox and
immediate delivery while retaining source data. Malformed IDs are rejected before
reads. Delayed missing-source cancellation and query-error retry include
Introductions. Seven notification files / 62 tests pass; quality types and lint
pass. Room invitations and knock suggestions remain separate unclosed audiences.

## Membership invitation source boundary

Invitation notices resolve circleMemberInvitation by invitation_id and validate
recipient, Room and target path. Pending invitations remain readable without
membership: notification visibility does not grant a visit or Room content.
Declined/revoked sources and deleted Rooms are withheld. Accepted invitations
require current membership before retaining notice visibility.

Persisted tests verify pending readability with no Room access or visit record,
revocation/deletion suppression before inbox/immediate delivery, and source
retention. Unit coverage adds wrong recipient/path and accepted membership
semantics. Seven targeted files / 64 tests, quality types and lint pass.
Knock suggestions still need adjacency-based source/audience checks.

## Knock-suggestion eligibility

Knock suggestions now validate their addressed recipient and current child Room.
The child must remain live, Closed, and attached to the parent referenced by the
notice. Current parent membership is required, matching the suggestion producer;
existing child members no longer receive an invitation to knock. Resolution is
read-only and never creates a knock or lease. Source membership/Room queries
propagate errors rather than permitting delivery.

Persisted coverage checks wrong recipients, parent membership loss, Open/Ajar
changes, child deletion, and joining the child, including inbox/immediate
suppression and absence of knock/visit records. Seven notification files / 65
tests pass. Broader unknown event families and external check-to-send races are
not closed by this checkpoint.

## Join-request and approval audiences

Join-request notices validate their addressed recipient, source request, Room
and target path, then require current Room management rights. Historical request
status does not itself remove a manager's existing right to inspect the request.
Approval notices require the source applicant, an approved request and current
Room membership. Current Room resolution also withholds deleted Rooms.

Persisted tests verify ownership transfer, disabled applicant membership,
reversed approval and Room deletion suppress inbox and immediate delivery while
retaining the request. Unit coverage adds wrong recipients and visitor access.
Seven targeted files / 67 tests, quality TypeScript, lint and diff checks pass.
This does not claim all event families or external delivery races are closed.

## Chat save-request source boundary

Active producer ChatService.requestMessageSave creates a retained excerpt for
the message author. The guard now requires the pending request, matching message,
addressed owner, current message author, matching Room/path, and canonical Chat
read access. This inherits message expiry, publication and Room audience rules;
lookup failures propagate. A persisted expiry regression withholds inbox and
immediate delivery while retaining both request and message. Unit checks cover
mismatched identity, status and authorization-query errors.

Seven targeted files / 69 tests and touched lint pass. Legacy chat_reply_created
and targetless chat_message_saved_as_post handling, plus unknown-event fallback,
remain to audit; this checkpoint does not declare the event catalogue closed.

## Legacy Chat notices and targetless fallback

Historical chat_reply_created notices now require a published Reply associated
with the stated Chat message, consistent Room/path identities, and current Chat
visibility. Actual persisted expiry suppresses both save-request and historical
reply notices without deleting sources. New Chat replies remain disabled.
chat_message_saved_as_post requires a valid authorized Entry target; the saved
copy's audience governs that notice independently of source Chat expiry.

The permissive targetless fallback is removed. A notice must pass an explicit
relationship/Chat rule, a verified Introduction/Round source, or the existing
Entry-source checks. Unrecognized targetless notices are withheld; retained
records are unchanged. This is not a claim that every possible historical event
shape has been inventoried in production.

Seven targeted files / 72 tests passed, followed by the extended persisted
expiry file (seven tests). Quality TypeScript and touched lint pass. A complete
backend rerun remains required after this series of notification changes.

## Query-cost audit after authorization enforcement

The list reader caps raw fetches at 250 and its existing regression proves that
fully withheld pages still return a cursor. This bounds one list request but
not badge work: UnseenContentService.countForUser scans all unread records in
250-row pages and retains a Set of all reply-group keys. countResponsesToOwnPosts
also loads all owned Room Entry IDs before scanning matching unread notices.
HomeService invokes total, own-response and up to five per-Room counts.

NotificationInboxSerializer starts one access promise per item with Promise.all;
each may perform several source and Room/ancestor queries. A page cap therefore
does not prevent 250 concurrent access chains or repeated lookups for the same
Room/source. The Prisma schema and checked-in SQL migrations contain only the
inbox primary key and (notification_event_id,user_id) unique index, not indexes
leading with user_id for the actual list/unread queries. A read-only pg_indexes query confirms those same two indexes in the isolated
remediation database. Live retained/production index state has not been verified
in this audit.

Next performance work must add measured recipient/order indexes, bound concurrent
access work, and reduce repeated source/access reads within a single request
without retaining authorization across requests. Preserve exact unread grouping
and visibility; silently truncating badge history is not a valid optimization.
Use realistic persistence/query plans and query-count measurements, including
large withheld histories, before closing the query-efficiency dimension.

## Complete backend verification after notification changes

At code revision 7b5c2a63, all 192 backend files / 1,281 tests pass in 130.90
seconds against afire_remediation_20261029_test. This supersedes earlier
notification checkpoints that required a complete rerun. Passing tests do not
close the query-cost issues above or production inventory/restore gates.

## Bounded authorization fanout

The serializer now checks access in batches of eight per serialization call,
preserving input order and checking every item. It introduces no cross-request
cache. If a check fails, later batches are not started and hydration is skipped.
Already-running checks in that batch may finish; no unauthorized fallback is used.
A deferred 250-item regression observes the concurrency bound and complete input
coverage, including reverse completion order. A failure regression verifies no
later batch starts. Nine targeted files / 92 tests and lint pass.

This limits per-call pressure, not global concurrency or total query count.
Recipient indexes, duplicate source/Room reads, exact count aggregation, and Home's
repeated scans remain outstanding performance work. Eight is an explicit local
ceiling, not a benchmark-derived database capacity claim.

## Recipient query indexes

CLI-generated migration 20261030042000_notification_inbox_recipient_indexes
adds (user_id,created_at,id) for descending recipient timelines and
(user_id,seen_at,id) for ascending unread scans. The existing event/user unique
constraint remains. Migration applied only to the isolated remediation database,
which now has 48 migrations; retained local and production DBs were not changed.

The regression builds a disposable 50,000-row/100-recipient table with the prior
indexes, runs EXPLAIN ANALYZE/BUFFERS before and after applying the actual migration
SQL to that table, and verifies both new index choices, reduced optimizer cost,
identical selected IDs/order and unchanged row count. It also checks installed
public index names. All probe data is rolled back. The index/list/unseen suites
pass 19 tests; the strengthened plan regression passes separately. Quality types,
lint and diff checks pass. This is a controlled planner test, not a production
latency claim. These regular CREATE INDEX statements can block writes while
building; schedule deployment based on retained table size and maintenance needs.
Indexes do not resolve repeated authorization reads or full-history badge scans.

## Owned-response candidate filtering

UnseenContentService.countResponsesToOwnPosts now filters owned published Entries
through the notification event's Post relation in PostgreSQL. It no longer loads
all owned Entry IDs into memory or sends an expanding IN list on every page.
Recipient, unread, event Room and Entry Room constraints are preserved, followed
by the existing canonical serializer and reply deduplication. Empty Room scope
returns zero without querying.

A persisted candidate test excludes other authors, deleted Entries, other Rooms,
wrong event Rooms, seen notices and other recipients. Existing count/Home tests
pass: three files / 17 tests, plus quality TypeScript and lint. This removes an
unbounded preliminary allocation, not the remaining full-history count scan.

## One unread scan for Home total and Room badges

UnseenContentService now has one internal count collector used by countForUser
and countForUserWithRooms. The latter derives overall and requested-Room counts
from the same serialized authorized batches; original inbox item IDs supply Room
identity. Each Room retains its own reply-group deduplication, while the overall
count still includes eligible notices outside Home's five displayed Rooms.
Home consumes this result once instead of running five additional Room scans.
The separate owned-response count remains unchanged.

Count/serializer/Home tests pass (24 tests), followed by all eight Home tests
including a new explicit single-call/Room-badge integration assertion. Coverage
includes duplicate replies, seen and withheld notices, absent Rooms and overall
notices outside the selected Rooms. Total unread-history traversal and growing
reply-group sets remain; this removes repeated scans, not those remaining costs.

## Unread scan continuation after anchor removal

Both unread count scans now continue with id > lastObservedId rather than a
Prisma cursor that requires the preceding row to exist. This uses the recipient
indexes while preserving ascending order and 250-row batches. A rolled-back
PostgreSQL regression creates 251 notices, removes the first batch's anchor during
serialization, and proves the next batch still reads the final notice.
Three count/Home files / 20 tests, quality TypeScript and lint pass.

Counts remain live observations: already-observed rows can contribute even if
removed later. This change prevents premature termination, not a transaction-wide
snapshot or a bound on continuously growing history. The list endpoint's
created_at/id cursor is a separate contract and was not changed here.

## Full backend checkpoint after unread query changes

At code revision 216716f0, the complete backend suite passed: 194 files /
1,288 tests in 132.33 seconds. Quality TypeScript also passed. The runner
selected only afire_remediation_20261029_test on localhost, confirmed all 48
migrations applied, and reported no pending migrations. This checkpoint covers
the combined notification access, bounded authorization concurrency, recipient
indexes, database-owned response filtering, shared Home count scan and stable
unread scan advancement. It does not establish production migration or restore
readiness, browser acceptance, or completion of the architectural remediation.

Next concurrency gap found by inspection: UnseenContentService.markPostSeen
loads PostViewState, compares reply cursors in application memory, then writes
unconditionally. Two overlapping requests can both compare against an older
state and the later write can regress the read cursor. The unique-conflict
creation fallback also writes without rechecking the stored cursor. markAllSeen
already uses database-side monotonic comparisons; the per-Entry mutation needs
equivalent atomic semantics and a persisted regression test. This is an observed
code-path risk, not yet a reproduced concurrency test or a completed repair.

## Atomic per-Entry read positions

markPostSeen now performs one PostgreSQL INSERT ON CONFLICT instead of reading
state and performing an unconditional update/create fallback. The shared conflict
clause, extracted from markAllSeen, advances post timestamps and reply (time, ID)
cursors independently and preserves newer updated_at values. Both mutation paths
use this one merge owner. No schema or retained-data migration was required.

A rolled-back PostgreSQL test delays an older request before its mutation until
a newer request has created the row, then verifies no regression, one row,
equal-time ID ordering and independent post/reply writes. It explicitly sets a
non-UTC session zone; the new per-Entry insert binds UTC ISO text to timestamp
columns to avoid session-zone conversion exposed by the first regression run.
Four targeted unread/Home files / 19 tests, quality TypeScript, touched ESLint and
diff checks pass. The prior full-suite checkpoint predates this repair.

The test deterministically overlaps requests before SQL submission within one
rolled-back transaction; it does not claim a two-connection lock-contention test.
Authorization still precedes this mutation and is not made atomic with it here.
The older markAllSeen input timestamps also need explicit timezone verification;
its shared conflict comparison is covered structurally but its full persisted
selection/merge behavior deserves a dedicated regression.

## Mark-all UTC regression and repair

The follow-up persisted regression reproduced a ten-hour shift in markAllSeen's
post_seen_at under a Pacific/Honolulu transaction session. Raw Date parameters
were converted through the session zone before storage in timestamp-without-zone
columns. The three input timestamp expressions now explicitly parse UTC ISO text,
matching the per-Entry path. Existing reply timestamps continue to come directly
from stored reply records. No retained records were rewritten.

The rolled-back test checks actual stored post/creation/update times against the
request interval, equal-timestamp reply ID ordering, exclusion of drafts, entries
at the membership cutoff and entries without a Room, plus preservation of later
post/reply/update timestamps on a repeated mark-all call. The pre-fix test failed
on the timestamp interval and passed after the repair. Four unread/Home files /
20 tests, quality TypeScript, touched ESLint and diff checks pass.

This does not prove atomicity between the read-state SQL and the subsequent inbox
seen update: they are still separate writes outside a caller transaction. That
partial-failure boundary remains a lifecycle/recovery item for the broader goal.

## Atomic mark-all read-state and inbox mutation

markAllSeen now combines the view-state upsert and recipient-scoped inbox update
in one PostgreSQL statement using a data-modifying CTE. The request cutoff and
UTC timestamps are unchanged. This removes the two-autocommit-write failure
boundary; count serialization runs after mutation completion and can still fail
independently without undoing a successful mark-all action. Retrying is safe.

The persisted test introduces a fixture-specific check constraint, exercises a
failed inbox update, rolls back to its savepoint, confirms unchanged state, then
retries successfully and verifies both stored read positions and inbox seen_at.
The fixture and temporary constraint are rolled back. This verifies PostgreSQL
failure/retry behavior inside a transaction; it is not an independent two-client
autocommit failure test. A unit contract additionally asserts one SQL execution
and no separate inbox mutation. Four unread/Home files / 20 tests, quality
TypeScript, touched ESLint and diff checks pass.
