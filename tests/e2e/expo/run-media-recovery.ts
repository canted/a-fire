import { spawn } from 'node:child_process';
import { seedExpoRichContent } from '../fixtures/expoRichContent';
import { prisma } from '../fixtures/database';

const [platform, device] = process.argv.slice(2);
if (!['ios', 'android'].includes(platform) || !device) throw new Error('Usage: run-media-recovery.ts ios|android DEVICE_ID');
const fixture = await seedExpoRichContent();
const assets = await Promise.all([
  prisma.audioAsset.findUniqueOrThrow({ where: { id: fixture.audioId } }),
  prisma.videoAsset.findUniqueOrThrow({ where: { id: fixture.videoId } }),
]);
const blobs = await prisma.activeStorageBlob.findMany({ where: { id: { in: assets.map(asset => asset.blob_id) } } });
async function flow(name: string) {
  await new Promise<void>((done, reject) => {
    const child = spawn(process.env.MAESTRO_BIN || 'maestro', ['--device', device, 'test', '--test-output-dir', `/tmp/afire-media-recovery-${platform}/${name}`, '-e', `ROOM_LINK=afire-local-https:///app/rooms/${fixture.roomId}/chat`, `tests/e2e/expo/${name}.yaml`], { stdio: 'inherit', env: { ...process.env, MAESTRO_CLI_NO_ANALYTICS: '1', MAESTRO_CLI_ANALYSIS_NOTIFICATION_DISABLED: 'true' } });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? done() : reject(new Error(`${platform} ${name} failed (${code})`)));
  });
}
async function restore() {
  await prisma.$transaction(blobs.map(blob => prisma.activeStorageBlob.update({ where: { id: blob.id }, data: { key: blob.key } })));
}
try {
  await prisma.$transaction(blobs.map(blob => prisma.activeStorageBlob.update({ where: { id: blob.id }, data: { key: `${blob.key}-missing-recovery-test` } })));
  await flow('https-media-bytes-missing');
  await restore();
  await flow('https-media-bytes-restored');
  console.log(`PASS ${platform}: unavailable media bytes recover through Retry without navigating`);
} finally {
  await restore();
  await prisma.$disconnect();
}
