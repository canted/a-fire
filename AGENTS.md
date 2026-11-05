# A Fire — Project Rules for All Code Generation

These instructions MUST be followed for every task.  
Treat all rules in this file as authoritative.  
Never introduce patterns that conflict with this file.

============================================================
1. GENERAL DEVELOPMENT PRINCIPLES
============================================================

Before writing code, first explore the project structure.
When needed, clarify intent via numbered questions, both multiple choice and open ended
IMPORTANT: Prefer retrieval-led reasoning over pre-training-led reasoning for any Rails or other ruby gem tasks.
IMPORTANT: Prefer CLI generated files over manually created files when it comes to migrations.

When creating or revising planning artifacts, prefer this lightweight product-process chain:
Research -> Opportunity -> Decision -> Feature Spec -> Implementation Plan -> Issue/Commit -> Review Note.
Folder names are not authoritative; the artifact's role is. Keep research descriptive and source-facing, decisions explicit, feature specs user-facing, and implementation plans build-facing.

For decision documents, prefer the sections:
- Decided
- Proposed
- Open Questions
- Source Research

Only place items under Decided when they are ready to guide implementation. Put leaning-but-uncommitted choices under Proposed, and keep copied research prompts under Open Questions or Source Research rather than presenting them as settled design.

============================================================
2. PROJECT OVERVIEW
============================================================

A Fire uses Expo Router, React Native / React Native Web, TypeScript and SWR.
The only application frontend is `frontend/src`. Backend code follows NestJS
conventions in `server`; shared server/client contracts live in `types`.
The retired application is archived in Git at `c11cfd65`.

`frontend/site` retains the public website, built with Vite and the root React 18 /
MUI dependency graph. It is not an alternative application frontend. Expo uses its
own React runtime and isolated package.json/pnpm-lock.yaml. Install it with
`pnpm --dir frontend install`; never apply root React/MUI overrides to Expo.

============================================================
3. HARD RULES (DO NOT BREAK THESE)
============================================================

- Expo Router files in `frontend/src/app` only wire feature screens/layouts; no
  feature markup, styling or network calls in route modules.
- UI lives in `frontend/src/features`, shared primitives in `src/components`,
  and SWR-powered reads/writes in `src/hooks`. Never fetch in components.
- Reuse the shared Button and established component contracts. Do not create
  parallel button, message-card, overlay or toolbar implementations. New shared
  primitives require an actual feature need and explicit user authorization.
- Universal components use React Native primitives and StyleSheet, with tokens
  from `frontend/src/styles/tokens.css` and its generated TypeScript projection.
  Browser adapters may use CSS Modules. No Tailwind, MUI, Radix, DOM-only modules
  or CSS imports in universal modules.
- Use explicit platform adapters for storage, lifecycle, files, keyboard/viewport,
  media and lists. Keep browser behavior in web/DOM adapters.
- Public website changes reuse its existing shared components, CSS Modules and
  tokens in `frontend/site`; MUI stays behind its shared primitives. No authored
  MUI sx/styled or Emotion styling. Keep its route tree thin and use full-page
  navigation when entering the Expo application.
- Preserve isolated React/Tiptap runtimes; portable modules must not import React
  or platform effects merely to serve server or website consumers.
- Follow existing folders. Do not create new top-level directories.
- Storybook lives in `frontend/.storybook`, uses Expo's React runtime and real
  production feature components with mocked data/actions and route context.
- Current milestone is Expo web. Verify real routes, desktop/mobile browsers,
  touch, keyboard, history, focus, recovery, reduced motion and transitions.
  A successful bundle is not runtime acceptance.
- Native builds, simulators, devices and store preparation are deferred. Preserve
  adapters without claiming native acceptance. Generated projects/builds stay
  ignored; app configuration and plugins remain their source of truth.

============================================================
4. CANONICAL EXAMPLES
============================================================

Use existing route modules in `frontend/src/app`, primitives in
`frontend/src/components`, feature styles and SWR hooks as executable examples.
The canonical owners below take precedence over historical migration examples.

============================================================
5. BACKEND RULES
============================================================

5.1 Follow Nodejs/NestJS/Prisma/Websocket conventions unless explicitly overridden.  
5.2 Use Prisma migrations for all schema changes. Only create migrations from the command line.  
5.3 Use vitest for testing.  
5.5 Use Boss queue defaults.

============================================================
6. TESTING & QUALITY
============================================================

6.1 Practice TDD when possible.  
6.2 Provide tests for all significant backend features.  
6.3 Write Vitest tests for important frontend logic.

============================================================
7. WORKFLOW RULES FOR THE AGENT
============================================================

