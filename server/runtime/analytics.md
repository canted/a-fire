# Capture pilot analytics

Dashboard: https://us.posthog.com/project/284030/dashboard/2304834

## Ownership and collection

`posthog.ts` remains the backend delivery owner. Services emit after successful database transactions; telemetry failure must not fail a persisted mutation. Browser tracking lives in Expo's explicit `analytics.web.ts` adapter, called by the session owner and canonical upload hook. Native adapter is a no-op; native acceptance is deferred.

Authenticated browser distinct IDs match the backend user IDs. Account changes and logout reset browser identity. Route templates exclude invite tokens, query strings, and unknown paths. Repeated mounted-route effects are deduplicated; returning to a different route and back creates another view. Browser errors record error category only. Session replay and implicit click/text capture are disabled.

No artwork, captions, prompts, passwords, file names, local paths, or source URLs belong in these new analytics events. Media summaries contain types and counts. Existing server exception capture remains separate and needs its own redaction review before expanding diagnostics.

## Event inventory

| Event | Meaning / owner |
| --- | --- |
| `screen_viewed` | Actual Expo route change; route template and available Project/Entry/Room/Activity IDs |
| `app_error` | Browser unhandled error/rejection category; no raw error text |
| `attachment_upload_started/succeeded/failed` | Canonical upload hook, media/target type and duration; success means upload response, not finished transcoding |
| `project_created` | Project persistence; stable `$insert_id` deduplicates creation-request retries |
| `project_entry_saved` | First draft-to-published private save, after commit |
| `project_entry_updated` | Subsequent persisted edits, including autosaves; never count as new captures |
| `project_entry_deleted/moved` | Private-original change after commit; Room copies remain independent |
| `entry_share_prepared` | A new independent Room draft is prepared; retry returns do not emit again |
| `post_published` | Existing successful Room publication event, now with source Entry and Activity linkage |
| `entry_withdrawn` | Published Room copy withdrawn after commit; repeated withdrawal does not emit |
| `reply_published` | Existing successful feedback publication |
| `project_feedback_kept` | New feedback/Chat snapshot, including grouped feedback; no-op retries do not emit |
| `project_feedback_removed` | Grouped feedback keep removed; tracks snapshot count |
| `chat_messages_read` | Newly persisted dwell-based read receipts only; sum `message_count`, not event count |
| `chat_message_sent` | Committed Chat send or post link; idempotent retries do not emit again |
| invitations, Rooms, notifications, reflections | Existing backend events retained |

Room copies have no `project_id`. Join `post_published.source_entry_id` to `project_entry_saved.entry_id` or use `entry_share_prepared` to connect copy, original, and Project. Do not interpret a person-level save/share funnel as proof that the same entry was shared. Use entry IDs for artifact conversion. A deleted private original does not mean its Room copy was withdrawn.

## Experiment reporting contract — integration pending

`types/capture-analytics.ts` defines allowlisted trigger, acquisition, source, outcome, artifact count, duration, Project and optional Entry IDs. `captureExperimentOutcome` validates and reports only with explicit reporting consent. The future MCP owner must authorize Project access and read stored consent before calling it; consent is not to be trusted from an agent-supplied boolean.

Triggers: monitoring, user request, scheduled reminder, completion offer.
Acquisition: existing artifact, user capture, agent capture.
Sources: folder, website, agent session, selected library item, direct handoff, other.
Outcomes: saved, declined, skipped, no material, source unavailable, failed, duplicate, suppressed deleted.

Report outcomes without an entry too, so successful captures do not conceal unsuccessful reminders or unavailable sources. Workflow details are agent-reported. Missing reports are unknown, never zero activity. The first MCP link-capture slice now supplies a producer, connection-level reporting consent, source receipts and private-entry automation attribution. Capture agreements, non-save reminder reporting, media handoffs and automated Room sharing remain unimplemented. See `../api/v1/agent-connections/README.md`. The contract requires an opaque UUID `attempt_id` and uses a stable `$insert_id` to deduplicate report delivery. Emit one final outcome per attempt; a new attempt gets a new UUID. Those owners must persist attempts and durable provenance rather than treating PostHog as their database.

## Dashboard and interpretation

The dashboard has live existing sharing/reply/invitation/error charts and charts labelled awaiting release for newly added events. It initially includes all users: pilot members and internal accounts still need selecting. Historical events lack the new `deployment` field; do not silently label them production. Server events now carry `FLY_APP_NAME` or `local`; browser events have `surface`, `platform`, environment and analytics version.

Useful follow-on charts once agent reporting is integrated: capture outcomes by trigger/source/acquisition; unique retained entries; source-entry-to-Room-copy conversion and delay; deletions and withdrawals; return visits; feedback received and kept. Use distinct IDs rather than raw event counts for unique artifacts and people. PostHog delivery is best effort, not a durable audit log or deletion-suppression database.

## Release and verification

Backend: `POSTHOG_KEY` / `POSTHOG_HOST`, falling back to `VITE_POSTHOG_KEY` / `VITE_POSTHOG_HOST`.
Expo web: public `EXPO_PUBLIC_POSTHOG_KEY` / `EXPO_PUBLIC_POSTHOG_HOST` at build time. Release builder and Docker map the existing Vite public configuration into Expo. Runtime Fly secrets alone do not configure a browser bundle; pass public build arguments when building the release. Local collection is off unless explicitly enabled; use a separate test project. Backend development/test collection also requires `POSTHOG_ENABLE_IN_DEV=true`, preventing local tests from silently polluting the production project.

Verify in a nonproduction environment: sign in; open a Project; save an entry; edit it; prepare and publish a copy; repeat a share request; send feedback/Chat; move/delete the original; withdraw the copy; log out; sign in as another account. Check IDs, no duplicate first saves/share preparation, no events from rejected mutations, and no sensitive fields. Confirm actual browser ingestion and production release separately from passing tests. No automatic alert subscription or session replay has been enabled by this change.
