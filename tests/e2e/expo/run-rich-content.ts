import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { seedExpoRichContent } from '../fixtures/expoRichContent';
import { prisma } from '../fixtures/database';

const [platform, device] = process.argv.slice(2);
if (!['ios', 'android'].includes(platform) || !device) throw new Error('Usage: run-rich-content.ts ios|android DEVICE_ID');
// Reuse the real sign-in from run-local-https.ts benchmark.
try {
  const fixture = await seedExpoRichContent();
  const evidence = resolve(process.env.EXPO_NATIVE_EVIDENCE || `/tmp/afire-rich-content-${platform}`);
  for (const flow of ['https-rich-content', 'https-media-position', 'https-rich-reading']) {
  await new Promise<void>((done, reject) => {
    const child = spawn(process.env.MAESTRO_BIN || 'maestro', ['--device', device, 'test', '--test-output-dir', resolve(evidence, flow), '-e', `ROOM_BASE=afire-local-https:///app/rooms/${fixture.roomId}/chat`, '-e', `ROOM_LINK=afire-local-https:///app/rooms/${fixture.roomId}/chat?message=${fixture.richMessage}`, `tests/e2e/expo/${flow}.yaml`], {
      stdio: 'inherit', env: { ...process.env, MAESTRO_CLI_NO_ANALYTICS: '1', MAESTRO_CLI_ANALYSIS_NOTIFICATION_DISABLED: 'true' },
    });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? done() : reject(new Error(`Rich content ${platform} failed (${code})`)));
  });
  }
  console.log(`PASS ${platform}: rich text, authenticated audio, timestamp activation and playback-position restoration; evidence ${evidence}`);
} finally { await prisma.$disconnect(); }