7.1 Always generate code that adheres to the established patterns.  
7.2 If a user request conflicts with project rules, explain the conflict and propose a compliant alternative.  
7.3 Prefer existing components and patterns over new abstractions.  
7.4 Never duplicate components or styles that already exist.  
7.5 Complete a reuse audit before editing code:
- Search by behavior, UI role, route, related hooks, and likely architecture terms, not only by the component displaying the bug.
- Inspect implementations in adjacent features and identify the canonical owner of the behavior.
- Reuse or extend the canonical implementation. Do not create parallel behavior.
- If no reusable implementation exists, record what was searched before introducing a new abstraction.
7.6 For cross-cutting behavior such as viewport handling, focus, scrolling, overlays, navigation, editors, media controls, and toolbars, do not modify a leaf component until the existing architecture for that behavior has been traced.
7.7 Do not change a shared primitive to fix one feature until feature-level shells, controllers, and hooks that may already own the behavior have been inspected.
7.8 Before completion, search again for duplicate implementations and ensure tests prove integration with the canonical abstraction where practical.
7.9 Prefer a staged Storybook-first workflow when the primary uncertainty is visual design, layout, responsive behavior, component states, or interaction refinement:
- Establish or confirm the expected data and action contract before substantial UI work so Storybook fixtures reflect a plausible production interface.
- In the Storybook stage, build the real production feature components using the project's shared components, hooks, and styling conventions. Supply realistic typed data and cover the important happy, loading, empty, error, permission, responsive, and interaction states that apply.
- Avoid unnecessary backend changes while the interface is still being refined, but do not create a separate story-only implementation or bypass production architecture merely to make a story work.
- Treat Storybook approval as an intermediate UI gate, not feature completion.
- After UI approval, inspect the existing production data flow and complete all support the feature actually requires, including server, database, authorization, validation, SWR hook, mutation, cache, routing, and error-handling changes. If no backend changes are needed, state why.
- Before completion, verify the approved behavior through the real application route or production-equivalent integration path and run tests appropriate to both the frontend behavior and any backend contract involved.
- Prefer vertical-slice or backend-first work from the outset when the dominant uncertainty is data modeling, authorization, persistence, business rules, external integrations, or server performance. Once the contract is stable, frontend and backend work may proceed in parallel when doing so will not create overlapping implementations or contract drift.

============================================================
8. CANONICAL IMPLEMENTATION REGISTRY
============================================================

Keep this registry small and limited to tricky, cross-cutting systems where duplicate implementations are costly. These paths identify ownership contracts, not merely examples. Update the registry in the same change when a canonical implementation moves.

8.1 MOBILE VISUAL VIEWPORT AND KEYBOARD-DOCKED COMPOSERS
- Expo `features/rooms/RoomWall.tsx` owns shared live and Round-result Wall layout; `wall/WallMember.tsx` owns member/Entry presentation. `wall/wallModel.ts` adapts authorized data without fetching sources. `RoomHome` and `RoundResultView` retain selection context, scrolling, focus and navigation; `useRoundResult` retains result reads and dismissal acknowledgement. `RoundHistoryScreen` presents that same result owner on `/app/rooms/:roomId/round-history`; explicit history navigation pushes this page rather than opening an overlay. Storybook `WallProcessPreview` adapts the same member renderer.
- Expo `features/rooms/RoomRouteLayout.tsx` keeps Room home and `/chat` as URL states of one mounted workspace. `useRoomHome` reads `/v1/rooms/:id/home` through the `room-home` SWR cache, independently of memberBoard; publication, Room subscriptions and shared-copy mutations invalidate that owner; stars on room replies also select those published replies for that room’s Wall; never expose private saved-document edits. Chat reading/exposure owners receive active visibility explicitly, and the platform viewport shell owns keyboard expansion.
- Expo `features/projects/ProjectEntryScreen.tsx` owns the shared `ProjectEntryEditing` used by Project and Room creation. `RoomEntryScreen` chooses an owned private project; `useRoomEntryPublication` shares its persisted source through the canonical copy/publication owners. Room and Project reuse `layout.entryFab` with the shared Button. `ProjectShareScreen` owns durable selective-sharing routes and reopens the server-authorized prepared copy; it reuses `ProjectShare`, `EntryContent`, and `useRoomEntryPublication` rather than reconstructing a snapshot from a changed source.
- Expo `useRoomWorkspace.ts` owns shared Room details, shelf and Wall coordination; `features/rooms/RoomWorkspace.tsx` owns their shared `RoomWorkspaceFrame`. Chat retains reading, exposure and composition controllers. Preserve explicit Chat/workspace presentation differences rather than copying the overlay orchestration.
- Expo `PageScrollView.tsx` applies standard page content geometry and constant audio clearance. Use it for ordinary pages; virtualized/inverted lists and editor shells retain their specialized scroll owners. It must not calculate viewport or keyboard offsets.
- Expo `src/components/ViewportToolbar.tsx` registers editor controls with the existing platform `ViewportShell`; the shell renders the host after its scrollable children and continues to own keyboard/safe-area handling. Its `floating` presentation overlays lone FABs without reserving a toolbar row on web. Do not add editor-local keyboard offsets or independent fixed toolbars.
- Expo `src/components/PopupMenu.tsx` owns contextual menu placement, dismissal, keyboard navigation and focus return; `Select.tsx` adapts the same owner for selection controls. Callers declare `menu`, `dialog`, `drawer` or `page` mode explicitly. Keep compact visual button treatments inside the canonical Button while retaining touch targets.
- `frontend/src/lib/pageSurface.ts` owns shared page background/foreground registration, document safe-area colors, and browser theme-color synchronization. The public-site adapter and Expo web `ViewportShell`/`usePageSurface` adapt this owner. AppLayout registers the default; pages declare overrides through this hook and never mutate document colors or theme metadata independently.
- Expo `useViewportGeometry` adapts the portable viewport observer for both `ViewportShell.web` and portalled `PopupMenu` surfaces; overlay anchoring subtracts the shared viewport offset.
- `frontend/src/lib/visualViewport.ts` owns portable viewport observation; Expo’s web `ViewportShell` adapts it to the application runtime. `frontend/src/lib/documentScrollLock.ts` owns the shared document lock.
- Render docked controls through the shell's `toolbarPortalTarget`. Content that users may review while typing belongs in the shell's designated scroll region.
- The structural styles for the shell currently live under the `visual-viewport-shell*` selectors in `frontend/site/styles/index.css`. Feature-specific overrides must use CSS Modules through the shell's supported class props.
- Required regression coverage for these surfaces should verify: first-interaction focus when requested, document panning suppression, independent content scrolling, toolbar placement outside the scroll region, and visual viewport resize/scroll updates.

