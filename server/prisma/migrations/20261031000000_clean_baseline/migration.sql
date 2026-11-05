-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "PushDeviceAttemptState" AS ENUM ('started', 'sent', 'rejected', 'invalid', 'uncertain');

-- CreateEnum
CREATE TYPE "MediaProcessingKind" AS ENUM ('audio', 'video');

-- CreateEnum
CREATE TYPE "MediaProcessingState" AS ENUM ('processing', 'published', 'failed', 'superseded');

-- CreateTable
CREATE TABLE "users" (
    "id" SERIAL NOT NULL,
    "email" VARCHAR NOT NULL,
    "encrypted_password" VARCHAR NOT NULL DEFAULT '',
    "reset_password_token" VARCHAR,
    "reset_password_sent_at" TIMESTAMP(6),
    "remember_created_at" TIMESTAMP(6),
    "username" VARCHAR NOT NULL,
    "profile_line" VARCHAR(160),
    "created_at" TIMESTAMP(6) NOT NULL,
    "updated_at" TIMESTAMP(6) NOT NULL,
    "last_seen_at" TIMESTAMP(6),
    "notify_by_the" INTEGER,
    "notified_at" TIMESTAMP(6),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rooms" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR,
    "owner_id" INTEGER,
    "parent_id" INTEGER,
    "porosity" VARCHAR NOT NULL DEFAULT 'open',
    "created_at" TIMESTAMP(6) NOT NULL,
    "updated_at" TIMESTAMP(6) NOT NULL,
    "deleted_at" TIMESTAMP(6),
    "reply_mode" VARCHAR NOT NULL DEFAULT 'simple',
    "default_feedback_types" JSON NOT NULL DEFAULT '["impression","question","idea"]',
    "default_idea_guidance" VARCHAR NOT NULL DEFAULT 'open',

    CONSTRAINT "rooms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_messages" (
    "id" SERIAL NOT NULL,
    "room_id" INTEGER NOT NULL,
    "author_id" INTEGER NOT NULL,
    "saved_by_id" INTEGER,
    "pinned_by_id" INTEGER,
    "entry_id" INTEGER,
    "status" VARCHAR NOT NULL DEFAULT 'published',
    "timeline_kind" VARCHAR NOT NULL DEFAULT 'message',
    "entry_origin" VARCHAR,
    "saved_at" TIMESTAMP(6),
    "pinned_at" TIMESTAMP(6),
    "body" TEXT NOT NULL,
    "content" JSON,
    "masked_alias" VARCHAR NOT NULL,
    "client_nonce" VARCHAR(64),
    "fire_at" TIMESTAMP(6) NOT NULL,
    "expires_at" TIMESTAMP(6) NOT NULL,
    "created_at" TIMESTAMP(6) NOT NULL,
    "updated_at" TIMESTAMP(6) NOT NULL,

    CONSTRAINT "chat_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_message_reads" (
    "user_id" INTEGER NOT NULL,
    "message_id" INTEGER NOT NULL,
    "seen_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_message_reads_pkey" PRIMARY KEY ("user_id","message_id")
);

-- CreateTable
CREATE TABLE "chat_message_identity_grants" (
    "id" SERIAL NOT NULL,
    "message_id" INTEGER NOT NULL,
    "user_id" INTEGER NOT NULL,
    "created_at" TIMESTAMP(6) NOT NULL,

    CONSTRAINT "chat_message_identity_grants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_presence_sessions" (
    "id" SERIAL NOT NULL,
    "room_id" INTEGER NOT NULL,
    "user_id" INTEGER NOT NULL,
    "connection_id" VARCHAR NOT NULL,
    "entered_at" TIMESTAMP(6) NOT NULL,
    "last_seen_at" TIMESTAMP(6) NOT NULL,
    "left_at" TIMESTAMP(6),

    CONSTRAINT "chat_presence_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_save_requests" (
    "id" SERIAL NOT NULL,
    "message_id" INTEGER NOT NULL,
    "requester_id" INTEGER NOT NULL,
    "owner_id" INTEGER NOT NULL,
    "status" VARCHAR NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMP(6) NOT NULL,
    "updated_at" TIMESTAMP(6) NOT NULL,

    CONSTRAINT "chat_save_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "room_memberships" (
    "id" SERIAL NOT NULL,
    "room_id" INTEGER NOT NULL,
    "user_id" INTEGER NOT NULL,
    "notify" BOOLEAN DEFAULT true,
    "created_at" TIMESTAMP(6) NOT NULL,
    "updated_at" TIMESTAMP(6) NOT NULL,
    "unseen_started_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "username_override" VARCHAR,
    "profile_line_override" VARCHAR(160),
    "disabled" BOOLEAN NOT NULL DEFAULT false,
    "revoked_at" TIMESTAMP(6),

    CONSTRAINT "room_memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "room_membership_reconciliations" (
    "id" SERIAL NOT NULL,
    "room_id" INTEGER NOT NULL,
    "user_id" INTEGER NOT NULL,
    "canonical_membership_id" INTEGER NOT NULL,
    "source_records" JSONB NOT NULL,
    "conflicting_fields" TEXT[],
    "review_status" TEXT NOT NULL,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "room_membership_reconciliations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "room_join_requests" (
    "id" SERIAL NOT NULL,
    "room_id" INTEGER NOT NULL,
    "user_id" INTEGER NOT NULL,
    "status" VARCHAR NOT NULL DEFAULT 'pending',
    "reviewed_by_id" INTEGER,
    "reviewed_at" TIMESTAMP(6),
    "created_at" TIMESTAMP(6) NOT NULL,
    "updated_at" TIMESTAMP(6) NOT NULL,

    CONSTRAINT "room_join_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "room_member_invitations" (
    "id" SERIAL NOT NULL,
    "room_id" INTEGER NOT NULL,
    "user_id" INTEGER NOT NULL,
    "invited_by_id" INTEGER NOT NULL,
    "status" VARCHAR NOT NULL DEFAULT 'pending',
    "responded_at" TIMESTAMP(6),
    "created_at" TIMESTAMP(6) NOT NULL,
    "updated_at" TIMESTAMP(6) NOT NULL,

    CONSTRAINT "room_member_invitations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "room_knocks" (
    "id" SERIAL NOT NULL,
    "room_id" INTEGER NOT NULL,
    "user_id" INTEGER NOT NULL,
    "status" VARCHAR NOT NULL DEFAULT 'pending',
    "reviewed_by_id" INTEGER,
    "reviewed_at" TIMESTAMP(6),
    "created_at" TIMESTAMP(6) NOT NULL,
    "updated_at" TIMESTAMP(6) NOT NULL,

    CONSTRAINT "room_knocks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_note_copies" (
    "id" SERIAL NOT NULL,
    "message_id" INTEGER NOT NULL,
    "note_id" INTEGER NOT NULL,
    "copied_by_id" INTEGER NOT NULL,
    "idempotency_key" VARCHAR(96) NOT NULL,
    "created_at" TIMESTAMP(6) NOT NULL,

    CONSTRAINT "chat_note_copies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "room_banners" (
    "id" SERIAL NOT NULL,
    "room_id" INTEGER NOT NULL,
    "created_by_id" INTEGER NOT NULL,
    "kind" VARCHAR NOT NULL,
    "placement" VARCHAR NOT NULL,
    "audience_type" VARCHAR NOT NULL,
    "visibility_rule" VARCHAR NOT NULL,
    "action_type" VARCHAR NOT NULL,
    "message" VARCHAR,
    "metadata" JSON NOT NULL DEFAULT '{}',
    "starts_at" TIMESTAMP(6),
    "ends_at" TIMESTAMP(6),
    "archived_at" TIMESTAMP(6),
    "created_at" TIMESTAMP(6) NOT NULL,
    "updated_at" TIMESTAMP(6) NOT NULL,

    CONSTRAINT "room_banners_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "room_banner_targets" (
    "id" SERIAL NOT NULL,
    "room_banner_id" INTEGER NOT NULL,
    "user_id" INTEGER NOT NULL,
    "message_override" VARCHAR,
    "dismissed_at" TIMESTAMP(6),
    "resolved_at" TIMESTAMP(6),
    "created_at" TIMESTAMP(6) NOT NULL,
    "updated_at" TIMESTAMP(6) NOT NULL,

    CONSTRAINT "room_banner_targets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "entries" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "created_at" TIMESTAMP(6) NOT NULL,
    "updated_at" TIMESTAMP(6) NOT NULL,
    "status" VARCHAR NOT NULL DEFAULT 'draft',
    "format" VARCHAR NOT NULL DEFAULT 'mixed_media',
    "format_data" JSON,
    "room_id" INTEGER,
    "published_at" TIMESTAMP(6),
    "reply_mode" VARCHAR,
    "requested_feedback_types" JSON,
    "idea_guidance" VARCHAR,
    "feedback_request_customized" BOOLEAN NOT NULL DEFAULT false,
    "round_id" INTEGER,
    "project_id" INTEGER,
    "creation_origin" VARCHAR,
    "project_intent" TEXT,
    "project_question" TEXT,
    "project_lyrics" TEXT,
    "source_entry_id" INTEGER,
    "source_shared_entry_id" INTEGER,
    "source_reply_id" INTEGER,
    "source_chat_message_id" INTEGER,
    "source_author_name" VARCHAR,
    "source_room_ids" JSON,
    "source_room_id" INTEGER,
    "source_author_id" INTEGER,
    "room_statement" TEXT,
    "shared_feedback" JSON,
    "share_request_key" VARCHAR(128),
    "creation_request_key" VARCHAR(128),
    "share_request_fingerprint" VARCHAR(64),
    "locked" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "projects" (
    "creation_request_key" VARCHAR(128),
    "icon_symbol" VARCHAR(64),
    "icon_color" VARCHAR(16),
    "id" SERIAL NOT NULL,
    "owner_id" INTEGER NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMP(6) NOT NULL,
    "updated_at" TIMESTAMP(6) NOT NULL,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_rooms" (
    "project_id" INTEGER NOT NULL,
    "room_id" INTEGER NOT NULL,
    "created_at" TIMESTAMP(6) NOT NULL,

    CONSTRAINT "project_rooms_pkey" PRIMARY KEY ("project_id","room_id")
);

-- CreateTable
CREATE TABLE "project_participations" (
    "id" SERIAL NOT NULL,
    "project_id" INTEGER NOT NULL,
    "user_id" INTEGER NOT NULL,
    "invited_by_id" INTEGER NOT NULL,
    "status" VARCHAR NOT NULL DEFAULT 'pending',
    "invited_at" TIMESTAMP(6) NOT NULL,
    "responded_at" TIMESTAMP(6),
    "created_at" TIMESTAMP(6) NOT NULL,
    "updated_at" TIMESTAMP(6) NOT NULL,

    CONSTRAINT "project_participations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rounds" (
    "id" SERIAL NOT NULL,
    "room_id" INTEGER,
    "host_id" INTEGER NOT NULL,
    "name" VARCHAR NOT NULL,
    "prompt" TEXT,
    "status" VARCHAR NOT NULL DEFAULT 'draft',
    "reply_mode" VARCHAR NOT NULL DEFAULT 'simple',
    "requested_feedback_types" JSON,
    "idea_guidance" VARCHAR,
    "activity_key" VARCHAR NOT NULL DEFAULT 'feedback',
    "activity_version" INTEGER NOT NULL DEFAULT 1,
    "activity_config" JSON NOT NULL DEFAULT '{}',
    "started_at" TIMESTAMP(6),
    "submit_by" TIMESTAMP(6),
    "feedback_due_at" TIMESTAMP(6),
    "closed_at" TIMESTAMP(6),
    "created_at" TIMESTAMP(6) NOT NULL,
    "updated_at" TIMESTAMP(6) NOT NULL,

    CONSTRAINT "rounds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "published_walls" (
    "id" SERIAL NOT NULL,
    "round_id" INTEGER NOT NULL,
    "room_id" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "published_at" TIMESTAMP(6) NOT NULL,

    CONSTRAINT "published_walls_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wall_entries" (
    "id" SERIAL NOT NULL,
    "wall_id" INTEGER NOT NULL,
    "entry_id" INTEGER,
    "position" INTEGER NOT NULL,
    "author_name" VARCHAR NOT NULL,

    CONSTRAINT "wall_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wall_presentations" (
    "wall_id" INTEGER NOT NULL,
    "user_id" INTEGER NOT NULL,
    "presented_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wall_presentations_pkey" PRIMARY KEY ("wall_id","user_id")
);

-- CreateTable
CREATE TABLE "round_participations" (
    "id" SERIAL NOT NULL,
    "round_id" INTEGER NOT NULL,
    "user_id" INTEGER NOT NULL,
    "role" VARCHAR NOT NULL,
    "status" VARCHAR NOT NULL DEFAULT 'active',
    "submitted_entry_id" INTEGER,
    "joined_at" TIMESTAMP(6) NOT NULL,
    "withdrawn_at" TIMESTAMP(6),
    "created_at" TIMESTAMP(6) NOT NULL,
    "updated_at" TIMESTAMP(6) NOT NULL,

    CONSTRAINT "round_participations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "round_submissions" (
    "id" SERIAL NOT NULL,
    "round_id" INTEGER NOT NULL,
    "round_participation_id" INTEGER,
    "entry_id" INTEGER NOT NULL,
    "user_id" INTEGER NOT NULL,
    "submitted_at" TIMESTAMP(6) NOT NULL,
    "superseded_at" TIMESTAMP(6),
    "created_at" TIMESTAMP(6) NOT NULL,
    "updated_at" TIMESTAMP(6) NOT NULL,

    CONSTRAINT "round_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "round_activity_artifacts" (
    "id" SERIAL NOT NULL,
    "round_id" INTEGER NOT NULL,
    "user_id" INTEGER NOT NULL,
    "entry_id" INTEGER NOT NULL,
    "kind" VARCHAR NOT NULL,
    "status" VARCHAR NOT NULL DEFAULT 'active',
    "source_artifact_id" INTEGER,
    "submitted_at" TIMESTAMP(6) NOT NULL,
    "removed_at" TIMESTAMP(6),
    "created_at" TIMESTAMP(6) NOT NULL,
    "updated_at" TIMESTAMP(6) NOT NULL,

    CONSTRAINT "round_activity_artifacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "round_activity_offers" (
    "id" SERIAL NOT NULL,
    "round_id" INTEGER NOT NULL,
    "user_id" INTEGER NOT NULL,
    "first_artifact_id" INTEGER NOT NULL,
    "second_artifact_id" INTEGER NOT NULL,
    "chosen_artifact_id" INTEGER,
    "created_at" TIMESTAMP(6) NOT NULL,
    "updated_at" TIMESTAMP(6) NOT NULL,

    CONSTRAINT "round_activity_offers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "round_activity_moderation_events" (
    "id" SERIAL NOT NULL,
    "round_id" INTEGER NOT NULL,
    "artifact_id" INTEGER NOT NULL,
    "actor_id" INTEGER NOT NULL,
    "action" VARCHAR NOT NULL,
    "note" TEXT,
    "notification_requested" BOOLEAN NOT NULL DEFAULT false,
    "notification_status" VARCHAR,
    "created_at" TIMESTAMP(6) NOT NULL,

    CONSTRAINT "round_activity_moderation_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "entry_subjects" (
    "id" SERIAL NOT NULL,
    "entry_id" INTEGER NOT NULL,
    "subject_type" VARCHAR NOT NULL,
    "subject_id" INTEGER,
    "subject_key" VARCHAR,
    "source_node_id" VARCHAR,
    "metadata" JSON NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(6) NOT NULL,
    "updated_at" TIMESTAMP(6) NOT NULL,

    CONSTRAINT "entry_subjects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "introductions" (
    "id" SERIAL NOT NULL,
    "room_id" INTEGER NOT NULL,
    "created_by_id" INTEGER NOT NULL,
    "entry_id" INTEGER,
    "note" TEXT NOT NULL,
    "retracted_at" TIMESTAMP(6),
    "retracted_by_id" INTEGER,
    "created_at" TIMESTAMP(6) NOT NULL,
    "updated_at" TIMESTAMP(6) NOT NULL,

    CONSTRAINT "introductions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "introduction_recipients" (
    "id" SERIAL NOT NULL,
    "introduction_id" INTEGER NOT NULL,
    "user_id" INTEGER NOT NULL,
    "hidden_at" TIMESTAMP(6),
    "seen_at" TIMESTAMP(6),
    "created_at" TIMESTAMP(6) NOT NULL,
    "updated_at" TIMESTAMP(6) NOT NULL,

    CONSTRAINT "introduction_recipients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "link_previews" (
    "id" SERIAL NOT NULL,
    "url" VARCHAR NOT NULL,
    "canonical_url" VARCHAR,
    "title" VARCHAR,
    "description" TEXT,
    "site_name" VARCHAR,
    "image_url" VARCHAR,
    "favicon_url" VARCHAR,
    "accent_color" VARCHAR,
    "status" VARCHAR NOT NULL DEFAULT 'ready',
    "error_code" VARCHAR,
    "fetched_at" TIMESTAMP(6),
    "created_at" TIMESTAMP(6) NOT NULL,
    "updated_at" TIMESTAMP(6) NOT NULL,

    CONSTRAINT "link_previews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "link_preview_attachments" (
    "id" SERIAL NOT NULL,
    "owner_type" VARCHAR NOT NULL,
    "owner_id" INTEGER NOT NULL,
    "source_url" VARCHAR,
    "preview_id" INTEGER,
    "hidden" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(6) NOT NULL,
    "updated_at" TIMESTAMP(6) NOT NULL,

    CONSTRAINT "link_preview_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "replies" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER,
    "entry_id" INTEGER,
    "chat_message_id" INTEGER,
    "created_at" TIMESTAMP(6) NOT NULL,
    "updated_at" TIMESTAMP(6) NOT NULL,
    "status" VARCHAR NOT NULL DEFAULT 'draft',
    "published_at" TIMESTAMP(6),
    "feedback_type" VARCHAR,

    CONSTRAINT "replies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notes" (
    "id" SERIAL NOT NULL,
    "title" VARCHAR,
    "icon" VARCHAR,
    "parent_note_id" INTEGER,
    "parent_id" INTEGER,
    "created_at" TIMESTAMP(6) NOT NULL,
    "updated_at" TIMESTAMP(6) NOT NULL,
    "deleted_at" TIMESTAMP(6),
    "room_id" INTEGER,

    CONSTRAINT "notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "documents" (
    "id" SERIAL NOT NULL,
    "docable_type" VARCHAR NOT NULL,
    "docable_id" INTEGER NOT NULL,
    "content" JSONB NOT NULL DEFAULT '{}',
    "ydoc_state" BYTEA,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(6) NOT NULL,
    "updated_at" TIMESTAMP(6) NOT NULL,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reflections" (
    "id" SERIAL NOT NULL,
    "note_id" INTEGER NOT NULL,
    "reflectable_type" VARCHAR NOT NULL,
    "reflectable_id" INTEGER NOT NULL,
    "user_id" INTEGER,
    "created_at" TIMESTAMP(6) NOT NULL,
    "updated_at" TIMESTAMP(6) NOT NULL,

    CONSTRAINT "reflections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invites" (
    "id" SERIAL NOT NULL,
    "email" VARCHAR NOT NULL,
    "invite_type" INTEGER NOT NULL,
    "token" VARCHAR NOT NULL,
    "expires_at" TIMESTAMP(6) NOT NULL,
    "used_at" TIMESTAMP(6),
    "invited_by_id" INTEGER NOT NULL,
    "created_at" TIMESTAMP(6) NOT NULL,
    "updated_at" TIMESTAMP(6) NOT NULL,
    "room_id" INTEGER,

    CONSTRAINT "invites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "one_time_tokens" (
    "id" SERIAL NOT NULL,
    "email" VARCHAR NOT NULL,
    "token" VARCHAR NOT NULL,
    "user_id" INTEGER,
    "invite_id" INTEGER,
    "purpose" VARCHAR NOT NULL,
    "expires_at" TIMESTAMP(6) NOT NULL,
    "consumed_at" TIMESTAMP(6),
    "sent_at" TIMESTAMP(6),
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(6) NOT NULL,
    "updated_at" TIMESTAMP(6) NOT NULL,

    CONSTRAINT "one_time_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_events" (
    "id" SERIAL NOT NULL,
    "event_type" VARCHAR NOT NULL,
    "actor_id" INTEGER NOT NULL,
    "room_id" INTEGER NOT NULL,
    "entry_id" INTEGER,
    "reply_id" INTEGER,
    "target_user_id" INTEGER,
    "payload" JSON NOT NULL DEFAULT '{}',
    "target_path" VARCHAR,
    "created_at" TIMESTAMP(6) NOT NULL,
    "updated_at" TIMESTAMP(6) NOT NULL,

    CONSTRAINT "notification_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_inbox_items" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "notification_event_id" INTEGER NOT NULL,
    "delivery_state" VARCHAR NOT NULL DEFAULT 'pending',
    "delivered_at" TIMESTAMP(6),
    "seen_at" TIMESTAMP(6),
    "created_at" TIMESTAMP(6) NOT NULL,
    "updated_at" TIMESTAMP(6) NOT NULL,

    CONSTRAINT "notification_inbox_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_push_deliveries" (
    "id" SERIAL NOT NULL,
    "notification_inbox_item_id" INTEGER NOT NULL,
    "notification_event_id" INTEGER NOT NULL,
    "user_id" INTEGER NOT NULL,
    "state" VARCHAR NOT NULL DEFAULT 'scheduled',
    "scheduled_job_id" VARCHAR,
    "due_at" TIMESTAMP(6) NOT NULL,
    "sent_at" TIMESTAMP(6),
    "cancelled_at" TIMESTAMP(6),
    "skip_reason" VARCHAR,
    "last_error" TEXT,
    "created_at" TIMESTAMP(6) NOT NULL,
    "updated_at" TIMESTAMP(6) NOT NULL,

    CONSTRAINT "notification_push_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_push_device_attempts" (
    "id" SERIAL NOT NULL,
    "delivery_id" INTEGER NOT NULL,
    "endpoint_hash" VARCHAR(64) NOT NULL,
    "subscription_id" INTEGER NOT NULL,
    "state" "PushDeviceAttemptState" NOT NULL DEFAULT 'started',
    "attempt_count" INTEGER NOT NULL DEFAULT 1,
    "started_at" TIMESTAMP(6) NOT NULL,
    "completed_at" TIMESTAMP(6),
    "last_error" TEXT,

    CONSTRAINT "notification_push_device_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_preferences" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "scope_type" VARCHAR NOT NULL DEFAULT 'Global',
    "scope_id" INTEGER,
    "notification_type" VARCHAR NOT NULL DEFAULT 'all',
    "delivery_mode" VARCHAR NOT NULL DEFAULT 'immediate',
    "push_enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(6) NOT NULL,
    "updated_at" TIMESTAMP(6) NOT NULL,

    CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "entry_view_states" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "entry_id" INTEGER NOT NULL,
    "entry_seen_at" TIMESTAMP(6),
    "reply_seen_through_at" TIMESTAMP(6),
    "reply_seen_through_id" INTEGER,
    "created_at" TIMESTAMP(6) NOT NULL,
    "updated_at" TIMESTAMP(6) NOT NULL,

    CONSTRAINT "entry_view_states_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_notice_cursors" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "seen_through_at" TIMESTAMP(6) NOT NULL,
    "created_at" TIMESTAMP(6) NOT NULL,
    "updated_at" TIMESTAMP(6) NOT NULL,

    CONSTRAINT "user_notice_cursors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "push_subscriptions" (
    "id" SERIAL NOT NULL,
    "endpoint" VARCHAR,
    "p256dh" VARCHAR,
    "auth" VARCHAR,
    "subscribed" BOOLEAN DEFAULT false,
    "created_at" TIMESTAMP(6) NOT NULL,
    "updated_at" TIMESTAMP(6) NOT NULL,
    "user_id" INTEGER,

    CONSTRAINT "push_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "name" VARCHAR NOT NULL,
    "created_at" TIMESTAMP(6) NOT NULL,
    "updated_at" TIMESTAMP(6) NOT NULL,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "media_processing_attempts" (
    "id" UUID NOT NULL,
    "blob_id" INTEGER NOT NULL,
    "generation" INTEGER NOT NULL,
    "kind" "MediaProcessingKind" NOT NULL,
    "state" "MediaProcessingState" NOT NULL DEFAULT 'processing',
    "output_key" TEXT NOT NULL,
    "error" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMPTZ(6),

    CONSTRAINT "media_processing_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "active_storage_blobs" (
    "media_source_key" TEXT,
    "media_generation" INTEGER NOT NULL DEFAULT 0,
    "id" SERIAL NOT NULL,
    "key" VARCHAR NOT NULL,
    "filename" VARCHAR NOT NULL,
    "content_type" VARCHAR,
    "metadata" TEXT,
    "service_name" VARCHAR NOT NULL,
    "byte_size" INTEGER NOT NULL,
    "checksum" VARCHAR,
    "created_at" TIMESTAMP(6) NOT NULL,

    CONSTRAINT "active_storage_blobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "active_storage_attachments" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR NOT NULL,
    "record_type" VARCHAR NOT NULL,
    "record_id" INTEGER NOT NULL,
    "blob_id" INTEGER NOT NULL,
    "created_at" TIMESTAMP(6) NOT NULL,

    CONSTRAINT "active_storage_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "active_storage_variant_records" (
    "id" SERIAL NOT NULL,
    "blob_id" INTEGER NOT NULL,
    "variation_digest" VARCHAR NOT NULL,

    CONSTRAINT "active_storage_variant_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audio_assets" (
    "id" SERIAL NOT NULL,
    "blob_id" INTEGER NOT NULL,
    "owner_id" INTEGER NOT NULL,
    "source_type" VARCHAR NOT NULL,
    "source_id" INTEGER NOT NULL,
    "title" VARCHAR NOT NULL,
    "original_filename" VARCHAR NOT NULL,
    "original_mime_type" VARCHAR,
    "processing_status" VARCHAR NOT NULL,
    "duration_ms" INTEGER,
    "waveform_peaks" JSONB,
    "error_message" VARCHAR,
    "created_at" TIMESTAMP(6) NOT NULL,
    "updated_at" TIMESTAMP(6) NOT NULL,

    CONSTRAINT "audio_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "video_assets" (
    "id" SERIAL NOT NULL,
    "blob_id" INTEGER NOT NULL,
    "owner_id" INTEGER NOT NULL,
    "source_type" VARCHAR NOT NULL,
    "source_id" INTEGER NOT NULL,
    "title" VARCHAR NOT NULL,
    "original_filename" VARCHAR NOT NULL,
    "original_mime_type" VARCHAR,
    "processing_status" VARCHAR NOT NULL,
    "duration_ms" INTEGER,
    "width" INTEGER,
    "height" INTEGER,
    "error_message" VARCHAR,
    "created_at" TIMESTAMP(6) NOT NULL,
    "updated_at" TIMESTAMP(6) NOT NULL,

    CONSTRAINT "video_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audio_annotations" (
    "id" SERIAL NOT NULL,
    "audio_asset_id" INTEGER NOT NULL,
    "reply_id" INTEGER NOT NULL,
    "anchor_ms" INTEGER NOT NULL,
    "tolerance_ms" INTEGER NOT NULL,
    "created_by_id" INTEGER NOT NULL,
    "created_at" TIMESTAMP(6) NOT NULL,

    CONSTRAINT "audio_annotations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "room_visits" (
    "room_id" INTEGER NOT NULL,
    "user_id" INTEGER NOT NULL,
    "source" VARCHAR(16) NOT NULL,
    "last_activity_at" TIMESTAMP(6) NOT NULL,
    "expires_at" TIMESTAMP(6) NOT NULL,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "room_visits_pkey" PRIMARY KEY ("room_id","user_id")
);

-- CreateTable
CREATE TABLE "queue_worker_heartbeats" (
    "instance_id" UUID NOT NULL,
    "seen_at" TIMESTAMP(6) NOT NULL,

    CONSTRAINT "queue_worker_heartbeats_pkey" PRIMARY KEY ("instance_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "index_rooms_on_parent_porosity" ON "rooms"("parent_id", "porosity", "id");

-- CreateIndex
CREATE UNIQUE INDEX "index_chat_messages_on_entry" ON "chat_messages"("entry_id");

-- CreateIndex
CREATE INDEX "index_chat_messages_on_room_created" ON "chat_messages"("room_id", "created_at", "id");

-- CreateIndex
CREATE INDEX "index_chat_messages_on_room_status_pinned" ON "chat_messages"("room_id", "status", "pinned_at", "id");

-- CreateIndex
CREATE INDEX "index_chat_messages_on_room_expires" ON "chat_messages"("room_id", "expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "index_chat_messages_on_author_nonce" ON "chat_messages"("author_id", "client_nonce");

-- CreateIndex
CREATE INDEX "index_chat_identity_grants_on_user_message" ON "chat_message_identity_grants"("user_id", "message_id");

-- CreateIndex
CREATE UNIQUE INDEX "index_chat_identity_grants_on_message_user" ON "chat_message_identity_grants"("message_id", "user_id");

-- CreateIndex
CREATE INDEX "index_chat_presence_on_room_active" ON "chat_presence_sessions"("room_id", "left_at", "last_seen_at");

-- CreateIndex
CREATE INDEX "index_chat_presence_on_user_active" ON "chat_presence_sessions"("user_id", "left_at");

-- CreateIndex
CREATE UNIQUE INDEX "index_chat_presence_on_room_connection" ON "chat_presence_sessions"("room_id", "connection_id");

-- CreateIndex
CREATE INDEX "index_chat_save_requests_on_owner_status" ON "chat_save_requests"("owner_id", "status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "index_chat_save_requests_on_message_requester" ON "chat_save_requests"("message_id", "requester_id");

-- CreateIndex
CREATE INDEX "index_membership_history_seek" ON "room_memberships"("room_id", "disabled", "revoked_at", "created_at", "id");

-- CreateIndex
CREATE INDEX "index_room_memberships_on_user_active_room" ON "room_memberships"("user_id", "disabled", "room_id");

-- CreateIndex
CREATE UNIQUE INDEX "index_room_memberships_on_room_user" ON "room_memberships"("room_id", "user_id");

-- CreateIndex
CREATE INDEX "index_membership_reconciliations_on_review_status" ON "room_membership_reconciliations"("review_status", "id");

-- CreateIndex
CREATE UNIQUE INDEX "index_membership_reconciliations_on_room_user" ON "room_membership_reconciliations"("room_id", "user_id");

-- CreateIndex
CREATE INDEX "index_room_join_requests_on_room_status" ON "room_join_requests"("room_id", "status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "index_room_join_requests_on_room_user" ON "room_join_requests"("room_id", "user_id");

-- CreateIndex
CREATE INDEX "index_room_invitations_on_user_status" ON "room_member_invitations"("user_id", "status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "index_room_invitations_on_room_user" ON "room_member_invitations"("room_id", "user_id");

-- CreateIndex
CREATE INDEX "index_room_knocks_on_room_status" ON "room_knocks"("room_id", "status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "index_room_knocks_on_room_user" ON "room_knocks"("room_id", "user_id");

-- CreateIndex
CREATE INDEX "index_chat_note_copies_on_message_note" ON "chat_note_copies"("message_id", "note_id");

-- CreateIndex
CREATE UNIQUE INDEX "index_chat_note_copies_on_actor_key" ON "chat_note_copies"("copied_by_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "index_room_banners_on_room_kind_archived" ON "room_banners"("room_id", "kind", "archived_at");

-- CreateIndex
CREATE INDEX "index_room_banner_targets_on_user_resolved" ON "room_banner_targets"("user_id", "resolved_at");

-- CreateIndex
CREATE UNIQUE INDEX "index_room_banner_targets_on_banner_and_user" ON "room_banner_targets"("room_banner_id", "user_id");

-- CreateIndex
CREATE INDEX "index_entries_on_room_status_published" ON "entries"("room_id", "status", "published_at", "id");

-- CreateIndex
CREATE INDEX "index_entries_on_room_member_history" ON "entries"("room_id", "user_id", "status", "published_at" DESC, "created_at" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "index_entries_on_author_publication_seek" ON "entries"("user_id", "status", "published_at", "id");

-- CreateIndex
CREATE INDEX "index_entries_on_author_fallback_seek" ON "entries"("user_id", "status", "published_at", "created_at", "id");

-- CreateIndex
CREATE INDEX "index_entries_on_round_status_published" ON "entries"("round_id", "status", "published_at", "id");

-- CreateIndex
CREATE INDEX "index_entries_on_project_status_published" ON "entries"("project_id", "status", "published_at", "id");

-- CreateIndex
CREATE INDEX "index_entries_on_project_fallback_seek" ON "entries"("project_id", "status", "published_at", "created_at", "id");

-- CreateIndex
CREATE INDEX "index_entries_on_source_entry_status" ON "entries"("source_entry_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "index_entries_on_author_share_request" ON "entries"("user_id", "share_request_key");

-- CreateIndex
CREATE UNIQUE INDEX "index_entries_on_author_creation_request" ON "entries"("user_id", "creation_request_key");

-- CreateIndex
CREATE UNIQUE INDEX "index_entries_on_project_saver_reply" ON "entries"("project_id", "user_id", "source_reply_id");

-- CreateIndex
CREATE UNIQUE INDEX "index_entries_on_project_saver_chat_message" ON "entries"("project_id", "user_id", "source_chat_message_id");

-- CreateIndex
CREATE INDEX "index_projects_on_owner_updated" ON "projects"("owner_id", "updated_at");

-- CreateIndex
CREATE UNIQUE INDEX "index_projects_on_owner_creation_request" ON "projects"("owner_id", "creation_request_key");

-- CreateIndex
CREATE INDEX "index_project_rooms_on_room_project" ON "project_rooms"("room_id", "project_id");

-- CreateIndex
CREATE INDEX "index_project_participations_on_user_status" ON "project_participations"("user_id", "status", "updated_at");

-- CreateIndex
CREATE UNIQUE INDEX "index_project_participations_on_project_user" ON "project_participations"("project_id", "user_id");

-- CreateIndex
CREATE INDEX "index_round_history_room_closed" ON "rounds"("room_id", "status", "closed_at", "id");

-- CreateIndex
CREATE INDEX "index_round_history_room_fallback" ON "rounds"("room_id", "status", "closed_at", "updated_at", "id");

-- CreateIndex
CREATE INDEX "index_rounds_on_room_status" ON "rounds"("room_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "published_walls_round_id_key" ON "published_walls"("round_id");

-- CreateIndex
CREATE INDEX "published_walls_room_id_published_at_id_idx" ON "published_walls"("room_id", "published_at", "id");

-- CreateIndex
CREATE UNIQUE INDEX "wall_entries_wall_id_position_key" ON "wall_entries"("wall_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "wall_entries_wall_id_entry_id_key" ON "wall_entries"("wall_id", "entry_id");

-- CreateIndex
CREATE INDEX "index_round_participations_on_round_role_status" ON "round_participations"("round_id", "role", "status");

-- CreateIndex
CREATE INDEX "index_round_participations_on_submitted_entry" ON "round_participations"("submitted_entry_id");

-- CreateIndex
CREATE UNIQUE INDEX "index_round_participations_on_round_user" ON "round_participations"("round_id", "user_id");

-- CreateIndex
CREATE INDEX "index_round_submissions_on_round_user_submitted" ON "round_submissions"("round_id", "user_id", "submitted_at");

-- CreateIndex
CREATE INDEX "index_round_submissions_on_round_entry" ON "round_submissions"("round_id", "entry_id");

-- CreateIndex
CREATE INDEX "index_round_submissions_on_participation" ON "round_submissions"("round_participation_id");

-- CreateIndex
CREATE INDEX "index_round_submissions_on_entry" ON "round_submissions"("entry_id");

-- CreateIndex
CREATE UNIQUE INDEX "index_round_activity_artifacts_on_entry" ON "round_activity_artifacts"("entry_id");

-- CreateIndex
CREATE INDEX "index_round_activity_artifacts_on_round_kind_status" ON "round_activity_artifacts"("round_id", "kind", "status");

-- CreateIndex
CREATE INDEX "index_round_activity_artifacts_on_source" ON "round_activity_artifacts"("source_artifact_id");

-- CreateIndex
CREATE UNIQUE INDEX "index_round_activity_artifacts_on_round_user_kind" ON "round_activity_artifacts"("round_id", "user_id", "kind");

-- CreateIndex
CREATE INDEX "index_round_activity_offers_on_first" ON "round_activity_offers"("first_artifact_id");

-- CreateIndex
CREATE INDEX "index_round_activity_offers_on_second" ON "round_activity_offers"("second_artifact_id");

-- CreateIndex
CREATE INDEX "index_round_activity_offers_on_chosen" ON "round_activity_offers"("chosen_artifact_id");

-- CreateIndex
CREATE INDEX "index_round_choices_on_author_seek" ON "round_activity_offers"("user_id", "updated_at", "id");

-- CreateIndex
CREATE UNIQUE INDEX "index_round_activity_offers_on_round_user" ON "round_activity_offers"("round_id", "user_id");

-- CreateIndex
CREATE INDEX "index_round_activity_moderation_on_artifact" ON "round_activity_moderation_events"("round_id", "artifact_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "entry_subjects_entry_id_key" ON "entry_subjects"("entry_id");

-- CreateIndex
CREATE INDEX "index_entry_subjects_on_type_and_id" ON "entry_subjects"("subject_type", "subject_id");

-- CreateIndex
CREATE INDEX "index_entry_subjects_on_type_and_key" ON "entry_subjects"("subject_type", "subject_key");

-- CreateIndex
CREATE INDEX "index_introductions_on_room_retracted_created" ON "introductions"("room_id", "retracted_at", "created_at");

-- CreateIndex
CREATE INDEX "index_introductions_on_creator_created" ON "introductions"("created_by_id", "created_at");

-- CreateIndex
CREATE INDEX "index_introductions_on_entry_id" ON "introductions"("entry_id");

-- CreateIndex
CREATE INDEX "index_introduction_recipients_on_user_hidden" ON "introduction_recipients"("user_id", "hidden_at");

-- CreateIndex
CREATE UNIQUE INDEX "index_introduction_recipients_on_intro_user" ON "introduction_recipients"("introduction_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "link_previews_url_key" ON "link_previews"("url");

-- CreateIndex
CREATE INDEX "index_link_previews_on_status_fetched" ON "link_previews"("status", "fetched_at");

-- CreateIndex
CREATE INDEX "index_link_preview_attachments_on_preview" ON "link_preview_attachments"("preview_id");

-- CreateIndex
CREATE UNIQUE INDEX "index_link_preview_attachments_on_owner" ON "link_preview_attachments"("owner_type", "owner_id");

-- CreateIndex
CREATE INDEX "index_replies_on_author_publication_seek" ON "replies"("user_id", "status", "published_at", "id");

-- CreateIndex
CREATE INDEX "index_replies_on_author_fallback_seek" ON "replies"("user_id", "status", "published_at", "created_at", "id");

-- CreateIndex
CREATE INDEX "index_replies_on_entry_status_published" ON "replies"("entry_id", "status", "published_at", "id");

-- CreateIndex
CREATE INDEX "index_replies_on_chat_message_status_published" ON "replies"("chat_message_id", "status", "published_at", "id");

-- CreateIndex
CREATE INDEX "index_notes_on_room_deleted_at" ON "notes"("room_id", "deleted_at");

-- CreateIndex
CREATE INDEX "index_documents_on_docable" ON "documents"("docable_type", "docable_id");

-- CreateIndex
CREATE UNIQUE INDEX "index_documents_on_docable_type_and_docable_id" ON "documents"("docable_type", "docable_id");

-- CreateIndex
CREATE UNIQUE INDEX "index_invites_on_email_room_id_invite_type" ON "invites"("email", "room_id", "invite_type");

-- CreateIndex
CREATE INDEX "index_notification_events_on_entry_identity" ON "notification_events"("entry_id", "event_type", "room_id", "target_user_id", "id");

-- CreateIndex
CREATE INDEX "index_notification_events_on_reply_identity" ON "notification_events"("reply_id", "event_type", "room_id", "target_user_id", "id");

-- CreateIndex
CREATE INDEX "index_notification_inbox_items_on_user_created_id" ON "notification_inbox_items"("user_id", "created_at", "id");

-- CreateIndex
CREATE INDEX "index_notification_inbox_items_on_user_seen_id" ON "notification_inbox_items"("user_id", "seen_at", "id");

-- CreateIndex
CREATE UNIQUE INDEX "index_notification_inbox_items_on_event_and_user" ON "notification_inbox_items"("notification_event_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "notification_push_deliveries_notification_inbox_item_id_key" ON "notification_push_deliveries"("notification_inbox_item_id");

-- CreateIndex
CREATE INDEX "index_notification_push_deliveries_on_user_state_due" ON "notification_push_deliveries"("user_id", "state", "due_at");

-- CreateIndex
CREATE INDEX "index_notification_push_deliveries_on_event" ON "notification_push_deliveries"("notification_event_id");

-- CreateIndex
CREATE UNIQUE INDEX "index_push_device_attempts_on_delivery_endpoint" ON "notification_push_device_attempts"("delivery_id", "endpoint_hash");

-- CreateIndex
CREATE UNIQUE INDEX "index_notification_preferences_on_user_scope" ON "notification_preferences"("user_id", "scope_type", "scope_id");

-- CreateIndex
CREATE INDEX "index_entry_view_states_on_user_id" ON "entry_view_states"("user_id");

-- CreateIndex
CREATE INDEX "index_entry_view_states_on_entry_id" ON "entry_view_states"("entry_id");

-- CreateIndex
CREATE UNIQUE INDEX "index_entry_view_states_on_user_and_entry" ON "entry_view_states"("user_id", "entry_id");

-- CreateIndex
CREATE UNIQUE INDEX "index_user_notice_cursors_on_user_id" ON "user_notice_cursors"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "media_processing_attempts_output_key_key" ON "media_processing_attempts"("output_key");

-- CreateIndex
CREATE INDEX "media_processing_attempts_state_created_at_id_idx" ON "media_processing_attempts"("state", "created_at", "id");

-- CreateIndex
CREATE UNIQUE INDEX "media_processing_attempts_blob_id_generation_key" ON "media_processing_attempts"("blob_id", "generation");

-- CreateIndex
CREATE INDEX "index_attachments_on_identity_latest" ON "active_storage_attachments"("record_type", "record_id", "name", "created_at", "id");

-- CreateIndex
CREATE INDEX "index_audio_assets_on_source" ON "audio_assets"("source_type", "source_id");

-- CreateIndex
CREATE INDEX "index_audio_assets_on_blob_id" ON "audio_assets"("blob_id", "id");

-- CreateIndex
CREATE INDEX "index_audio_assets_on_status_seek" ON "audio_assets"("processing_status", "id", "updated_at");

-- CreateIndex
CREATE INDEX "index_video_assets_on_source" ON "video_assets"("source_type", "source_id");

-- CreateIndex
CREATE INDEX "index_video_assets_on_blob_id" ON "video_assets"("blob_id", "id");

-- CreateIndex
CREATE INDEX "index_video_assets_on_status_seek" ON "video_assets"("processing_status", "id", "updated_at");

-- CreateIndex
CREATE INDEX "index_audio_annotations_on_asset_and_anchor" ON "audio_annotations"("audio_asset_id", "anchor_ms");

-- CreateIndex
CREATE INDEX "room_visits_expires_at_idx" ON "room_visits"("expires_at");

-- CreateIndex
CREATE INDEX "queue_worker_heartbeats_seen_at_idx" ON "queue_worker_heartbeats"("seen_at");

-- AddForeignKey
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "rooms"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_saved_by_id_fkey" FOREIGN KEY ("saved_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_pinned_by_id_fkey" FOREIGN KEY ("pinned_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_entry_id_fkey" FOREIGN KEY ("entry_id") REFERENCES "entries"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "chat_message_reads" ADD CONSTRAINT "chat_message_reads_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_message_reads" ADD CONSTRAINT "chat_message_reads_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "chat_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_message_identity_grants" ADD CONSTRAINT "chat_message_identity_grants_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "chat_messages"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "chat_message_identity_grants" ADD CONSTRAINT "chat_message_identity_grants_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "chat_presence_sessions" ADD CONSTRAINT "chat_presence_sessions_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "chat_presence_sessions" ADD CONSTRAINT "chat_presence_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "chat_save_requests" ADD CONSTRAINT "chat_save_requests_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "chat_messages"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "chat_save_requests" ADD CONSTRAINT "chat_save_requests_requester_id_fkey" FOREIGN KEY ("requester_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "chat_save_requests" ADD CONSTRAINT "chat_save_requests_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "room_memberships" ADD CONSTRAINT "room_memberships_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "room_memberships" ADD CONSTRAINT "room_memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "room_join_requests" ADD CONSTRAINT "room_join_requests_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "room_join_requests" ADD CONSTRAINT "room_join_requests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "room_join_requests" ADD CONSTRAINT "room_join_requests_reviewed_by_id_fkey" FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "room_member_invitations" ADD CONSTRAINT "room_member_invitations_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "room_member_invitations" ADD CONSTRAINT "room_member_invitations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "room_member_invitations" ADD CONSTRAINT "room_member_invitations_invited_by_id_fkey" FOREIGN KEY ("invited_by_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "room_knocks" ADD CONSTRAINT "room_knocks_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "room_knocks" ADD CONSTRAINT "room_knocks_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "room_knocks" ADD CONSTRAINT "room_knocks_reviewed_by_id_fkey" FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "chat_note_copies" ADD CONSTRAINT "chat_note_copies_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "chat_messages"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "chat_note_copies" ADD CONSTRAINT "chat_note_copies_note_id_fkey" FOREIGN KEY ("note_id") REFERENCES "notes"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "chat_note_copies" ADD CONSTRAINT "chat_note_copies_copied_by_id_fkey" FOREIGN KEY ("copied_by_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "room_banners" ADD CONSTRAINT "room_banners_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "room_banners" ADD CONSTRAINT "room_banners_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "room_banner_targets" ADD CONSTRAINT "room_banner_targets_room_banner_id_fkey" FOREIGN KEY ("room_banner_id") REFERENCES "room_banners"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "room_banner_targets" ADD CONSTRAINT "room_banner_targets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "entries" ADD CONSTRAINT "entries_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "entries" ADD CONSTRAINT "entries_round_id_fkey" FOREIGN KEY ("round_id") REFERENCES "rounds"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "entries" ADD CONSTRAINT "entries_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "project_rooms" ADD CONSTRAINT "project_rooms_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "project_rooms" ADD CONSTRAINT "project_rooms_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "project_participations" ADD CONSTRAINT "project_participations_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "project_participations" ADD CONSTRAINT "project_participations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "project_participations" ADD CONSTRAINT "project_participations_invited_by_id_fkey" FOREIGN KEY ("invited_by_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "rounds" ADD CONSTRAINT "rounds_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "rounds" ADD CONSTRAINT "rounds_host_id_fkey" FOREIGN KEY ("host_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "published_walls" ADD CONSTRAINT "published_walls_round_id_fkey" FOREIGN KEY ("round_id") REFERENCES "rounds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "published_walls" ADD CONSTRAINT "published_walls_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wall_entries" ADD CONSTRAINT "wall_entries_wall_id_fkey" FOREIGN KEY ("wall_id") REFERENCES "published_walls"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wall_entries" ADD CONSTRAINT "wall_entries_entry_id_fkey" FOREIGN KEY ("entry_id") REFERENCES "entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wall_presentations" ADD CONSTRAINT "wall_presentations_wall_id_fkey" FOREIGN KEY ("wall_id") REFERENCES "published_walls"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wall_presentations" ADD CONSTRAINT "wall_presentations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "round_participations" ADD CONSTRAINT "round_participations_round_id_fkey" FOREIGN KEY ("round_id") REFERENCES "rounds"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "round_participations" ADD CONSTRAINT "round_participations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "round_participations" ADD CONSTRAINT "round_participations_submitted_entry_id_fkey" FOREIGN KEY ("submitted_entry_id") REFERENCES "entries"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "round_submissions" ADD CONSTRAINT "round_submissions_round_id_fkey" FOREIGN KEY ("round_id") REFERENCES "rounds"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "round_submissions" ADD CONSTRAINT "round_submissions_round_participation_id_fkey" FOREIGN KEY ("round_participation_id") REFERENCES "round_participations"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "round_submissions" ADD CONSTRAINT "round_submissions_entry_id_fkey" FOREIGN KEY ("entry_id") REFERENCES "entries"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "round_submissions" ADD CONSTRAINT "round_submissions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "round_activity_artifacts" ADD CONSTRAINT "round_activity_artifacts_round_id_fkey" FOREIGN KEY ("round_id") REFERENCES "rounds"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "round_activity_artifacts" ADD CONSTRAINT "round_activity_artifacts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "round_activity_artifacts" ADD CONSTRAINT "round_activity_artifacts_entry_id_fkey" FOREIGN KEY ("entry_id") REFERENCES "entries"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "round_activity_artifacts" ADD CONSTRAINT "round_activity_artifacts_source_artifact_id_fkey" FOREIGN KEY ("source_artifact_id") REFERENCES "round_activity_artifacts"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "round_activity_offers" ADD CONSTRAINT "round_activity_offers_round_id_fkey" FOREIGN KEY ("round_id") REFERENCES "rounds"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "round_activity_offers" ADD CONSTRAINT "round_activity_offers_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "round_activity_offers" ADD CONSTRAINT "round_activity_offers_first_artifact_id_fkey" FOREIGN KEY ("first_artifact_id") REFERENCES "round_activity_artifacts"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "round_activity_offers" ADD CONSTRAINT "round_activity_offers_second_artifact_id_fkey" FOREIGN KEY ("second_artifact_id") REFERENCES "round_activity_artifacts"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "round_activity_offers" ADD CONSTRAINT "round_activity_offers_chosen_artifact_id_fkey" FOREIGN KEY ("chosen_artifact_id") REFERENCES "round_activity_artifacts"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "round_activity_moderation_events" ADD CONSTRAINT "round_activity_moderation_events_round_id_fkey" FOREIGN KEY ("round_id") REFERENCES "rounds"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "round_activity_moderation_events" ADD CONSTRAINT "round_activity_moderation_events_artifact_id_fkey" FOREIGN KEY ("artifact_id") REFERENCES "round_activity_artifacts"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "round_activity_moderation_events" ADD CONSTRAINT "round_activity_moderation_events_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "entry_subjects" ADD CONSTRAINT "entry_subjects_entry_id_fkey" FOREIGN KEY ("entry_id") REFERENCES "entries"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "introductions" ADD CONSTRAINT "introductions_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "introductions" ADD CONSTRAINT "introductions_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "introductions" ADD CONSTRAINT "introductions_retracted_by_id_fkey" FOREIGN KEY ("retracted_by_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "introductions" ADD CONSTRAINT "introductions_entry_id_fkey" FOREIGN KEY ("entry_id") REFERENCES "entries"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "introduction_recipients" ADD CONSTRAINT "introduction_recipients_introduction_id_fkey" FOREIGN KEY ("introduction_id") REFERENCES "introductions"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "introduction_recipients" ADD CONSTRAINT "introduction_recipients_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "link_preview_attachments" ADD CONSTRAINT "link_preview_attachments_preview_id_fkey" FOREIGN KEY ("preview_id") REFERENCES "link_previews"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "replies" ADD CONSTRAINT "replies_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "replies" ADD CONSTRAINT "replies_entry_id_fkey" FOREIGN KEY ("entry_id") REFERENCES "entries"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "replies" ADD CONSTRAINT "replies_chat_message_id_fkey" FOREIGN KEY ("chat_message_id") REFERENCES "chat_messages"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "notes" ADD CONSTRAINT "notes_parent_note_id_fkey" FOREIGN KEY ("parent_note_id") REFERENCES "notes"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "notes" ADD CONSTRAINT "notes_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "notes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reflections" ADD CONSTRAINT "reflections_note_id_fkey" FOREIGN KEY ("note_id") REFERENCES "notes"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "reflections" ADD CONSTRAINT "reflections_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "invites" ADD CONSTRAINT "invites_invited_by_id_fkey" FOREIGN KEY ("invited_by_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "invites" ADD CONSTRAINT "invites_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "one_time_tokens" ADD CONSTRAINT "one_time_tokens_invite_id_fkey" FOREIGN KEY ("invite_id") REFERENCES "invites"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "one_time_tokens" ADD CONSTRAINT "one_time_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "notification_events" ADD CONSTRAINT "fk_rails_3400c0d703" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "notification_events" ADD CONSTRAINT "fk_rails_4573107ab6" FOREIGN KEY ("target_user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "notification_events" ADD CONSTRAINT "fk_rails_ae6ac5706e" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "notification_events" ADD CONSTRAINT "fk_rails_d62a63df74" FOREIGN KEY ("entry_id") REFERENCES "entries"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "notification_events" ADD CONSTRAINT "notification_events_reply_id_fkey" FOREIGN KEY ("reply_id") REFERENCES "replies"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "notification_inbox_items" ADD CONSTRAINT "notification_inbox_items_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "notification_inbox_items" ADD CONSTRAINT "notification_inbox_items_notification_event_id_fkey" FOREIGN KEY ("notification_event_id") REFERENCES "notification_events"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "notification_push_deliveries" ADD CONSTRAINT "notification_push_deliveries_notification_inbox_item_id_fkey" FOREIGN KEY ("notification_inbox_item_id") REFERENCES "notification_inbox_items"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "notification_push_deliveries" ADD CONSTRAINT "notification_push_deliveries_notification_event_id_fkey" FOREIGN KEY ("notification_event_id") REFERENCES "notification_events"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "notification_push_deliveries" ADD CONSTRAINT "notification_push_deliveries_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "notification_push_device_attempts" ADD CONSTRAINT "notification_push_device_attempts_delivery_id_fkey" FOREIGN KEY ("delivery_id") REFERENCES "notification_push_deliveries"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "entry_view_states" ADD CONSTRAINT "entry_view_states_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "entry_view_states" ADD CONSTRAINT "entry_view_states_entry_id_fkey" FOREIGN KEY ("entry_id") REFERENCES "entries"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "user_notice_cursors" ADD CONSTRAINT "user_notice_cursors_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "roles" ADD CONSTRAINT "roles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "media_processing_attempts" ADD CONSTRAINT "media_processing_attempts_blob_id_fkey" FOREIGN KEY ("blob_id") REFERENCES "active_storage_blobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "active_storage_attachments" ADD CONSTRAINT "active_storage_attachments_blob_id_fkey" FOREIGN KEY ("blob_id") REFERENCES "active_storage_blobs"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "active_storage_variant_records" ADD CONSTRAINT "active_storage_variant_records_blob_id_fkey" FOREIGN KEY ("blob_id") REFERENCES "active_storage_blobs"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "audio_assets" ADD CONSTRAINT "audio_assets_blob_id_fkey" FOREIGN KEY ("blob_id") REFERENCES "active_storage_blobs"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "audio_assets" ADD CONSTRAINT "audio_assets_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "video_assets" ADD CONSTRAINT "video_assets_blob_id_fkey" FOREIGN KEY ("blob_id") REFERENCES "active_storage_blobs"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "video_assets" ADD CONSTRAINT "video_assets_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "audio_annotations" ADD CONSTRAINT "audio_annotations_audio_asset_id_fkey" FOREIGN KEY ("audio_asset_id") REFERENCES "audio_assets"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "audio_annotations" ADD CONSTRAINT "audio_annotations_reply_id_fkey" FOREIGN KEY ("reply_id") REFERENCES "replies"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "audio_annotations" ADD CONSTRAINT "audio_annotations_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "room_visits" ADD CONSTRAINT "room_visits_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "room_visits" ADD CONSTRAINT "room_visits_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- Custom business safeguards not represented by Prisma.
BEGIN;

-- PostgreSQL checks supplement the CLI-generated Prisma schema migration.
-- Prisma does not express CHECK constraints in its data model.
ALTER TABLE rooms
  ADD CONSTRAINT room_feedback_reply_mode_valid
    CHECK (reply_mode IN ('simple', 'guided')),
  ADD CONSTRAINT room_feedback_idea_guidance_valid
    CHECK (default_idea_guidance IN ('open', 'craft', 'concept', 'readiness', 'constraint', 'professional')),
  ADD CONSTRAINT room_feedback_types_valid
    CHECK (jsonb_typeof(default_feedback_types::jsonb) = 'array'
      AND default_feedback_types::jsonb <@ '["impression","question","idea"]'::jsonb),
  ADD CONSTRAINT room_guided_feedback_nonempty
    CHECK (reply_mode <> 'guided' OR default_feedback_types::jsonb <> '[]'::jsonb);

COMMIT;

-- Prisma CLI generated the empty schema-diff scaffold; this data-preserving
-- constraint is custom SQL because Prisma does not model CHECK constraints.
-- Validation deliberately refuses unexpected historical preferences. Do not
-- delete or coalesce such rows to force deployment; reconcile them first.
BEGIN;
ALTER TABLE notification_preferences
  ADD CONSTRAINT notification_preferences_active_scope
  CHECK (scope_type IN ('Post', 'Circle', 'Global'));
COMMIT;

-- This is an empty migration.

-- pg-boss owns its tables. Install after its schema exists, including fresh starts.
CREATE FUNCTION public.afire_ensure_queue_indexes() RETURNS boolean
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('afire.queue-index-install', 0));
  IF to_regclass('pgboss.job') IS NULL THEN RETURN false; END IF;
  CREATE INDEX IF NOT EXISTS afire_job_name_state_idx ON pgboss.job (name, state);
  IF NOT EXISTS (
    SELECT 1 FROM pg_index i
    JOIN pg_class c ON c.oid=i.indexrelid
    JOIN pg_namespace n ON n.oid=c.relnamespace
    JOIN pg_am am ON am.oid=c.relam
    WHERE n.nspname='pgboss' AND c.relname='afire_job_name_state_idx'
      AND i.indrelid='pgboss.job'::regclass AND i.indisvalid AND i.indisready
      AND NOT i.indisunique AND i.indnkeyatts=2 AND i.indnatts=2
      AND i.indexprs IS NULL AND i.indpred IS NULL AND am.amname='btree'
      AND pg_get_indexdef(i.indexrelid,1,true)='name'
      AND pg_get_indexdef(i.indexrelid,2,true)='state'
  ) THEN
    RAISE EXCEPTION 'A Fire queue lookup index is missing, invalid, or incompatible';
  END IF;
  RETURN true;
END;
$$;
SELECT public.afire_ensure_queue_indexes();

ALTER TABLE "room_visits" ADD CONSTRAINT "room_visits_source_check" CHECK ("source" IN ('porosity', 'knock'));
ALTER TABLE "room_visits" ADD CONSTRAINT "room_visits_interval_check" CHECK ("expires_at" >= "last_activity_at");
-- Reject malformed destination identity and impossible attempt bookkeeping.
ALTER TABLE "notification_push_device_attempts"
  ADD CONSTRAINT "push_device_attempt_identity_check" CHECK (
    endpoint_hash ~ '^[0-9a-f]{64}$' AND subscription_id > 0 AND attempt_count > 0
  ),
  ADD CONSTRAINT "push_device_attempt_completion_check" CHECK (
    (state = 'started' AND completed_at IS NULL) OR
    (state <> 'started' AND completed_at IS NOT NULL AND completed_at >= started_at)
  );


CREATE UNIQUE INDEX index_notification_preferences_on_null_scope
ON notification_preferences(user_id, scope_type) WHERE scope_id IS NULL;

ALTER TABLE rounds ADD CONSTRAINT rounds_require_room CHECK (room_id IS NOT NULL);
CREATE UNIQUE INDEX index_rounds_one_active_per_room ON rounds(room_id) WHERE status = 'active';
CREATE UNIQUE INDEX index_rounds_one_draft_per_room ON rounds(room_id) WHERE status = 'draft';

ALTER TABLE entries ADD CONSTRAINT entries_document_format CHECK (format = 'mixed_media');
ALTER TABLE entries ADD CONSTRAINT entries_private_or_room_scope CHECK (project_id IS NULL OR room_id IS NULL);
