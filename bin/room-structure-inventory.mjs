#!/usr/bin/env node
// Counts only: never prints names, content, credentials or individual identities.
import { createRequire } from 'node:module';
import { parseArgs } from 'node:util';
const require = createRequire(import.meta.url);
const { Client } = createRequire(require.resolve('pg-boss'))('pg');
let client;
const checks = {
  boards: 'SELECT count(*) FROM boards',
  squares: 'SELECT count(*) FROM squares',
  rooms_with_multiple_boards: 'SELECT count(*) FROM (SELECT circle_id FROM boards WHERE circle_id IS NOT NULL GROUP BY circle_id HAVING count(*) > 1) groups',
  rooms_with_conflicting_board_defaults: `SELECT count(*) FROM (SELECT room_id FROM boards WHERE room_id IS NOT NULL GROUP BY room_id HAVING count(DISTINCT jsonb_build_array(reply_mode, default_feedback_types::jsonb, default_idea_guidance)) > 1) groups`,
  boards_with_invalid_reply_mode: "SELECT count(*) FROM boards WHERE reply_mode IS NULL OR reply_mode NOT IN ('simple','guided')",
  boards_with_invalid_idea_guidance: "SELECT count(*) FROM boards WHERE default_idea_guidance IS NULL OR default_idea_guidance NOT IN ('open','craft','concept','readiness','constraint','professional')",
  boards_with_nonarray_feedback_types: "SELECT count(*) FROM boards WHERE jsonb_typeof(default_feedback_types::jsonb) IS DISTINCT FROM 'array'",
  guided_boards_without_valid_feedback_types: `SELECT count(*) FROM boards WHERE reply_mode='guided' AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(default_feedback_types::jsonb)='array' THEN default_feedback_types::jsonb ELSE '[]'::jsonb END) item WHERE item IN ('"impression"'::jsonb, '"question"'::jsonb, '"idea"'::jsonb))`,
  existing_room_boards_with_invalid_defaults: `SELECT count(*) FROM boards b JOIN rooms c ON c.id=b.room_id WHERE (b.reply_mode IS NULL OR b.reply_mode NOT IN ('simple','guided') OR b.default_idea_guidance IS NULL OR b.default_idea_guidance NOT IN ('open','craft','concept','readiness','constraint','professional') OR jsonb_typeof(b.default_feedback_types::jsonb) IS DISTINCT FROM 'array')`,
  boards_without_room: 'SELECT count(*) FROM boards b LEFT JOIN circles c ON c.id=b.circle_id WHERE c.id IS NULL',
  squares_without_board: 'SELECT count(*) FROM squares s LEFT JOIN boards b ON b.id=s.board_id WHERE b.id IS NULL',
  square_board_room_mismatch: 'SELECT count(*) FROM squares s JOIN boards b ON b.id=s.board_id WHERE s.circle_id IS DISTINCT FROM b.circle_id',
  duplicate_room_user_positions: 'SELECT count(*) FROM (SELECT circle_id,user_id FROM squares WHERE circle_id IS NOT NULL AND user_id IS NOT NULL GROUP BY circle_id,user_id HAVING count(*) > 1) groups',
  squares_without_membership: 'SELECT count(*) FROM squares s WHERE NOT EXISTS (SELECT 1 FROM circle_memberships m WHERE m.circle_id=s.circle_id AND m.user_id=s.user_id)',
  squares_with_profile_values: 'SELECT count(*) FROM squares WHERE name IS NOT NULL OR style IS NOT NULL OR seed IS NOT NULL',
  squares_with_notification_value: 'SELECT count(*) FROM squares WHERE notify IS NOT NULL',
  invalid_current_entry_pointers: `SELECT count(*) FROM squares s LEFT JOIN entries p ON p.id=s.current_post_id WHERE s.current_post_id IS NOT NULL AND (p.id IS NULL OR p.square_id IS DISTINCT FROM s.id OR p.status <> 'published')`,
  entries_with_square: 'SELECT count(*) FROM posts WHERE square_id IS NOT NULL',
  entry_square_room_mismatch: 'SELECT count(*) FROM posts p JOIN squares s ON s.id=p.square_id WHERE p.circle_id IS DISTINCT FROM s.circle_id',
  published_entry_square_author_mismatch: "SELECT count(*) FROM posts p JOIN squares s ON s.id=p.square_id WHERE p.status='published' AND p.user_id IS DISTINCT FROM s.user_id",
  published_entry_explicit_room_conflict: "SELECT count(*) FROM posts p JOIN squares s ON s.id=p.square_id WHERE p.status='published' AND p.circle_id IS NOT NULL AND p.circle_id IS DISTINCT FROM s.circle_id",
  published_entries_with_inherited_room: "SELECT count(*) FROM posts p JOIN squares s ON s.id=p.square_id WHERE p.status='published' AND p.circle_id IS NULL AND s.circle_id IS NOT NULL",
  published_room_entries_without_square: "SELECT count(*) FROM posts WHERE status='published' AND circle_id IS NOT NULL AND square_id IS NULL",
  published_chat_attachment_entries_without_square: "SELECT count(*) FROM posts WHERE status='published' AND circle_id IS NOT NULL AND square_id IS NULL AND creation_origin='chat_attachment'",
  published_nonchat_room_entries_without_square: "SELECT count(*) FROM posts WHERE status='published' AND circle_id IS NOT NULL AND square_id IS NULL AND creation_origin IS DISTINCT FROM 'chat_attachment'",

  room_authors_with_multiple_published_positions: "SELECT count(*) FROM (SELECT s.circle_id,s.user_id FROM squares s JOIN posts p ON p.square_id=s.id WHERE s.circle_id IS NOT NULL AND s.user_id IS NOT NULL AND p.status='published' GROUP BY s.circle_id,s.user_id HAVING count(DISTINCT s.id)>1) groups",

  participations_with_square: 'SELECT count(*) FROM round_participations WHERE square_id IS NOT NULL',
  notifications_with_board: 'SELECT count(*) FROM notification_events WHERE board_id IS NOT NULL',
  notifications_with_square: 'SELECT count(*) FROM notification_events WHERE square_id IS NOT NULL',
  rounds_with_board: 'SELECT count(*) FROM rounds WHERE board_id IS NOT NULL',
  rounds_with_consistent_explicit_room: 'SELECT count(*) FROM rounds r JOIN boards b ON b.id=r.board_id WHERE r.circle_id IS NOT NULL AND r.circle_id=b.circle_id',
  rounds_with_inherited_room: 'SELECT count(*) FROM rounds r JOIN boards b ON b.id=r.board_id WHERE r.circle_id IS NULL AND b.circle_id IS NOT NULL',
  rounds_without_room: 'SELECT count(*) FROM rounds r JOIN boards b ON b.id=r.board_id WHERE r.circle_id IS NULL AND b.circle_id IS NULL',
  rounds_with_conflicting_room: 'SELECT count(*) FROM rounds r JOIN boards b ON b.id=r.board_id WHERE r.circle_id IS NOT NULL AND r.circle_id IS DISTINCT FROM b.circle_id',
  rounds_without_valid_board: 'SELECT count(*) FROM rounds r LEFT JOIN boards b ON b.id=r.board_id WHERE r.board_id IS NOT NULL AND b.id IS NULL',
  rounds_owned_directly_by_room: 'SELECT count(*) FROM rounds r JOIN circles c ON c.id=r.circle_id WHERE r.board_id IS NULL',
  rounds_without_valid_room: 'SELECT count(*) FROM rounds r LEFT JOIN boards b ON b.id=r.board_id LEFT JOIN circles c ON c.id=COALESCE(r.circle_id,b.circle_id) WHERE c.id IS NULL',
  rooms_with_multiple_active_rounds: `SELECT count(*) FROM (SELECT COALESCE(r.room_id,b.room_id) FROM rounds r LEFT JOIN boards b ON b.id=r.board_id JOIN rooms c ON c.id=COALESCE(r.room_id,b.room_id)
    WHERE r.status='active' AND (r.board_id IS NULL OR (b.id IS NOT NULL AND (r.room_id IS NULL OR r.room_id=b.room_id)))
    GROUP BY COALESCE(r.room_id,b.room_id) HAVING count(*)>1) conflicts`,
  board_notification_preferences: "SELECT count(*) FROM notification_preferences WHERE scope_type='Board'",
  square_notification_preferences: "SELECT count(*) FROM notification_preferences WHERE scope_type='Square'",
  dangling_board_preferences: "SELECT count(*) FROM notification_preferences n LEFT JOIN boards b ON b.id=n.scope_id WHERE n.scope_type='Board' AND b.id IS NULL",
  dangling_square_preferences: "SELECT count(*) FROM notification_preferences n LEFT JOIN squares s ON s.id=n.scope_id WHERE n.scope_type='Square' AND s.id IS NULL",
  duplicate_legacy_preference_scopes: "SELECT count(*) FROM (SELECT user_id,scope_type,scope_id FROM notification_preferences WHERE scope_type IN ('Board','Square') GROUP BY user_id,scope_type,scope_id HAVING count(*) > 1) groups",
  board_attachments: "SELECT count(*) FROM active_storage_attachments WHERE record_type='Board'",
  square_attachments: "SELECT count(*) FROM active_storage_attachments WHERE record_type='Square'",

};
const historicalOwners = [
  ['documents', 'documents', 'docable_type'], ['reflections', 'reflections', 'reflectable_type'],
  ['link_previews', 'link_preview_attachments', 'owner_type'], ['audio_assets', 'audio_assets', 'source_type'],
  ['video_assets', 'video_assets', 'source_type'], ['post_subjects', 'post_subjects', 'subject_type'],
];
const historicalOwnerCounts = [];
for (const [suffix, table, column] of historicalOwners) for (const kind of ['Board', 'Square']) {
  const key = `${kind.toLowerCase()}_${suffix}`;
  historicalOwnerCounts.push(key);
  checks[key] = `SELECT count(*) FROM ${table} WHERE ${column}='${kind}'`;
}
try {
  const { values } = parseArgs({ options: { 'require-retired': { type: 'boolean', default: false } } });
  const connectionString = process.env.INVENTORY_DATABASE_URL;
  if (!connectionString) throw new Error('Explicit target required');
  const target = new URL(connectionString);
  if (!['postgres:', 'postgresql:'].includes(target.protocol)) throw new Error('Invalid target');
  const database = decodeURIComponent(target.pathname.slice(1));
  client = new Client({ connectionString, application_name: 'room-structure-inventory', connectionTimeoutMillis: 10000 });
  await client.connect();
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  await client.query("SET LOCAL statement_timeout = '30s'");
  const counts = {};
  for (const [name, sql] of Object.entries(checks)) counts[name] = (await client.query(sql)).rows[0].count;
  const references = (await client.query(`SELECT conrelid::regclass::text AS source_table, conname AS constraint_name, pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE contype='f' AND confrelid IN ('boards'::regclass, 'squares'::regclass) ORDER BY source_table, constraint_name`)).rows;
  const squareless_entry_groups = (await client.query(`SELECT
CASE WHEN p.creation_origin IN ('chat_attachment','chat_conversion','chat_saved_by_member','project_material','project_feedback','round_activity_cover','round_activity_response') THEN p.creation_origin WHEN p.creation_origin IS NULL THEN 'unspecified' ELSE 'other' END AS origin,
c.id IS NOT NULL AS room_exists, CASE WHEN to_jsonb(c) ? 'deleted_at' THEN to_jsonb(c)->>'deleted_at' IS NOT NULL ELSE NULL END AS room_deleted,
EXISTS(SELECT 1 FROM room_memberships m WHERE m.room_id=p.room_id AND m.user_id=p.user_id AND NOT m.disabled) AS active_member,
EXISTS(SELECT 1 FROM chat_messages m WHERE m.entry_id=p.id) AS chat_link,
p.project_id IS NOT NULL AS project_link, p.source_entry_id IS NOT NULL AS source_entry_link,
count(*) FROM entries p LEFT JOIN rooms c ON c.id=p.room_id
WHERE p.status='published' AND p.room_id IS NOT NULL AND p.square_id IS NULL
GROUP BY 1,2,3,4,5,6,7 ORDER BY 1,2,3,4,5,6,7`)).rows;
  await client.query('COMMIT');
  const blockingCounts = ['boards', 'squares', 'entries_with_square', 'rounds_with_board',
    'participations_with_square', 'notifications_with_board', 'notifications_with_square',
    'board_notification_preferences', 'square_notification_preferences', 'board_attachments', 'square_attachments', ...historicalOwnerCounts];
  const blockers = blockingCounts.filter(name => BigInt(counts[name]) !== 0n);
  const retirement = values['require-retired'] ? { rows_and_references_retired: blockers.length === 0, blockers } : undefined;
  if (retirement && blockers.length) process.exitCode = 2;
  console.log(JSON.stringify({ ...(retirement ? { retirement } : {}), database, captured_at: new Date().toISOString(), read_only: true, counts, references, squareless_entry_groups }, null, 2));
} catch {
  console.error('Room structure inventory failed. No complete inventory established. Check the explicit INVENTORY_DATABASE_URL, connectivity, permissions and schema.');
  process.exitCode = 1;
} finally {
  await client?.end().catch(() => { process.exitCode = 1; });
}