8.2 IMAGE UPLOADS, PRESENTATION, AND PRIVATE CACHING
- Expo `AppImage.tsx` and the DOM editor reuse `AppImagePresentation.tsx` for image rendering. `useEditorImage.ts` supplies visible editor images through SWR; only authorized image bytes or public URLs cross the DOM bridge, never credentials. Discard private presentations on route/background/session changes and reauthorize new requests.
- `types/image-policy.ts` owns the browser/server format, size, variant, and transform-version contract.
- `server/uploads/images/image-policy.ts` owns byte decoding/validation and `IMAGE_MULTIPART_OPTIONS`. Use it for every avatar, icon, or banner endpoint; never trust a filename, declared MIME type, or client dimensions.
- `server/uploads/images/image-variants.service.ts` owns materialization, tracking, metadata repair, and purge under the shared PostgreSQL blob lock. Queue processors must not rewrite documents.
- `server/api/v1/uploads/image-presentation.ts` owns batched intrinsic-dimension hydration; select image variants in read representations of posts, replies, and pages.
- `server/api/v1/uploads/identity-images.ts` owns latest avatar-attachment lookup and the user-avatar/circle-icon URL choice. Reuse it for individual identity lookups; retain batched attachment reads for lists.
- `RoomAccessService` owns circle access and current-post visitor rules. Image authorization must follow it before checking ETags or storage.
- Private image HTTP responses must revalidate using `server/storage/media-cache.ts`. Never store authenticated media in service-worker Cache Storage or provide stale private bytes offline. Only the worker's explicit static-public allowlist may use its bounded cache.
- Follow [image implementation policy](server/uploads/images/README.md). CI lint and image regression/integration tests enforce these boundaries. Changes to encoder behavior require a transform-version bump and coverage for animation, orientation, lifecycle concurrency, and authorization before conditional responses.

