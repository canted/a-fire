-- Aggregate only; run inside a repeatable-read, read-only transaction.
-- Scope evidence never chooses ownership or rewrites historical records.
WITH classified AS (
  SELECT r.id,
    CASE WHEN r.board_id IS NULL AND direct.id IS NOT NULL THEN 'room_owned'
      WHEN b.id IS NULL THEN 'missing_board'
      WHEN r.circle_id IS NOT NULL AND r.circle_id IS DISTINCT FROM b.circle_id THEN 'conflicting'
      WHEN COALESCE(direct.id, inherited.id) IS NULL THEN 'missing_room'
      WHEN r.circle_id IS NULL THEN 'inherited'
      ELSE 'consistent' END AS scope,
    CASE WHEN r.status = '' THEN 'empty' WHEN r.status ~ '^[a-z_]{1,32}$' THEN r.status WHEN r.status ~ '^[0-9]+$' THEN 'numeric' ELSE 'unclassified' END AS status,
    direct.id IS NOT NULL AS explicit_room_exists,
    inherited.id IS NOT NULL AS board_room_exists,
    EXISTS (SELECT 1 FROM circle_memberships m WHERE m.circle_id=r.circle_id AND m.user_id=r.host_id AND NOT m.disabled) AS host_in_explicit_room,
    EXISTS (SELECT 1 FROM circle_memberships m WHERE m.circle_id=b.circle_id AND m.user_id=r.host_id AND NOT m.disabled) AS host_in_board_room,
    EXISTS (SELECT 1 FROM posts p WHERE p.round_id=r.id) AS has_entries,
    EXISTS (SELECT 1 FROM round_participations p WHERE p.round_id=r.id) AS has_participations,
    EXISTS (SELECT 1 FROM round_activity_artifacts a WHERE a.round_id=r.id) AS has_artifacts
  FROM rounds r LEFT JOIN boards b ON b.id=r.board_id
  LEFT JOIN circles direct ON direct.id=r.circle_id
  LEFT JOIN circles inherited ON inherited.id=b.circle_id
)
SELECT scope,status,explicit_room_exists,board_room_exists,
  host_in_explicit_room,host_in_board_room,has_entries,has_participations,has_artifacts,
  count(*)::text AS rounds
FROM classified
GROUP BY 1,2,3,4,5,6,7,8,9 ORDER BY 1,2,3,4,5,6,7,8,9;
