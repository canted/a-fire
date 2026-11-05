# Image implementation policy

## Decided

All 13 findings from the September 2026 image audit are addressed through the owners below. Use these implementations when adding a surface; CI rejects raw image elements and stock Tiptap image imports outside their owners, and unbounded `memoryStorage` imports in image controllers.

| Responsibility | Canonical implementation | Contract |
| --- | --- | --- |
| Browser/server constants | `types/image-policy.ts` | JPEG, PNG, WebP, GIF, AVIF; 20 MiB encoded, 8192 pixels per side, 25 million decoded pixels across at most 100 frames. |
| Validation and multipart | `image-policy.ts` | Decode bytes before persistence; derive MIME and orientation-aware dimensions; reject SVG, active documents, invalid encodings, and limits violations. Image endpoints bound multipart files/fields/parts before buffering. The mixed audio/video/file route has its own 100 MiB transport ceiling and still enforces the image service limit. |
| Processing budget | `image-processing.ts` | One materialization runs per process; up to 63 waiting materializations retain IDs before opening a transaction or reading source bytes. One active decode/transform and one waiting buffer-bearing operation per process; overload returns a retryable 503. Sharp concurrency is 1, with an 8 MiB libvips cache and a 10-second processing timeout. These bound work, not total process RSS. |
| Presentation | `frontend/components/AppImage.tsx` | Required alt text; lazy loading and async decoding; explicit prominent-image priority; responsive candidates and error state. Use `sizes` for the CSS slot and `width`/`height` for intrinsic source dimensions. Never use display dimensions as source dimensions. |
| Editor and document images | `frontend/features/content/nodes/ImageNode.tsx` | Same renderer in editors and read-only content. Upload insertion and typed-image posts preserve validated dimensions. `image-presentation.ts` batches missing dimensions across already-authorized documents. |
| Identity imagery | `frontend/components/UserAvatar.tsx` | Circular, square, and stripe avatars use AppImage. Stripes use one foreground image layer so transformed gesture surfaces do not repaint competing CSS backgrounds. A generated fallback is shown only when there is no uploaded image or the upload fails, never underneath a real image during loading or revalidation. The static typed Icon registry is the only raw-image exception. |
| Transform | `image-variants.ts` | WebP quality 80, effort 4; auto-orient, preserve transparency/animation/timing, never enlarge. Version 2 storage keys and browser query keys escape old cached representations. |
| Generation and deletion | `image-variants.service.ts` | One job per upload with useful role presets; source read once per missing batch. PostgreSQL transaction advisory lock coordinates API instances, workers, attachment replacement, repair, and deletion. Output records are written only after storage succeeds. Purge includes legacy, current, and untracked known keys. |
| Access | `CircleAccessService` | Check live permissions before any conditional response or bytes. Visitors may see current published posts/replies and identity images in accessible circles; notes remain member-only. Deletion and revoked access must not return cached success. |
| Private HTTP caching | `server/storage/media-cache.ts` | `private, no-cache, must-revalidate`, auth/cookie Vary, nosniff, ETags. Authorized 304s avoid transferring image bytes. Unsafe original content downloads as attachments with a sandbox CSP. |
| Service worker | `public/service-worker.js` | Every same-origin image outside static-public allowlisted asset paths goes to network with HTTP revalidation. No offline private image cache. Delete legacy image caches and persisted user scope on activation/context changes. Static cache: seven days, 64 entries, at most 512 KiB per entry (32 MiB payload cap). Cache failures never block network delivery; writes are asynchronous. |
| Avatar upload | `frontend/features/profile/AvatarUploader.tsx` | Crop to 160 × 1440 for the existing stripe contract; release source and preview URLs on replace/cancel/confirm/unmount; show validation/decode/crop errors. Avatar cropping creates a still PNG; regular content GIF/WebP animation is preserved. |

Content presets are 320/600/1200 pixels wide; thumbnails offer 320/600; icons 96/160; avatars 40/96/160. A native browser chooses among offered candidates using `sizes` and device density. External images receive loading/decoding/referrer/error policies, but their origin controls byte size and cache behavior.

Example:

