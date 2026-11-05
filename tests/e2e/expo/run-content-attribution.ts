import { spawn } from 'node:child_process';
import { seedExpoRichContent } from '../fixtures/expoRichContent';
import { prisma } from '../fixtures/database';
import { Prisma } from '@prisma/client';

const [ios, android] = process.argv.slice(2);
if (!ios || !android) throw new Error('Usage: run-content-attribution.ts IOS_DEVICE ANDROID_DEVICE');
const fixture = await seedExpoRichContent();
const message = await prisma.chatMessage.findUniqueOrThrow({ where: { id: fixture.richMessage } });
if (!message.entry_id) throw new Error('Load the real rich-content Room once to materialize its Entry before this test.');
const post = await prisma.entry.findUniqueOrThrow({ where: { id: message.entry_id } });
async function flow(platform: string, device: string, expected: string) {
  await new Promise<void>((done, reject) => {
    const child = spawn(process.env.MAESTRO_BIN || 'maestro', ['--device', device, 'test', '--test-output-dir', `/tmp/afire-content-attribution-${platform}/${expected.startsWith('Cover') ? 'round' : 'responses'}`, '-e', `ROOM_LINK=afire-local-https:///app/rooms/${fixture.roomId}/chat?message=${fixture.richMessage}`, '-e', `EXPECTED_CONTENT=${expected}`, 'tests/e2e/expo/https-content-attribution.yaml'], { stdio: 'inherit', env: { ...process.env, MAESTRO_CLI_NO_ANALYTICS: '1', MAESTRO_CLI_ANALYSIS_NOTIFICATION_DISABLED: 'true' } });
    child.once('error', reject); child.once('exit', code => code === 0 ? done() : reject(new Error(`${platform} content attribution failed (${code})`)));
  });
}
try {
  for (const [platform, device] of [['ios', ios], ['android', android]]) await flow(platform, device, '2 responses. Open thread');
  await prisma.entry.update({ where: { id: post.id }, data: { format_data: { ...(post.format_data as Record<string, Prisma.InputJsonValue> || {}), round_attribution: { template_key: 'art_before_chorus', cover_contributor_name: 'Reading artist' } } } });
  for (const [platform, device] of [['ios', ios], ['android', android]]) await flow(platform, device, 'Cover art from Reading artist');
  console.log('PASS iOS/Android: response summaries and completed-Round contributor attribution');
} finally {
  // Fixture snapshots store a JSON object; preserve it without changing media.
  await prisma.entry.update({ where: { id: post.id }, data: { format_data: post.format_data === null ? Prisma.DbNull : post.format_data as Prisma.InputJsonValue } });
  await prisma.$disconnect();
}
