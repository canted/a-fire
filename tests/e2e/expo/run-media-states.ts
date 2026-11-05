import { spawn } from 'node:child_process';
import { seedExpoRichContent } from '../fixtures/expoRichContent';
import { prisma } from '../fixtures/database';

const [platform, device] = process.argv.slice(2);
if (!['ios', 'android'].includes(platform) || !device) throw new Error('Usage: run-media-states.ts ios|android DEVICE_ID');
const fixture = await seedExpoRichContent();
const originalAudio = await prisma.audioAsset.findUniqueOrThrow({ where: { id: fixture.audioId } });
const originalVideo = await prisma.videoAsset.findUniqueOrThrow({ where: { id: fixture.videoId } });
try {
  for (const state of ['processing', 'failed'] as const) {
    await prisma.$transaction([
      prisma.audioAsset.update({ where: { id: fixture.audioId }, data: { processing_status: state } }),
      prisma.videoAsset.update({ where: { id: fixture.videoId }, data: { processing_status: state } }),
    ]);
    await new Promise<void>((done, reject) => {
      const child = spawn(process.env.MAESTRO_BIN || 'maestro', ['--device', device, 'test', '--test-output-dir', `/tmp/afire-media-states-${platform}/${state}`,
        '-e', `ROOM_LINK=afire-local-https:///app/rooms/${fixture.roomId}/chat`,
        '-e', `AUDIO_STATE=${state === 'processing' ? 'Processing audio…' : 'This audio could not be processed.'}`,
        '-e', `VIDEO_STATE=${state === 'processing' ? 'Processing video…' : 'This video could not be processed.'}`,
        'tests/e2e/expo/https-media-state.yaml'], { stdio: 'inherit', env: { ...process.env, MAESTRO_CLI_NO_ANALYTICS: '1' } });
      child.once('error', reject);
      child.once('exit', code => code === 0 ? done() : reject(new Error(`${platform} ${state} failed (${code})`)));
    });
  }
  console.log(`PASS ${platform}: processing and failed media states`);
} finally {
  await prisma.$transaction([
    prisma.audioAsset.update({ where: { id: fixture.audioId }, data: { processing_status: originalAudio.processing_status } }),
    prisma.videoAsset.update({ where: { id: fixture.videoId }, data: { processing_status: originalVideo.processing_status } }),
  ]);
  await prisma.$disconnect();
}