8.3 DRAFTS AND PUBLISHING
- Expo `useProjectEntryManagement` in `useProjects.ts` owns private-original move/delete mutations and Project timeline invalidation; `ProjectEntriesService.changeLocation` owns authorization, revision checks and ordered Project/Entry locking. Originals have one project; moving/deleting never rewrites independent Room copies.
- Expo `useSaveMessageToProject.ts` coordinates Project creation and retryable Chat saving through the existing mutation hooks. `useRoomDetailsInteraction.ts` owns Room-details selection/action transitions; its view retains element focus and scroll presentation. `useMessageSwipeAction.ts` owns MessageActions gesture state. `useImageSelection.ts` owns Room-creation image picker results and preview disposal.
- Expo `ChatComposer` is text/link/mention-only and uses `useChatDraft`/`useChatComposition`. `ReplyComposer` retains media, recording and timestamp context through `useEntryComposition`. Both reuse `features/content/MentionComposerInput` for native cursor and mention behavior. Composer styles live in sibling `.styles.ts` files. `useChatPaste` rejects binary input; `useReplyPaste` adapts clipboard files to the existing upload owner. Do not restore a mode-switching shared Chat/Reply composer.
- `frontend/src/lib/infiniteQueryRegistry.ts` owns provider-scoped registration of paged queries across both React runtimes. Expo Project hooks register bound page mutations here; invalidation must refresh the aggregate and all loaded pages, not only an individual page cache.
- `frontend/src/contracts` owns entry formats, subjects, link-preview contracts, draft responses and post summaries. These modules remain React-free; shared API modules import them directly. Legacy Posts paths are compatibility exports, not competing definitions.
- `frontend/web-metadata.html` owns Expo web installation metadata. The release builder must not read the legacy `frontend/index.html` to configure Expo.
- `frontend/src/lib/clientBuildReloadBlockers.ts` owns active reload blockers; `clientBuildReloadGuard.ts` owns reload-attempt bookkeeping. React adapters reuse these owners. `frontend/src/lib/scopedDrafts.ts` tracks pending retained drafts across route unmounts. Expo update actions must check both active blockers and pending session drafts immediately before reload.
- Expo `src/hooks/useEntryDraft.ts` reopens prepared Room-entry and Round copies and owns their save/publication and shared cache transitions; it never allocates Square drafts. `EntryContributionEditor` is their shared editing surface; `useRoundContribution` adds Round artifact submission. `useProjects.ts` owns Project entry allocation and persistence. Reuse these owners for Project sharing and onboarding destinations; never create a second draft on cache revalidation. Canonical `contentDraft.markDirty` schedules metadata-only edits such as titles through the same persistence queue.
- `frontend/src/lib/api/entries.ts`, `frontend/src/lib/feedback.ts`, and `frontend/src/lib/replyCache.ts` own portable post/reply contracts; retained consumers import them directly. Expo `useEntryReplies.ts` adapts them to SWR, realtime, and ReplyComposer. `features/entries/EntryRepliesScreen.tsx` owns the reusable `EntryFlow`, including embedded Wall feedback; embedded contributions require published status and inherit the parent viewport shell. `frontend/src/hooks/useAttachmentUpload.ts` owns the reply attachment upload mutation; `src/lib/chatFiles.ts` owns native picked-file FormData conversion.
- `frontend/src/lib/materialDocument.ts` and `frontend/src/lib/postFormatDocument.ts` own portable entry-document conversion. Expo `features/content/DocumentContent.tsx` and `DocumentMedia.tsx` adapt documents to native primitives; media authorization stays in SWR hooks.
- `frontend/src/lib/contentDraft.ts` owns serialized content autosave, revision guards, retry and reset. `frontend/src/hooks/useContentDraft.ts` adapts it to React. `frontend/src/lib/api/entryDraft.ts` and `frontend/src/lib/entryPublicationCache.ts` own portable draft publication and cache transitions. Screens must await successful persistence before navigating; Expo `useDraftNavigation.ts` owns native-stack removal protection and browser unload warnings for editors and pending Save-to-project dismissal.
- Legacy `ContributionEntryFlow` owns Project-backed creation for Round contributions and ordinary Room entries, including Board composer and historical Square creation routes. It creates private originals through `useProjectMaterialDraftQuery` and `ProjectEntryEditor`, then prepares an independent Room copy through `useShareProjectEntryMutation`. `ProjectEntryEditor` owns persistence; `EntryComposition.onBeforeComplete` awaits copy preparation before clearing recovery or leaving. Do not restore Square draft allocation for new Round contributions.

