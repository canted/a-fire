-- Aggregate only. Run within a repeatable-read, read-only transaction.
WITH scopes AS (
  SELECT p.id, p.square_id, p.user_id, p.submitted_post_id,
    s.id AS existing_square, s.user_id AS square_user,
    CASE WHEN r.board_id IS NULL THEN r.circle_id
      WHEN rb.id IS NOT NULL AND (r.circle_id IS NULL OR r.circle_id=rb.circle_id)
      THEN rb.circle_id END AS round_room,
    CASE WHEN sb.id IS NOT NULL AND (s.circle_id IS NULL OR s.circle_id=sb.circle_id)
      THEN sb.circle_id END AS square_room
  FROM round_participations p
  LEFT JOIN rounds r ON r.id=p.round_id
  LEFT JOIN boards rb ON rb.id=r.board_id
  LEFT JOIN squares s ON s.id=p.square_id
  LEFT JOIN boards sb ON sb.id=s.board_id
), classified AS (
  SELECT CASE WHEN square_id IS NULL THEN 'already_detached'
    WHEN existing_square IS NULL THEN 'missing_square'
    WHEN square_user IS DISTINCT FROM user_id THEN 'conflicting_user'
    WHEN round_room IS NULL THEN 'unresolved_round_room'
    WHEN square_room IS NULL THEN 'unresolved_square_room'
    WHEN square_room<>round_room THEN 'conflicting_room'
    WHEN NOT EXISTS (SELECT 1 FROM circles c WHERE c.id=round_room) THEN 'missing_room'
    ELSE 'consistent' END AS scope,
    submitted_post_id IS NOT NULL AS has_submitted_entry,
    EXISTS (SELECT 1 FROM circle_memberships m WHERE m.circle_id=round_room AND m.user_id=scopes.user_id AND NOT m.disabled) AS current_member
  FROM scopes
)
SELECT scope,has_submitted_entry,current_member,count(*)::text AS participations
FROM classified GROUP BY 1,2,3 ORDER BY 1,2,3;
