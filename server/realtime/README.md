# Note collaboration persistence and delivery

Note content is authoritative in the PostgreSQL document record: its Yjs history and JSON projection are committed together. Whole-document HTTP saves require the expected revision. Incoming collaboration packets and server insertions commit under the Room/Note lock before live delivery. Replayed Yjs state does not create a revision when it adds no state.

`withNoteDocumentTransaction` publishes an ID-only `afire_note_changes` notification inside the transaction. PostgreSQL delivers it on commit and suppresses it on rollback. This covers HTTP, collaboration and reflection-worker callers of that owner. The helper also invalidates on successful read-only/load transactions; notifications are hints to read current state, not an audit stream.

Each listening HTTP server opens one dedicated PostgreSQL session through `NoteChangeListener`, using `DATABASE_URL`. This connection requires direct PostgreSQL or session pooling; transaction pooling cannot preserve a LISTEN subscription. Allow one extra database connection per API process. Workers publish through their existing transaction and do not require a listener.

`HocuspocusService` coalesces IDs for locally loaded/loading Notes and reads at most 64 document records per batch. Committed Yjs state is merged into both current and legacy live aliases. The outgoing socket boundary still checks current authorization for every content-bearing delivery; receiving a database notification grants no access. The listener carries IDs only, never content or credentials.

## Recovery and shutdown

PostgreSQL notifications are not a durable event queue. The document record remains the source of truth. The listener reconnects with exponential delays from one to thirty seconds, enables TCP keepalive, and requests a refresh of all locally loaded/loading Notes after LISTEN is active. This repairs notifications missed during disconnection. Failed snapshot queries retain their pending IDs and retry after one second. Normal HTTP closure and Nest module destruction close the listener and cancel retry timers.

Warnings distinguish listener disconnection (`[Notes] Change listener disconnected; reconnecting`) from snapshot-refresh failure (`[Notes] Committed-state refresh failed; retrying`). A corrupt stored Yjs snapshot is isolated from the rest of its refresh batch and logged as `[Notes] Invalid committed state for Note <id>`; the listener does not attempt automatic data repair. These messages are diagnostic evidence, not an operational alerting or health-check system. API shutdown now stops HTTP admission, disconnects realtime clients, waits for collaboration documents and active writes to drain, then closes Boss and Nest before telemetry cleanup. The worker drains Boss before closing Nest. A shared 40-second deadline reports failure rather than a successful exit if cleanup does not finish.

## Verification and limits

The wire integration uses two independent HTTP/Hocuspocus instances with separate PostgreSQL listeners. It covers live edits, HTTP replacements, stored and audio-adjacent inserts, commit-before-delivery, failed writes and revoked recipients. The listener integration checks rollback suppression, termination of its own database session, reconnection and full-refresh requests.

Reflection creation commits its record and Boss job in the same Room/Note transaction, with destination authorization checked inside the transaction. Database integration tests verify rollback of both records when queue insertion fails. A separate forced-stop test kills a real reflection worker before its effect and after commit but before acknowledgement. Boss expiration and replacement processing preserve exactly one content insertion and provenance marker. The fixture advances only its job's start timestamp to exercise the installed defaults (15-minute active-job expiry, two retries) without a fifteen-minute wait. This proves recovery for the reflection processor; it does not establish idempotency for other job kinds or duplicate HTTP requests.

This does not synchronize awareness/presence between servers. Load/backpressure benchmarks, corrupt-state repair, full-screen offline/conflict recovery and a deployed rollout/drain rehearsal remain open. Notification delivery does not prove that an edit still confined to a user's offline browser has been persisted.

## Room completion invalidation

Wall publication now calls `notifyRoomChanged` in its database transaction. Its
`afire_room_changes` notification contains only the Room ID and is suppressed on
rollback. `RealtimeService` starts one shared `CommittedIdChangeListener` per API
with a Socket.IO server; worker-only application contexts do not start this listener.
This adds one session-capable PostgreSQL connection per API alongside the Note
listener. It has the same direct/session-pooling requirement and reconnect behavior.

Each API coalesces hints for locally subscribed Chat rooms and drains at most 64
Room IDs per batch. Delivery goes through the existing per-socket authorization
owner and contains only `{ type: "invalidate", circle_id }`. The Expo Room
subscription already refreshes Room home, Round/Wall data and Chat history on this
event. Listener reconnect requests fresh invalidations for all local Chat-room
subscriptions. Module shutdown stops the listener/timer and drains the active batch.

The two-server socket regression uses actual Wall publication to prove commit-only
delivery, rollback suppression, missed-hint recovery after listener restart, and
membership revocation before delivery. Existing gateway tests cover visitor-specific
authorization. These are invalidation hints, not exactly-once events or guaranteed
delivery to offline clients. Client reconnect/read refresh remains necessary, and
per-recipient authorization failures fail closed. Other Room writes are not yet
all publishers on this channel; presence is still local to each API.

The canonical Entry `publish` transaction also calls `notifyRoomChanged` after
persisting publication events and queue work. Failed transactions produce no hint;
serialized publication retries do not publish duplicate hints. This covers the
ordinary/shared Entry publication coordinator, including its supported conversion
branches. Room-entry withdrawal also publishes a hint inside its transaction;
retries of an already withdrawn Entry do not publish another hint. Other legacy
mutations and feedback changes are not yet covered by this transport.

Round participation joins/role changes and withdrawal now queue the same Room hint
inside their persistence transactions, including Rounds with no Board. Withdrawal
rechecks membership under the Room lock and rereads participation under the Round
lock; repeated withdrawals do not queue additional hints. Historical Board-channel
emissions remain compatibility hints. Round detail screens attach through the
existing Room subscription; catch-up and content invalidations refresh the mounted
Round detail. Room lists refresh by Room key on catch-up. Round creation/edit/start also queue Room hints after their scheduled jobs in
the same transaction. A repeated start of an already active Round schedules any
missing jobs without sending a redundant hint. Standalone Round lists attach to
the same subscription owner in both frontends. Creative artifact submission, cover choice and removal also queue hints in
their transaction. Repeating an unchanged cover choice emits no extra hint.
Draft Feedback Round cancellation sends a hint without publishing a Wall.
Create/edit/start milestone writes now share the caller transaction; runtime
suppresses local socket emission until the committed Room hint. Creative submission also writes its phase milestone before the Room hint.
Completion retains its existing transactional milestone/Wall write without
redundant post-commit writes. Background recovery acquires the Round lock and repairs all reached milestones
in one transaction, using a bounded lookup of the three canonical nonce keys.
Only newly materialized messages queue a Room hint; unchanged retries do not.
Cross-process delivery uses the same committed listener as interactive writes.