```tsx
<AppImage
  src={upload.url}
  alt="Sketch of the proposed entrance"
  purpose="content"
  sizes="(min-width: 1200px) 960px, 100vw"
  width={upload.width}
  height={upload.height}
/>
```

Use `fill`, `size`, and existing CSS Modules for cropped/fixed-size slots. Set `priority` only when the image is actually prominent on the initial screen. Do not add component-level fetchers, variant string concatenation, separate image caches, or background document rewrites.

For initially visible identity lists, pass the accurate fixed `sizes` value and prioritize only the first visible rows. Keep later rows lazy. This preserves authorization revalidation while preventing visible identities from being placed behind offscreen media work.

## Rollout and legacy data

Deploy the API, app/service worker, and worker from the same release. No schema migration is needed. Existing queued jobs with one digest still work. New keys avoid reusing old still-image transforms. Existing stored editor URLs remain intact; presentation selects variants. Old cache entries are removed when the new worker activates, and private fetches override the old five-year HTTP freshness. An already-open old app/worker must update before it follows the new policy.

Missing legacy dimensions are repaired when a new variant is generated. To repair metadata before users open older images, run the bundled tool first in dry-run mode, then apply it to the intended environment:

```sh
node dist/server/scripts/backfill-image-metadata.js
node dist/server/scripts/backfill-image-metadata.js --apply
```

It processes bounded batches, validates each original, uses the shared blob lock, and reports unsupported/oversized/corrupt originals without deleting them. It never rewrites a document. Existing 20-pixel avatar sources cannot regain lost detail; replacing them through the updated uploader supplies the larger source. Unsupported old SVG/active-document originals download safely and cannot produce an image variant.

Private caching requires connectivity to recheck access. It does not erase pixels already rendered in an open page. Do not add an offline exception without an explicit product decision on authorization freshness.

## Required verification

The normal `pnpm lint`, `pnpm typecheck`, and `pnpm vitest` CI gates include image architecture and regression checks. PostgreSQL integration tests require an isolated database whose name contains `test`, and access to localhost. The HTTP integration test exercises the actual controllers, guards, access service, validation, Sharp, and local storage. The database integration test uses separate Prisma connections for API/worker races and cleans up only its own fixtures.

Relevant test groups:

```sh
pnpm exec vitest run tests/backend/uploads tests/backend/integration/uploads \
  tests/backend/unit/services/uploads tests/backend/unit/controllers/uploads.controller.test.ts \
  tests/frontend/unit/components/appImage.test.tsx tests/frontend/unit/pwa \
  tests/frontend/unit/profile/avatarUploader.test.tsx
```

Before modifying this contract, cover: forged/oversized/animated/rotated uploads; member/visitor/outsider and revoked access including posters and conditional requests; nested post/reply/page presentation; dimensions and actual responsive browser selection; cold API/worker races and purge; cache errors/eviction/offline behavior; avatar URL disposal. `Media/AppImage` Storybook stories exercise the production renderer and Tiptap node.

Structured events `image_variant_generated` and `image_variant_served` report byte counts, transform version, storage hits, and transform duration; queue failures and metadata-repair failures are logged separately. Measure cold/warm request count, transfer bytes, layout shift, transform duration, queue load, and process peak RSS before increasing limits.

## Proposed

Evaluate AVIF output, additional widths, a CDN, or first-party external thumbnails only after production measurements justify their cost. These are optional optimization opportunities, not prerequisites for this implementation. Any encoder/quality change must bump `IMAGE_TRANSFORM_VERSION` so old outputs cannot silently persist.

## Verification record — September 8, 2026

The full frontend/backend suite passed (307 suites, 1,649 tests). Subsequent focused checks passed after the final image changes (80 frontend/image checks and 68 backend/HTTP/database checks, with overlap between groups). Lint, both TypeScript targets, the app/site/API production build, and the final API rebuild passed. The compiled application booted against the isolated test database; health checks and unauthenticated upload/poster rejection passed.

