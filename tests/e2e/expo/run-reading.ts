import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { seedExpoReading } from '../fixtures/expoReading';
import { prisma } from '../fixtures/database';

const [platform, device] = process.argv.slice(2);
if (!['ios', 'android'].includes(platform) || !device) throw new Error('Usage: tsx tests/e2e/expo/run-reading.ts ios|android DEVICE_ID');
const executable = process.env.MAESTRO_BIN || 'maestro';
const evidence = resolve(process.env.EXPO_NATIVE_EVIDENCE || `/tmp/afire-reading-${platform}-acceptance`);
const origin = platform === 'android' ? 'http://10.0.2.2:8082' : 'http://localhost:8082';
const parameters: Record<string, string> = {
  DEV_CLIENT_URL: `afire-preview://expo-development-client/?url=${encodeURIComponent(origin)}&disableFab=1&disableAutoLaunch=1`,
};
async function flow(name: string, extra: Record<string, string> = {}) {
  await new Promise<void>((resolveRun, reject) => {
    const args = Object.entries({ ...parameters, ...extra }).flatMap(([key, value]) => ['-e', `${key}=${value}`]);
    const child = spawn(executable, ['--device', device, 'test', '--test-output-dir', `${evidence}/${name}`, ...args, `tests/e2e/expo/${name}.yaml`], {
      stdio: 'inherit', env: { ...process.env, MAESTRO_CLI_NO_ANALYTICS: '1', MAESTRO_CLI_ANALYSIS_NOTIFICATION_DISABLED: 'true' },
    });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolveRun() : reject(new Error(`Maestro ${name} exited ${code}`)));
  });
}
try {
  await mkdir(evidence, { recursive: true });
  const fixture = await seedExpoReading();
  const roomLink = `afire-preview:///app/rooms/${fixture.roomId}/chat`;
  await flow('open-development');
  // Sign in with the pilot account first using run-native.ts; no auth bypass.
  await flow('reading', { ROOM_LINK: `${roomLink}?message=${fixture.target.id}`, LATEST_MESSAGE: fixture.last!.body });
  await flow('background', { ROOM_LINK: roomLink });
  const now = new Date();
  const body = `Foreground ${platform} ${Date.now()}`;
  const message = await prisma.chatMessage.create({ data: {
    room_id: fixture.roomId, author_id: fixture.author, body, masked_alias: 'Reading member',
    fire_at: new Date(+now + 86400000), expires_at: new Date(+now + 172800000), created_at: now, updated_at: now,
  } });
  await prisma.notificationEvent.create({ data: {
    event_type: 'chat_message_created', actor_id: fixture.author, room_id: fixture.roomId,
    payload: { chat_message_id: message.id }, target_path: `/app/rooms/${fixture.roomId}/chat#chat-${message.id}`,
    created_at: now, updated_at: now, inbox_items: { create: { user_id: fixture.viewer, created_at: now, updated_at: now } },
  } });
  await new Promise(resolveWait => setTimeout(resolveWait, 1000));
  const readCount = () => prisma.chatMessageRead.count({ where: { message_id: message.id, user_id: fixture.viewer } });
  if (await readCount()) throw new Error('Background message was incorrectly marked read. Keep other test clients away from the latest messages.');
  await flow('resume', { MESSAGE: body });
  for (let attempt = 0; attempt < 10 && !await readCount(); attempt++) await new Promise(resolveWait => setTimeout(resolveWait, 500));
  if (!await readCount()) throw new Error('Foreground exposure did not persist its read receipt.');
  console.log(`PASS ${platform}: linked history, return anchor, latest, foreground recovery, background unread and persisted exposure (${message.id}).`);
} finally { await prisma.$disconnect(); }
