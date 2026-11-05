-- Run with Perfetto trace_processor query -f against a local Android trace.
SELECT p.name AS process, t.name AS thread, round(sum(s.dur)/1e6, 1) AS cpu_ms
FROM sched s JOIN thread t USING (utid) LEFT JOIN process p USING (upid)
WHERE s.dur > 0 AND t.name != 'swapper'
GROUP BY s.utid ORDER BY cpu_ms DESC LIMIT 20;

SELECT s.name, count(*) AS samples, round(sum(s.dur)/1e6, 1) AS total_ms,
  round(max(s.dur)/1e6, 1) AS max_ms
FROM slice s JOIN thread_track tt ON s.track_id = tt.id
JOIN thread t USING (utid) JOIN process p USING (upid)
WHERE p.name = 'co.canted.afire.preview.localhttps' AND t.tid = p.pid AND s.dur > 0
GROUP BY s.name ORDER BY total_ms DESC LIMIT 30;

SELECT t.name, ts.state, round(sum(ts.dur)/1e6, 1) AS ms,
  round(max(ts.dur)/1e6, 1) AS longest_ms
FROM thread_state ts JOIN thread t USING (utid) JOIN process p USING (upid)
WHERE p.name = 'co.canted.afire.preview.localhttps'
  AND t.name IN ('mqt_v_js', 'view.localhttps', 'RenderThread') AND ts.dur > 0
GROUP BY t.name, ts.state ORDER BY t.name, ms DESC;
