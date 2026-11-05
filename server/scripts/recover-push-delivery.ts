// Never loads dotenv or falls back to ambient credentials.
import 'reflect-metadata';
import { parseArgs } from 'node:util';
import { PrismaClient } from '@prisma/client';
import { BossService } from '../queue/boss.service';
import { recoverPushDelivery } from '../notifications/recover-push-delivery';
let database: PrismaClient | undefined, queue: BossService | undefined;
try {
  const { values } = parseArgs({ options: { database: { type: 'string' }, 'delivery-id': { type: 'string' }, before: { type: 'string' }, execute: { type: 'boolean', default: false }, 'worker-stopped': { type: 'boolean', default: false } } });
  const connection = process.env.PUSH_RECOVERY_DATABASE_URL;
  if (!connection || !values.database || !/^\d+$/.test(values['delivery-id'] ?? '') || !values.before) throw Error('Explicit target required');
  const target = new URL(connection);
  if (!['postgres:', 'postgresql:'].includes(target.protocol) || decodeURIComponent(target.pathname.slice(1)) !== values.database) throw Error('Target mismatch');
  const deliveryId = Number(values['delivery-id']), before = new Date(values.before);
  if (!Number.isSafeInteger(deliveryId) || deliveryId < 1 || deliveryId > 2147483647 || !Number.isFinite(before.getTime())) throw Error('Invalid range');
  process.env.DATABASE_URL = connection;
  database = new PrismaClient({ datasources: { db: { url: connection } }, log: [] });
  queue = new BossService();
  if (values.execute) await queue.start();
  const result = await recoverPushDelivery(database, queue, deliveryId, before, values.execute, {workerStopped:values['worker-stopped']});
  process.stdout.write(JSON.stringify({ event: 'push_delivery_recovery', deliveryId, dry_run: !values.execute, ...result }) + "\n");
  if (!['eligible', 'enqueued'].includes(result.outcome)) process.exitCode = 2;
} catch {
  console.error('Push recovery did not complete. Verify the explicit target, delivery, cutoff and queue schema. Reinspect before retrying; no delivery guarantee established.');
  process.exitCode = 1;
} finally {
  try { await queue?.onModuleDestroy(); } finally { await database?.$disconnect(); }
}