8.4 AUDIO WAVEFORMS
- Expo `features/content/AudioWaveform.tsx` renders transparent waveform artwork over its host surface. `AudioMedia.styles.ts` owns the shared gray tile, control row, and waveform inset for both temporary recording previews and processed audio; preserve those slots while processing completes.
- Expo `features/content/RecordingDrawer.tsx` owns the start/stop recording surface for document and reply composition through `PopupMenu` drawer mode. It transfers stopped files once through `useChatRecording`; the live meter shows a rolling window and `recordingPreview.ts` retains a compact full-duration preview by attachment identity. `useAttachmentUpload` hands it to the session SWR cache, and `useRecordingPreview` retires it when spectral data is ready. Preview samples never enter document attributes, persisted drafts, or uploads.
- Expo `useAudioSeekControl.ts` owns the shared pointer, keyboard and assistive seek behavior used by compact and full audio presentations. Project media keeps the session player and uses the existing media/source authorization owners. Clickable entry previews must render presentation-only content (`EntryContent interactive={false}` or its media-open adapter), never nested playback/retry/link controls.
- `frontend/src/lib/audioPlayback.ts`, `api/audioAsset.ts`, and `audioMediaTransfer.ts` own portable playback context, authorized metadata conversion, and concurrent-only byte sharing. Expo `useAudioPlayback.tsx` owns its session player; `AudioPlayerWidget.tsx` is rendered by the existing ViewportShell. Recycled media rows never own a competing persistent player. Retain source Note-node identity for timestamp replies and reauthorize each playback attempt.
- `frontend/src/features/content/AudioWaveform.tsx` owns all production waveform rendering: approved Tokyo Night palette via `WAVEFORM_PALETTE` and 55% Track detail via `TRACK_DETAIL_OPTIONS` in `frontend/src/lib/spectralWaveform.ts` (original Token Cube retained in the lab), white background, thin contour, optional playhead. Saved audio uses amplitude and color from one spectral result; pending or unavailable analysis uses a baseline, never a separate peak contour. Temporary recorder previews alone may use live amplitude.
- `frontend/src/lib/mediaRecording.ts` and `recordingPeaks.ts` own the portable browser recorder factories; `frontend/src/hooks/useChatRecording.web.ts` supplies the web adapter. The native `useChatRecording.ts` owns Expo capture; both adapters retain review audio until explicit Use or Discard. RecordingDrawer and the existing capture hook own recording UI and cleanup; do not add a second recorder.
- `frontend/src/lib/spectralWaveform.ts` owns FFT, spectral normalization, pixel reduction, and token interpolation. Historical variants remain exclusively in the experiment lab.
- `server/uploads/audio/audio-spectrum.ts` owns bounded file analysis, reused by upload processing and `audio-spectrum.processor.ts` for older-blob backfills. Both use the same portable spectral math. `AudioAssetsService.getSpectrumForUser` authorizes before cached reads or queue insertion. Expo `useAudioSpectrum` is the SWR adapter; never decode or fetch audio inside presentation components. Versioned blob metadata pairs amplitude and color from the same spectral pass. New uploads analyze before publishing ready metadata; the spectrum worker backfills older blobs. Do not generate or persist a separate amplitude analysis.

