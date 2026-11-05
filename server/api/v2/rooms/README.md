# Chat attachment Entries

`ChatService.publishDraftMessage` and `EntriesService.ensureChatAttachmentEntry` own the attachment-to-Entry boundary. The existing `ChatMessage.entry_id` relation identifies the canonical Entry. No schema migration or parallel reply model is required.

## Publication and uploads

- Attachment messages keep `timeline_kind=message`. Their Entry is a published `mixed_media` Entry with `creation_origin=chat_attachment`, `reply_mode=simple`, the original author/Room/timestamps, and no Square or project assignment. The rich document is copied without presentation conversion.
- Lock the message before publication. Message status, Entry, Document, media ownership, legacy reply associations, notification event, and the existing Chat fanout job commit together. Repeated publication of the same draft returns the existing result. This path never announces a Wall/Round post or marks a message saved.
- The Chat draft nonce is unique per author; concurrent allocation resolves to one draft. Text-only sends retain their current path. Attachment sends must use an uploaded Chat draft.
- Chat upload binding, explicit draft discard, and publication use the same message lock. Recheck the author, Room membership and draft state at upload commit. Failed binding removes the staged bytes; audio/video jobs commit with the asset. A failed send retains its draft/uploads for retry. Explicit discard deletes owned bindings/assets and purges orphan blobs under the canonical blob lock.
- Validate every referenced upload against its message or linked Entry before binding. Original audio/video IDs survive promotion, preserving playback identity. Asset ownership is valid before processing creates attachment rows. The shared snapshot copier creates independent media IDs only for a separate project copy or explicitly published conversion draft.

Generic files use the existing upload endpoint and response (`file.url`, `filename`, `byte_size`, `content_type`). Their document node is `file` with `attrs: { src, filename, size, contentType }`; `src` must be a local `/api/v1/uploads/<id>` URL. File bindings use `name=file`. The existing authenticated media delivery, private revalidation, safe Content-Disposition and upload size limit apply.

## History and saved conversion drafts

History repair is lazy and bounded to the authorized message/page. It creates Entries for eligible unlinked attachment messages, including old timestamps, and reuses valid published same-Room links. It associates legacy Chat replies to the Entry without changing reply IDs or documents. Plain text, announcements and post links keep their existing behavior.

A linked conversion draft is detached without changing its ID, status, document or format data. Existing provenance is retained; `source_chat_message_id` records the source only when provenance lacks it. The new canonical Entry uses the original message content, while the conversion draft keeps its edits. It is never published automatically.

When the saver later explicitly publishes that draft, it becomes an independent Room post. The canonical Entry/message/replies/saved state remain unchanged and no duplicate Chat announcement is created. Selected source media is copied using the canonical snapshot owner; media already owned by the edited draft stays owned by that draft. Media copies, processing jobs, document changes and publication share the locked transaction; failed publication leaves no cloned rows and retry creates one independent set. The two Posts have separate reply threads. Existing saver/member permissions still apply.

Invalid cross-Room/private links, non-conversion draft links, deleted links and dangling or unauthorized media are not silently repaired. A failed historical repair rolls back completely and leaves the original message readable. There is no bulk backfill or production data rewrite.

## Reads, replies and identity

Post detail, authenticated uploads, audio/video, and PostChannel visitor authorization use `CircleAccessService.canReadPublishedPostWithRoomHistory` with the resolved Room access context. Open visitors may read published Room history; Ajar and admitted Closed visitors retain current-entry visibility. Chat attachment Entries additionally require a live original message and follow the Room's Chat history window. Direct original Chat media uses `canReadPublishedChatMessage` for the same expiry/history boundary. Visitors may create, edit and publish their own Entry replies while the parent Entry remains visible; every mutation rechecks current Room and history access. Chat message reply threads remain unsupported. Private project snapshots retain their project audience; Chat previews hide project metadata when the viewer cannot access that project.

The Entry's published replies supply `reply_count` and up to three unique `reply_participants` on the existing Chat payload (also present in `post`). Existing PostChannel reply and ChatChannel `post_reply_count` events update clients. Legacy Chat reply endpoints adapt to the same Entry thread.

Identity display follows the existing canonical Room serializers: membership display-name overrides and the current avatar policy. Chat masking/expiry presentation is dormant (`masked_author=null`); this change does not introduce a new anonymity policy or remove existing canonical Entry raw-username fields.

## Regression evidence

`tests/backend/integration/chat/attachment-entry.integration.test.ts` exercises actual Prisma/PostgreSQL transactions and local synthetic storage: concurrent draft/publication, queue rollback/retry, real generic/audio/video upload creation, lazy history and old reply identity, preserved edited drafts, separate media/replies, private project copies, visitor/member boundaries, Room display overrides, and late upload cancellation. It performs no real upload or external storage/network action. Use a disposable local test database; final combined checks belong to the integrating task.

## API naming contract

Room endpoints use `/api/v2/rooms` (and Room-owned v1 resources use `/api/v1/rooms`). Entry endpoints use `/api/v1/entries`; Round endpoints use `/api/v1/rounds`. Request/response references use `room_id`, `entry_id`, and `round_id`, or the matching camelCase names in existing camelCase representations. Frontend API modules and realtime subscriptions use the same contract (`EntryChannel`, `NoteChannel`).

This is a coordinated server/client change: old API endpoint names are not deployment compatibility aliases. Existing application links remain supported. Stored attachment discriminators, notification event kinds, queue names/job identity keys and historical document mention attributes retain their persistence meaning; their adapters accept historical values without relaxing authorization. New mention targets are `user`, `room`, `note`, and `round`.

No production migration or deployment is part of this naming change. The Prisma Round rename changes only its application mapping; the physical schema diff is empty.
