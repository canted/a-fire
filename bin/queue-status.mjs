#!/usr/bin/env node
// Operational metadata only; never emits job payloads, outputs or credentials.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { Client } = createRequire(require.resolve('pg-boss'))('pg');
const connectionString = process.env.QUEUE_STATUS_DATABASE_URL;
let client;
try {
  if (!connectionString) throw new Error('Explicit target required');
  const target = new URL(connectionString);
  if (!['postgres:', 'postgresql:'].includes(target.protocol)) throw new Error('PostgreSQL target required');
  client = new Client({ connectionString, application_name: 'queue-status', connectionTimeoutMillis: 10000 });
  await client.connect();
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  await client.query("SET LOCAL statement_timeout = '10s'");
  const queues = (await client.query(`
    SELECT name AS queue, state::text AS state, count(*)::text AS jobs,
      min(created_on) AS oldest_created_at,
      max(retry_count) AS highest_retry_count,
      count(*) FILTER (WHERE state IN ('created','retry') AND start_after <= now())::text AS ready_jobs,
      min(start_after) FILTER (WHERE state IN ('created','retry') AND start_after <= now()) AS oldest_ready_at,
      EXTRACT(EPOCH FROM now() - min(start_after) FILTER
        (WHERE state IN ('created','retry') AND start_after <= now()))::double precision AS oldest_ready_age_seconds
    FROM pgboss.job GROUP BY name,state ORDER BY name,state
  `)).rows;
  await client.query('COMMIT');
  console.log(JSON.stringify({ captured_at: new Date().toISOString(), database: new URL(connectionString).pathname.slice(1), read_only: true, queues }, null, 2));
} catch {
  console.error('Queue inspection failed. Check the explicit QUEUE_STATUS_DATABASE_URL, connectivity, permissions and queue schema. No queue status was established.');
  process.exitCode = 1;
} finally {
  await client?.end().catch(() => { process.exitCode = 1; });
}
