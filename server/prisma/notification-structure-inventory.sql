-- Aggregate only. Record retained metadata and URL dependencies before conversion.
WITH classified AS (
 SELECT CASE WHEN n.event_type ~ '^[a-z_]{1,64}$' THEN n.event_type ELSE 'unclassified' END AS event_type,
   CASE WHEN c.id IS NULL THEN 'missing_room'
     WHEN n.board_id IS NOT NULL AND b.id IS NULL THEN 'missing_board'
     WHEN n.board_id IS NOT NULL AND b.circle_id IS DISTINCT FROM n.circle_id THEN 'conflicting_board_room'
     WHEN n.square_id IS NOT NULL AND s.id IS NULL THEN 'missing_square'
     WHEN n.square_id IS NOT NULL AND s.circle_id IS DISTINCT FROM n.circle_id THEN 'conflicting_square_room'
     WHEN n.board_id IS NOT NULL AND n.square_id IS NOT NULL AND s.board_id<>n.board_id THEN 'conflicting_square_board'
     ELSE 'consistent' END AS scope,
   n.board_id IS NOT NULL AS has_board,n.square_id IS NOT NULL AS has_square,
   n.post_id IS NOT NULL AS has_entry,
   CASE WHEN n.target_path IS NULL THEN 'absent'
     WHEN n.target_path ~ '/board/[^/]+/activities/' THEN 'board_round'
     WHEN n.target_path ~ '/square/' THEN 'square'
     WHEN n.target_path ~ '/(posts?|entries)/' THEN 'entry'
     ELSE 'other' END AS target_kind
 FROM notification_events n LEFT JOIN circles c ON c.id=n.circle_id
 LEFT JOIN boards b ON b.id=n.board_id LEFT JOIN squares s ON s.id=n.square_id
 WHERE n.board_id IS NOT NULL OR n.square_id IS NOT NULL
)
SELECT event_type,scope,has_board,has_square,has_entry,target_kind,count(*)::text AS notifications
FROM classified GROUP BY 1,2,3,4,5,6 ORDER BY 1,2,3,4,5,6;