8.5 CHAT AND SIMPLE REPLIES
- `types/round-links.ts` owns Round detail URL selection for clients and notifications: Room-owned Rounds use `/app/rounds/:id`; retained Board URLs remain supported. Legacy `useRoundRoomContext` adapts existing Room/Board reads for the same detail/edit screens without inventing a Board identity.
- `RoundsService.listForRoom` and Expo `useRoomRounds` own Room Round listing through `/api/v1/rooms/:roomId/rounds`; the legacy Board listing delegates to the same authorized scope reader. Room Round caches use `room-rounds` and must refresh on publication, withdrawal and realtime Room changes.
- `server/api/v1/rounds/round-scope.ts` owns Round Room-scope resolution and historical Board conflict checks. `roundRoomId` requires a loaded Board relation, permits explicit Room ownership without a Board, and preserves consistent legacy inheritance. Chat milestones, Wall publication/read authorization, lifecycle reconciliation and draft access reuse it.
- `server/realtime/committed-id-change-listener.ts` owns PostgreSQL ID-only change subscriptions, reconnect/backoff, stop and post-subscription resync callbacks. `NoteChangeListener` is the Note-channel adapter. Consumers own authorized snapshot/refresh delivery; transport notifications grant no access and are not a durable event log.
- `server/realtime/room-change.ts` publishes commit-scoped Room invalidations. `RealtimeService` owns the API listener, coalescing, reconnect refresh and authorized local socket delivery; reuse these owners for cross-process Room changes.
- `frontend/src/lib/roundTemplates.ts` owns the portable Round template catalogue (names, descriptions, minimum participants, icon pairs and colours); legacy and Expo chooser presentations consume it.
- `frontend/src/lib/feedbackRoundPresentation.ts` owns Feedback Round participation/status copy and submission grouping for the active legacy and Expo presentations.
- `frontend/src/lib/roundDates.ts` owns strict local Round deadline parsing for legacy and Expo forms. `types/activity-templates.ts` owns the shared Art Before the Chorus minimum participant count.
- `frontend/src/lib/api/notes.ts`, `activities.ts`, `board.ts`, `profile.ts`, and `invites.ts` own portable destination contracts; retained consumers import them directly. `frontend/src/lib/noteSubscription.ts` owns Note event filtering and field-scoped mutation merging. Expo Notes, Round and Room-management hooks adapt these contracts to SWR. `frontend/src/lib/materialNodes.ts` owns structure-preserving material text edits. `contentTextExtensions.ts`, `contentNodeSchemas.ts`, `contentImageSchema.ts`, `contentMention.ts`, `audioTimestampSchema.ts`, and `editorBlocks.ts` own shared rich-editor configuration, schemas and block movement. They accept each app's Tiptap runtime instead of importing a competing runtime. Legacy node modules supply browser views; Expo `features/content/RichDocumentEditor.tsx` is the DOM editing adapter, loaded lazily by `DocumentEditor.tsx`. The wrapper owns bridge flush acknowledgement, selected-block inspection/removal, and parent-owned scrolling before persistence; private media, uploads and authentication remain in the native SWR owners. Do not expose credentials or native module execution to the DOM editor.
- `frontend/src/lib/moveNoteBlocks.ts` owns exact selection/range validation for moving Note blocks. Expo `useNoteBlockTransfer` writes the destination before removing the validated source. `useDocumentAttachments` retains picked/recorded files and staged insertions for Note and Round editors through the existing Chat upload/recording owners; its target and media-policy options preserve each destination contract. `DocumentAttachmentControls` is their shared feature presentation. `useNoteAudioReply` retains timestamped reply drafts in the canonical session-scoped store. `documentNodeIdentity.ts` owns reply-marker lookup used by retry protection and the authorized server insertion helper.
- `frontend/src/lib/api/rooms.ts`, `introductions.ts`, `walls.ts`, and `notificationPreferences.ts` own portable Room integration contracts. `frontend/src/lib/roomDetailsModel.ts` owns member ordering/identity and introduction pair keys; `frontend/src/lib/roomWallLinks.ts` owns exact-Wall URL parsing. Expo `useRoomDetails` and `useRoundResult` partition protected reads by current access level. Wall presentation receipts belong to explicit dismissal of the displayed authorized Wall, never fetching it.
- `frontend/src/lib/roomMemberCarry.ts` owns shared member-carry axis locking and target hit testing. Expo `useRoomMemberCarry` adapts measured native/web targets and edge scrolling; mutations remain in `useRoomDetails.submit`. Legacy `useRoomMemberCarry` retains its platform controller.
- `frontend/src/lib/roomDetailsMotion.ts` owns Room panel timing/easing. Expo `useRoomDetailsPresence` adapts retained open/close presence, reduced motion, native Back and focus return; Room screens must reuse it rather than add independent animation controllers. Expo `useRoomOverlayDismiss` owns stacked Escape/native Back dismissal for details, shelves, Walls and nested selection; reuse it instead of adding screen-local Escape listeners.
- `frontend/src/lib/wallTransition.ts` owns browser Wall launcher behavior.module.css`; Expo owns its styling in `frontend/src/styles/wallTransition.module.css`. Platform adapters commit state; keep global snapshot names intact through CSS Modules compilation. Expo `useHistoryMotion.web.ts` routes browser traversal through the existing Room transition controller; do not add per-screen history handlers.
- `frontend/src/lib/entryTransition.ts` and `frontend/src/styles/entryTransition.module.css` own Expo Project card-to-entry expansion, using the existing legacy entry snapshot concept. Keep this separate from Room diagonals; reduced motion and unsupported browsers use cuts.
- `frontend/src/lib/roomTransition.ts` owns browser Room navigation behavior.module.css`; Expo owns its copy in `frontend/src/styles/roomTransition.module.css`. React adapters supply the synchronous navigation commit; Expo `frontend/src/lib/roomNavigationMotion.ts` restricts this motion to Home/Room and Room/Room boundaries. Project, entry and other navigation uses cuts. Expo native uses its platform stack with reduced-motion support.
- `frontend/src/lib/visibilityDwell.ts` owns browser foreground dwell and clipping-aware exposure. Legacy `useVisibilityDwell` and Expo web `useIntroductionExposure` adapt it to their React runtimes; never mark an introduction read merely because it was fetched or mounted. Native introduction exposure remains deferred.
- `frontend/src/lib/chatReadReceipts.ts` owns receipt batching/retry/disposal. Legacy `useChatReadReceipts` and Expo `useRoomReadReceipts` supply SWR mutations; visibility remains per message, never per fetched page or author group.
- `frontend/src/hooks/useSession.tsx` owns Expo session cache/draft identity across root-layout remounts; authentication changes reset both. Do not bind reading/draft lifetime to a route instance.
- `frontend/src/hooks/useRoomReading.ts` owns Expo list anchoring, target-message/reply reveal, history-edge loading and latest following. Its shared `useMessageReading` controller adapts inverted Chat and forward entry replies; never add a separate target-scroll controller. `useRoomExposure.ts` adapts native/web row geometry and foreground dwell to receipts. Reuse these owners rather than adding scrolling or read state to message presentation components.
- `frontend/src/lib/createCable.ts` owns acknowledged socket membership and reconnects; `frontend/src/lib/roomSubscription.ts` owns join-before-snapshot catch-up. Legacy and Expo adapters use these owners. `frontend/src/lib/messageGroups.ts` owns bounded author grouping on both platforms.
- `frontend/src/lib/api/transport.ts` owns portable authenticated transport, token rotation, and stale-session rejection. `frontend/site/lib/api/client.ts` supplies public-website browser storage/media/navigation effects; `frontend/src/lib` supplies Expo endpoint and SecureStore/browser storage adapters. Do not copy refresh or retry logic into hooks.
- `frontend/src/lib/api/room.ts` owns portable Room page/send contracts, live catch-up, and message deduplication; both clients use it. `frontend/src/lib/scopedDrafts.ts` owns bounded session-scoped ephemeral storage used by both composer hooks. Expo presentation remains in `frontend/src/features/rooms`.
- `frontend/src/lib/api/contentUpload.ts` owns portable upload form fields and response conversion; the Expo SWR adapter supplies their authenticated client and file representation. `frontend/src/lib/chatAttachmentNode.ts` owns attachment document nodes; `frontend/src/lib/clipboardMedia.ts` owns file/audio classification and browser clipboard extraction. Compatibility exports were removed at cutover; import the canonical owner directly.
- `frontend/src/lib/api/mentions.ts` and `frontend/src/lib/mentionTargets.ts` own mention lookup and filtering. `frontend/src/lib/plainMentionDraft.ts` owns text-input mention ranges/document conversion and shared Enter/IME submission policy. Expo `useChatComposition` owns staging/upload/publish/discard orchestration, using `useRoomDraft` and the shared scoped store; operation locks survive route remounts. Never put upload calls in composer presentation.

