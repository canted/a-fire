import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

// Explicit immutable local images only. No host env files, mounts or exposed ports.
const [image, ...extra] = process.argv.slice(2);
if (!/^sha256:[a-f0-9]{64}$/.test(image ?? '') || extra.length) {
  throw Error('Usage: node bin/check-worker-container.mjs sha256:<local image ID>');
}
const postgres = 'postgres@sha256:1beaa3084eee2676f20a9cd9928f0bf2c5bf674f8e49f81017912183d377c61c';
const prefix = `afire-worker-check-${randomUUID()}`;
const network = `${prefix}-network`, database = `${prefix}-db`, worker = `${prefix}-worker`, migration = `${prefix}-migration`;
const databaseName = 'afire_worker_rehearsal_test';
const url = `postgresql://rehearsal:rehearsal@${database}:5432/${databaseName}`;
const docker = (args, timeout = 60_000) => execFileSync('docker', args, { encoding: 'utf8', timeout, maxBuffer: 4 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const sql = query => docker(['exec', database, 'psql', '-v', 'ON_ERROR_STOP=1', '-U', 'rehearsal', '-d', databaseName, '-Atc', query]);
const assert = (condition, message) => { if (!condition) throw Error(message); };
const until = async (check, message, milliseconds = 30_000) => {
  const end = Date.now() + milliseconds;
  do { if (check()) return; await delay(500); } while (Date.now() < end);
  throw Error(message);
};
const state = () => JSON.parse(docker(['inspect', '--format', '{{json .State}}', worker]));
const report = { observedAt: new Date().toISOString(), image, postgres, isolated: true };
let failure;
try {
  docker(['image', 'inspect', image]);
  docker(['image', 'inspect', postgres]);
  docker(['network', 'create', '--internal', network]);
  docker(['run', '--pull', 'never', '-d', '--name', database, '--network', network,
    '-e', 'POSTGRES_USER=rehearsal', '-e', 'POSTGRES_PASSWORD=rehearsal', '-e', `POSTGRES_DB=${databaseName}`, postgres]);
  await until(() => { try { docker(['exec', database, 'pg_isready', '-U', 'rehearsal', '-d', databaseName]); return true; } catch { return false; } }, 'Database readiness timeout');
  console.error('Isolated database ready; applying release migrations and backfills.');
  docker(['run', '--pull', 'never', '--rm', '--name', migration, '--platform', 'linux/amd64', '--network', network,
    '-e', `DATABASE_URL=${url}`, '--entrypoint', 'node', image, 'dist/server/scripts/migrate.js']);
  report.migrationsApplied = Number(sql('SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL'));
  assert(report.migrationsApplied > 0, 'No successful migrations');
  assert(sql('SELECT count(*) FROM notification_push_device_attempts') === '0', 'Fresh database lacks an empty push journal');
  const recoveryArgs = ['dist/server/scripts/recover-push-delivery.js', '--database', databaseName,
    '--delivery-id', '2147483647', '--before', new Date().toISOString()];
  const recovery = explicit => {
    try {
      return { status: 0, output: docker(['run', '--pull', 'never', '--rm', '--name', migration,
        '--platform', 'linux/amd64', '--network', network, '-e', `DATABASE_URL=${url}`,
        ...(explicit ? ['-e', `PUSH_RECOVERY_DATABASE_URL=${url}`] : []),
        '--entrypoint', 'node', image, ...recoveryArgs]) };
    } catch (error) { return { status: error.status, output: String(error.stdout ?? '') }; }
  };
  assert(recovery(false).status === 1, 'Recovery accepted an ambient database target');
  const preview = recovery(true);
  assert(preview.status === 2, 'Recovery preview returned unexpected status');
  const previewResult = JSON.parse(preview.output);
  assert(previewResult.dry_run === true && previewResult.outcome === 'not_found', 'Recovery preview failed');
  report.recoveryPreviewVerified = true;

  const roundRepair = explicit => {
    try {
      return { status: 0, output: docker(['run', '--pull', 'never', '--rm', '--name', migration,
        '--platform', 'linux/amd64', '--network', network, '-e', `DATABASE_URL=${url}`,
        ...(explicit ? ['-e', `ROUND_REPAIR_DATABASE_URL=${url}`] : []),
        '--entrypoint', 'node', image, 'dist/server/scripts/repair-round-results.js',
        '--database', databaseName, '--room', '2147483647']) };
    } catch (error) { return { status: error.status, output: String(error.stdout ?? '') }; }
  };
  assert(roundRepair(false).status === 1, 'Round repair accepted an ambient database target');
  const roundPreview = roundRepair(true);
  assert(roundPreview.status === 0, 'Packaged Round repair preview failed');
  const roundResult = JSON.parse(roundPreview.output);
  assert(roundResult.dryRun === true && roundResult.inspected === 0
    && roundResult.candidates.length === 0 && roundResult.repaired.length === 0,
  'Round repair preview changed or selected unexpected history');
  report.roundRepairPreviewVerified = true;

  docker(['run', '--pull', 'never', '-d', '--name', worker, '--platform', 'linux/amd64', '--network', network,
    '--memory', '256m', '--cpus', '1', '-e', `DATABASE_URL=${url}`, '--entrypoint', 'node', image, 'dist/server/scripts/worker.js']);
  await until(() => {
    assert(state().Running, 'Worker exited before readiness');
    return sql('SELECT count(*) FROM queue_worker_heartbeats') === '1';
  }, 'Worker lease missing');
  const firstLease = sql('SELECT seen_at FROM queue_worker_heartbeats');
  report.queuesRegistered = Number(sql('SELECT count(*) FROM pgboss.queue'));
  // This retired handler intentionally does nothing; it still proves actual polling.
  const jobId = docker(['exec', worker, 'node', '--input-type=module', '-e',
    'import PgBoss from "pg-boss"; const boss=new PgBoss(process.env.DATABASE_URL); await boss.start(); console.log(await boss.send("chat.expire",{messageId:2147483647})); await boss.stop();']);
  assert(/^[a-f0-9-]{36}$/.test(jobId), 'Unexpected job identity');
  await until(() => sql(`SELECT state FROM pgboss.job WHERE id='${jobId}'`) === 'completed', 'Worker did not complete test job');
  await until(() => sql('SELECT seen_at FROM queue_worker_heartbeats') !== firstLease, 'Worker lease did not renew');
  console.error('Worker processed a job and renewed its lease; checking shutdown.');
  const started = performance.now();
  docker(['stop', '--time', '45', worker]);
  const stopped = state();
  report.shutdownSeconds = Number(((performance.now() - started) / 1000).toFixed(3));
  assert(!stopped.Running && stopped.ExitCode === 0 && !stopped.OOMKilled, 'Worker failed graceful container shutdown');
  assert(sql('SELECT count(*) FROM queue_worker_heartbeats') === '0', 'Shutdown retained a worker lease');
  Object.assign(report, { jobCompleted: true, leaseRenewed: true, shutdownExitCode: stopped.ExitCode, leaseWithdrawn: true });
} catch (error) {
  failure = error;
} finally {
  const cleanupErrors = [];
  for (const name of [migration, worker, database]) {
    // Only names generated by this invocation are ever removed.
    try { docker(['container', 'inspect', name]); } catch (error) {
      if (!/No such (object|container)/i.test(String(error.stderr))) cleanupErrors.push(name);
      continue;
    }
    try { docker(['rm', '-f', '-v', name]); } catch { cleanupErrors.push(name); }
  }
  try { docker(['network', 'inspect', network]); docker(['network', 'rm', network]); }
  catch (error) { if (!/No such network|network .* not found/i.test(String(error.stderr))) cleanupErrors.push(network); }
  report.cleanupComplete = cleanupErrors.length === 0;
  if (cleanupErrors.length) { console.error('Manual cleanup required:', cleanupErrors.join(', ')); failure ??= Error('Cleanup incomplete'); }
}
if (failure) { console.error(failure.message); process.exitCode = 1; }
else console.log(JSON.stringify(report, null, 2));
