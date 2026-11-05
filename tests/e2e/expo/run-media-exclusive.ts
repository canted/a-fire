import { spawn } from 'node:child_process';
import { seedExpoRichContent } from '../fixtures/expoRichContent';
import { prisma } from '../fixtures/database';

const [platform, device] = process.argv.slice(2);
if (!['ios', 'android'].includes(platform) || !device) throw new Error('Usage: run-media-exclusive.ts ios|android DEVICE_ID');
const fixture = await seedExpoRichContent(30);
async function flow(name: string) {
  await new Promise<void>((done, reject) => {
    const child = spawn(process.env.MAESTRO_BIN || 'maestro', ['--device', device, 'test', '--test-output-dir', `/tmp/afire-media-exclusive-${platform}/${name}`, '-e', `ROOM_LINK=afire-local-https:///app/rooms/${fixture.roomId}/chat`, `tests/e2e/expo/${name}.yaml`], { stdio: 'inherit', env: { ...process.env, MAESTRO_CLI_NO_ANALYTICS: '1', MAESTRO_CLI_ANALYSIS_NOTIFICATION_DISABLED: 'true' } });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? done() : reject(new Error(`${platform} ${name} failed (${code})`)));
  });
}
try {
  await flow('https-media-exclusive');
  console.log(`PASS ${platform}: video pauses audio`);
} finally {
  await seedExpoRichContent();
  await prisma.$disconnect();
}