8.6 PAGE BOUNDARIES AND KEYBOARD FOCUS
- `frontend/src/styles/tokens.css` owns one app-wide horizontal gutter: `--app-page-inline-inset: var(--space-sm)` (12 px), shared by app bars, page content, and bottom toolbars. `--app-page-inset-start/end` apply the maximum of that gutter and each device safe area once. Do not derive page gutters from the media grid or add per-page horizontal padding. Centering and the 760 px width cap remain separate.
- `AppBar` owns page-level back controls. Reuse it rather than drawing another caret. **Never render a Home control in any bottom toolbar.** Bottom toolbars are for composer and contextual actions; page escape belongs in the top app bar. Preserve the separate bottom/keyboard/iPhone-corner spacing contract when changing horizontal gutters.
- Bottom drawers must use the shared `PopupMenu mode="drawer"`; never build feature-local Modal sheets, backdrops, or slide animations. `usePanelPresence` and `drawerStyles` own panel motion and surface styling, including the routed Chat variation. Backdrops remain stationary and fade opacity; only panels slide, including exit. Chat retains its existing viewport/toolbar and scroll owners.
- Browser links must never open new tabs. `useContentLink` routes every internal `/app` destination through Expo Router; `linkNavigation.web.ts` opens external destinations in the current tab and normalizes local host aliases through `contentLinks.ts`. Preserve the active browser origin for internal navigation.
- Explicit user design rule: text-entry inputs, textareas, and rich-text/contenteditable editors must never gain focus outlines or box-shadow rings, for pointer or keyboard focus. Do not reintroduce them. Keep the caret and text-selection highlight visible. Buttons, links, and other non-text controls retain visible keyboard focus through the shared outward accent tokens. Never use black or inset focus outlines.
- `bin/check-ui-layout.mjs` enforces these boundaries with lint; real browser geometry and keyboard tests remain required for layout/focus changes.

============================================================
9. SUMMARY OF NON-NEGOTIABLE POINTS (HIGH PRIORITY)
============================================================

Routes stay thin. Reuse the existing shared components and canonical owners.
All application reads/writes use SWR hooks. Keep universal and browser code apart.
Run the reuse audit before edits and verify production integration after Storybook.

============================================================
END OF RULES
============================================================

### Additional Expo parity ownership
- `frontend/src/lib/audioPresentation.ts` owns portable audio display titles, durations and dates. Expo editor audio metadata is projected by `useEditorAudio`; DOM playback commands delegate to the existing native/session player.
- `frontend/src/lib/browserInstallation.ts` owns browser install detection, prompt-event subscriptions and dismissal persistence across React runtimes. Legacy PWA prompts and Expo’s web Installation provider adapt it; native installation UI remains absent. Browser prompt events are single-use and permission requests require explicit user activation.
- `frontend/src/lib/browserPushSubscription.ts` owns browser permission, service-worker registration and subscription lifecycle. Legacy `usePushSubscription` and Expo's web SWR hook adapt this same owner; Expo serves the canonical `public/service-worker.js` through a generated public copy checked by `bin/expo-assets.mjs`. Native push remains a later integration boundary.


## Additional rules scoped to frontend


Follow the Expo migration scope in the root AGENTS.md. This is a web-first,
separately installed application. The current milestone is finishing and shipping
Expo web (scope updated 2026-10-23). iOS and Android validation is deferred.

- Install from this directory with pnpm; maintain its own pnpm-lock.yaml.
- Consult docs matching the installed Expo SDK before changing platform APIs.
- Keep src/app route modules thin; features, components, hooks and styles live
  under src in their corresponding directories.
