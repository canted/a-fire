import 'reflect-metadata';
import { parseArgs } from 'node:util';
import { PrismaClient } from '@prisma/client';
import { repairRoundResults } from '../api/v1/rounds/repair-round-results';

// Explicit operator target only; never load dotenv or infer production credentials.
let database: PrismaClient | undefined;
try {
  const { values } = parseArgs({ options: { database: { type: 'string' }, room: { type: 'string' }, after: { type: 'string' }, through: { type: 'string' }, execute: { type: 'boolean', default: false } } });
  const connection = process.env.ROUND_REPAIR_DATABASE_URL;
  if (!connection || !values.database || !values.room) throw Error('Explicit target required');
  const target = new URL(connection);
  if (!['postgres:', 'postgresql:'].includes(target.protocol) || decodeURIComponent(target.pathname.slice(1)) !== values.database) throw Error('Target mismatch');
  const integer = (value: string) => { if (!/^\d+$/.test(value)) throw Error('Invalid identifier'); return Number(value); };
  const roomId = integer(values.room);
  database = new PrismaClient({ datasources: { db: { url: connection } }, log: [] });
  const result = await repairRoundResults(database, roomId, { after: values.after === undefined ? undefined : integer(values.after), through: values.through === undefined ? undefined : integer(values.through), execute: values.execute });
  process.stdout.write(JSON.stringify({ event: 'round_result_repair', roomId, dryRun: !values.execute, ...result }) + "\n");
} catch {
  console.error('Round result repair did not complete. Verify the explicit database, Room and continuation. Earlier batches may have committed; replay is safe.');
  process.exitCode = 1;
} finally { await database?.$disconnect(); }
