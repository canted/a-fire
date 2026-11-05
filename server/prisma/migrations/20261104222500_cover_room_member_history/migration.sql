-- DropIndex
DROP INDEX "index_entries_on_room_member_history";

-- Keep only Wall-visible copies in the ordered history index. This avoids
-- scanning an author's newer history from unrelated Rooms for a small LIMIT.
CREATE INDEX "index_entries_on_room_member_history" ON "entries"("room_id", "user_id", "published_at" DESC, "created_at" DESC, "id" DESC)
WHERE "status" = 'published' AND "project_id" IS NULL AND "source_entry_id" IS NOT NULL
  AND "creation_origin" IS DISTINCT FROM 'chat_attachment';
