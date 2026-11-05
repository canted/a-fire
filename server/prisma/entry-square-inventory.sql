-- Aggregate only. Run inside a repeatable-read, read-only transaction.
WITH classified AS (
 SELECT CASE WHEN s.id IS NULL THEN 'missing_square'
   WHEN s.user_id IS DISTINCT FROM p.user_id THEN 'conflicting_user'
   WHEN s.circle_id IS NULL THEN 'unscoped_square'
   WHEN p.circle_id IS NOT NULL AND p.circle_id<>s.circle_id THEN 'conflicting_room'
   WHEN c.id IS NULL THEN 'missing_room'
   ELSE 'consistent' END AS scope,
   CASE WHEN p.status ~ '^[a-z_]{1,32}$' THEN p.status ELSE 'unclassified' END AS status,
   p.project_id IS NOT NULL AS has_project,
   p.source_entry_id IS NOT NULL AS has_private_source,
   p.creation_origin='chat_attachment' AS chat_attachment,
   EXISTS (SELECT 1 FROM circle_memberships m WHERE m.circle_id=s.circle_id AND m.user_id=p.user_id AND NOT m.disabled) AS current_member,
   EXISTS (SELECT 1 FROM round_participations r WHERE r.submitted_post_id=p.id) AS submitted_to_round
 FROM posts p LEFT JOIN squares s ON s.id=p.square_id
 LEFT JOIN circles c ON c.id=s.circle_id WHERE p.square_id IS NOT NULL
)
SELECT scope,status,has_project,has_private_source,chat_attachment,current_member,
 submitted_to_round,count(*)::text AS entries
FROM classified GROUP BY 1,2,3,4,5,6,7 ORDER BY 1,2,3,4,5,6,7;
