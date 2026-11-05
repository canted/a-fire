#!/usr/bin/env node
// Private row values stay inside PostgreSQL; only counts and aggregate hashes leave it.
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
const require = createRequire(import.meta.url);
const { Client } = createRequire(require.resolve('pg-boss'))('pg');
const connectionString = process.env.MANIFEST_DATABASE_URL;
if (!connectionString) throw new Error('Set MANIFEST_DATABASE_URL explicitly; no application database default is used.');
const quote = value => '"' + value.replaceAll('"', '""') + '"';
const client = new Client({ connectionString, application_name: 'database-content-manifest' });
try {
  await client.connect();
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  await client.query("SET LOCAL statement_timeout = '60s'");
  await client.query("SET LOCAL row_security = off");
  await client.query("SET LOCAL TIME ZONE 'UTC'");
  await client.query("SET LOCAL DateStyle = 'ISO, YMD'");
  await client.query("SET LOCAL extra_float_digits = 3");
  const relations = (await client.query(`SELECT n.nspname AS schema, c.relname AS name, c.relkind AS kind
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%'
      AND n.nspname NOT LIKE 'pg_temp_%' AND c.relkind IN ('r','m','S')
    ORDER BY n.nspname,c.relname`)).rows;
  const tables = [], sequences = [];
  for (const relation of relations) {
    const target = `${quote(relation.schema)}.${quote(relation.name)}`;
    if (relation.kind === 'S') {
      const value = (await client.query(`SELECT last_value::text, is_called FROM ${target}`)).rows[0];
      sequences.push({ schema: relation.schema, name: relation.name, ...value });
      continue;
    }
    // ONLY avoids counting inherited/partitioned rows twice. Every physical table
    // is independently included. Sort digests, retaining duplicates and null fields.
    await client.query(`DECLARE manifest_rows NO SCROLL CURSOR FOR SELECT md5(to_jsonb(t)::text) AS digest FROM ONLY ${target} t ORDER BY md5(to_jsonb(t)::text) COLLATE "C"`);
    const hash = createHash('sha256');
    let count = 0n;
    while (true) {
      const batch = (await client.query('FETCH FORWARD 500 FROM manifest_rows')).rows;
      if (!batch.length) break;
      for (const row of batch) hash.update(row.digest + '\n');
      count += BigInt(batch.length);
    }
    await client.query('CLOSE manifest_rows');
    tables.push({ schema: relation.schema, name: relation.name, kind: relation.kind, rows: String(count), digest: hash.digest('hex') });
  }
  await client.query('COMMIT');
  console.log(JSON.stringify({ version: 1, algorithm: 'sha256(sorted-md5-jsonb-rows)', read_only: true, tables, sequences }, null, 2));
} finally {
  await client.end();
}