- Follow established production controls: retain semantic action colours and omit generic status/debug UI absent from the original screen. Form fields/selects and clickable cards must keep their own geometry rather than inherit action-button pills.
- Primary action buttons use the canonical Button's pill shape (solid and outlined actions default to pills). Keep card, row, and icon-button geometry explicit; do not add Home actions absent from the existing design.
- Do not import legacy frontend React modules across the React 18/19 boundary.
  Extract portable contracts deliberately when migrating a feature.
- Use `pnpm exec expo install` for SDK-managed dependencies and verify with
  `pnpm exec expo install --check` and Expo Doctor.
- Run typecheck, root lint, relevant web/portable tests and the web export.
  Validate real routes on desktop and mobile browsers, including interaction,
  transitions/animations, reduced motion, keyboard, history, focus and recovery.
  Preserve the existing experience; pixel-perfect parity is not required.
- Do not run native exports/builds or simulator/emulator/device tests for this
  milestone. Preserve native adapters and track known gaps for later validation.
  Browser APIs and dependencies stay in web/DOM adapters; shared logic remains
  portable. No speculative native implementation is required to ship web.
- Native projects are generated by Expo. Configuration belongs in app.json and
  config plugins. Cloud builds and store publication are separate release work.

- Non-Room app-bar titles use `layout.appBarTitle` (18px BarlowCondensedBold), single-line ellipsis and the compact `layout.appBar`. Room plaques keep their dedicated treatment.
- Pointer/touch activation must not add focus rings or colour/opacity highlights. Preserve visible keyboard focus through `:focus-visible` on non-text controls only; text-entry fields never get focus outlines or rings.
- `ViewportToolbarHost` is edge-to-edge; content owners supply any inner padding. Never inset a toolbar background with the page content container.
- Web `ViewportShell` floats its session audio player by default. Participating scroll content uses stable `layout.audioClearance` (Chat retains its inverted latest-edge clearance); do not resize the viewport or change padding when playback appears.
- `ViewportToolbar` updates an existing owner's content without unregistering it. Room details suppress the underlying workspace toolbar through the shell.
- `useKeyboardFocus.web.ts` tracks input modality, but must not enable focus outlines or rings on text-entry fields. Text selection uses a pale, bright, saturated highlight (`--color-text-selection`), not the darker brand yellow. Page-sized overlays declare colours through `usePageSurface`, only while open and on the focused route.

- `useViewportGeometry` adapts the portable visual-viewport owner for both the web shell and portalled menus/dialogs. Keep overlay height and anchor coordinates within that same visible viewport; do not add independent keyboard offsets.
- `useRoomWorkspace` and `RoomWorkspaceFrame` own shared Room overlay coordination and presentation. Keep Chat reading, exposure and composition in their existing controllers.
- Ordinary pages use `PageScrollView` for common content geometry and stable audio clearance; specialized lists and editors retain their own scroll containers.
- Declare `PopupMenu` mode explicitly as `menu`, `dialog` or `page`; do not infer presentation from the presence of children or an anchor.
- Expo visual fixtures live in the isolated `.storybook` configuration with Expo's React runtime. Reuse production components, keep fixtures free of authenticated data and mutations, and verify actual routes after fixture checks. Shared ownership guidance is in this canonical registry.

- Expo owns fonts in `frontend/src/assets/fonts`, registered by `src/styles/fonts.ts`, and CSS/tokens in `src/styles`. Its visual asset and token generators live in `frontend/scripts`; root commands are compatibility entry points. Legacy style references are available in Git; do not recreate them. Expo transition and mosaic CSS are owned locally even while their portable behavior controllers remain shared. Never put app-wide fonts under a feature.
- Migration plans and acceptance records belong in `plan/Roadmap/Expo migration`, not the Expo application directory. Deliver one-off reports in chat; do not save them in the repository unless requested.

- Expo is the replacement frontend, not a permanent parallel app. Keep newly migrated frontend ownership inside it; shared server/client contracts may remain outside. Do not reintroduce legacy font, CSS, icon or presentation-asset dependencies.
- Serve fonts from bundled local assets in the app and public site. Do not add Google Fonts stylesheet imports, remote font URLs, or font-provider preconnects.

- Expo `public/` owns its manifest, installation icons and service worker. Root `public/` retains website and server assets; never regenerate Expo assets from them.

- App/page headers have no separating border. Bottom toolbars retain their existing content separators. `ViewportToolbarHost` owns the shared 4px control padding beyond `ViewportShell` safe-area clearance; feature docks must not add bottom padding. In-panel bottom controls use the shell’s `data-viewport-bottom-controls` contract and `layout.toolbarControls`, preserving panel motion.
