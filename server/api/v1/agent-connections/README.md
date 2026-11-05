# Codex capture pilot — first slice

Implemented: a stateless Streamable HTTP MCP endpoint at `/api/mcp`, authenticated with an opaque Project-scoped bearer key. This is a personal-key pilot, **not OAuth**. Codex supports bearer-token connections. Do not configure `codex mcp login` for this endpoint.

## Setup after deployment

1. Apply the generated Prisma migration through the normal release process; deploy server and Expo app together.
2. Sign into A Fire, open Profiles → Agent connections. Choose one Project, review its audience, name the connection and choose whether to report pilot workflow statistics. No Project is preselected.
3. Create the key. It appears once, expires after 30 days and is stored server-side only as a SHA-256 hash. Store it privately in the client environment, not in a prompt or committed configuration.
4. Configure Codex for the displayed server URL. Example configuration (replace the example host with the actual deployed host):

```toml
[mcp_servers.a_fire]
url = "https://YOUR_AFIRE_HOST/api/mcp"
bearer_token_env_var = "AFIRE_AGENT_TOKEN"
```

The Codex process needs `AFIRE_AGENT_TOKEN` in its environment. This repository does not alter global Codex configuration or install a CLI. Client documentation: https://learn.chatgpt.com/docs/extend/mcp?surface=cli.

5. Ask Codex to use `get_capture_project`, then `save_link` with a new UUID operation ID and a supplied link. Open the returned entry path and confirm the automation marker. Room sharing remains a manual app action.
6. Disconnect in A Fire to revoke the key. Create a new connection to change Project or reporting consent. A completed in-flight capture may finish before revocation returns; subsequent requests fail.

## Behavior and ownership

The management API uses ordinary user authentication. MCP accepts only the separate opaque key; the key cannot authenticate ordinary application endpoints. MCP calls do not run the human activity-recording guard. Every request validates current Project access and token expiry/revocation. Saving rechecks the grant under a database lock.

Tools are limited to `get_capture_project` and `save_link`. There is no arbitrary API proxy, remote URL fetch, source-code upload, generated caption, or Room-publication tool. Private Projects include accepted collaborators.

Link capture reuses `ProjectEntriesService.create/update`, including current permissions, revision checks and document validation. Each source receipt owns a separate allocation request key, so capture cannot reopen a human draft. The source hash includes the normalized link and optional source version, scoped to user and Project. Same URL/version is a duplicate even under a new operation ID. An operation ID reused for different material is a conflict. Query strings/fragments are preserved as part of source identity; this intentionally does not guess which URL components are meaningful.

Use a source version only for a genuinely new artifact at the same URL. Do not change it to defeat deletion suppression. Deleted, physically removed, or moved entries are suppressed at their original source location. Receipts retain hashes and IDs, not URL text. There is currently no intentional re-import/reset UI. Existing entries retain their normal editable link content. Interrupted saves resume without overwriting a published entry or human edits.

The server owns `automated_creation`. It is independent of `creation_origin`, which retains its existing authorization meaning. Existing Project timeline/detail presentation shows the marker. No automated sharing attribution is claimed because this slice cannot share.

Reporting is optional and stored on the connection. When trigger/source are supplied, the allowlisted outcome contract reports saved, duplicate, suppressed_deleted or suppressed_moved. Missing workflow fields are unknown; never infer monitoring from a save. Collection is best effort and not the durable receipt store. Non-save outcomes and failed requests still need the later capture-agreement/reporting slice.

## Validation

`tests/backend/agent-connections/capture.integration.test.ts` exercises a migrated local PostgreSQL database, canonical entry services, concurrent retries, crash recovery, deletion/move suppression, grant expiration/revocation, and a real HTTP MCP SDK client. Tests never connect to production.

Browser acceptance used the built Expo app and real local Nest server: create a connection, save a link over MCP, open the returned entry with attribution, disconnect at mobile width, and verify the key is rejected. API requests were forwarded from a test HTTPS browser origin to the local server. This is not evidence of an actual Codex desktop connection or production deployment.

## Remaining pilot increments

OAuth onboarding for clients that require it; media transfer and processing status; saved capture agreements; optional non-save/reminder reporting; explicit automated Room sharing and its independent marker; external folder/website monitoring; intentional suppression reset and retention controls. No background job or schedule is created simply by connecting.