Chromium selected w320, w600, and w1200 for a 300 CSS-pixel slot at 1×, 2×, and 3× density respectively, with one image request per case. The 3× fixture was correctly capped at its 800-pixel source width. The missing-image state and real Tiptap rendering were inspected at a 390-pixel viewport. The metadata command's dry run passed against the test database. No production deployment, production backfill, real-device benchmark, or production traffic measurement was performed.

The shared orphan purge also recognizes blob media generations. It retains a blob while any tracked attempt lacks `finished_at`, including superseded attempts: losing publication rights does not stop a worker's storage write. Once all writers have finished and attachments are absent, purge removes the retained source key, all tracked output keys, video posters, current key and image variants under the existing blob lock. Storage deletion failure leaves database records available for retry. A crashed attempt must be reconciled before purge can proceed; elapsed time alone is not evidence that its writer has stopped. Audio and video processing use the generation owner, with video posters written beside each attempt output. Deployments must drain old media workers before enabling this version, because old workers still overwrite source keys.


Media crash recovery is covered by `media-crash-recovery.integration.test.ts`: real child workers are killed after output storage but inside the uncommitted publication transaction, or after publication before queue acknowledgement. Boss expiration/retry creates a replacement generation from retained source bytes. Audio/video playback and video posters recover without changing blob/asset identity. The test advances only its fixture job timestamp to avoid waiting for the production expiry interval. It does not reap the interrupted attempt: a pre-publication crash still requires explicit writer-death reconciliation before orphan purge can complete.

Audio subprocess budgets are independently configurable: `AUDIO_TRANSCODE_TIMEOUT_MS` defaults to 300,000 ms, `AUDIO_PROBE_TIMEOUT_MS` to 60,000 ms, and `AUDIO_WAVEFORM_TIMEOUT_MS` to 120,000 ms. Video poster extraction shares `VIDEO_PROBE_TIMEOUT_MS` (120,000 ms by default). Invalid or overflowing timer settings fall back to defaults. These subprocesses use SIGKILL on timeout so a process ignoring SIGTERM cannot keep the attempt running. Required audio transcode failures reach the existing failed-attempt/retry path; optional metadata and poster failures retain their existing fallback behavior. `media-process-timeout.integration.test.ts` verifies real child-process termination for all four operations. These are per-subprocess limits, not a whole-job deadline or storage-transfer cancellation guarantee; Boss defaults remain unchanged.

Media source reads now pass cancellation through the shared StorageService, including S3 request establishment, retry backoff and body consumption. Audio uses `AUDIO_SOURCE_DOWNLOAD_TIMEOUT_MS` (300,000 ms by default); video retains `VIDEO_SOURCE_DOWNLOAD_TIMEOUT_MS` (300,000 ms). The video deadline starts before requesting the object. A local HTTP integration fixture verifies that cancellation closes real S3 connections stalled before headers or during the body. Local read streams also accept cancellation. Output writes have a separate budget; these limits do not bound buffered audio memory or the entire job.

Processed audio, video and poster uploads use `MEDIA_OUTPUT_UPLOAD_TIMEOUT_MS` (300,000 ms by default) per output object. StorageService passes cancellation into S3 requests and retry backoff; local buffer writes and file-copy pipelines also accept cancellation. Each S3 file attempt closes its input stream before returning or retrying. The HTTP cancellation fixture covers stalled buffered and file-based uploads as well as downloads. A canceled remote upload may already have stored bytes; generation keys remain tracked for cleanup, and publication is attempted only after a successful upload response. This does not establish a total job deadline or reconcile crashed attempts.

Inspect unfinished media attempts after building the API with `pnpm inspect:media-attempts --before 2026-10-29T00:00:00Z --limit 100`. This command only reads the database; it does not start Boss, retry jobs, access storage or mark writers finished. JSON output includes attempt/blob IDs, recorded state, creation time, generation and current blob generation. `writer_status` is always `unknown`: neither age nor supersession proves termination. Follow `nextAfterId` with `--after-id`, retaining the same `--before` cutoff; each page is bounded to 1–1,000 records. Concurrent completions can remove records from later pages, so the report is an observation rather than a frozen snapshot. Reconciliation still requires an independently verified worker stop; this command does not authorize automatic deletion.
