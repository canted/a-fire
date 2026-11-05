import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { prisma } from './database';
import { seedExpoReading } from './expoReading';
import { ensureUser } from './factory';
import { StorageService } from '../../../server/storage/storage.service';
import type { Prisma } from '@prisma/client';

/** Mixed-content fixtures use real authorized media endpoints in the guarded test DB. */
export async function seedExpoRichContent(videoSeconds = 5, historyCount = 30) {
  if (![5, 30].includes(videoSeconds)) throw new Error("Unsupported synthetic video duration");
  if (![30, 2000].includes(historyCount)) throw new Error('Unsupported synthetic history size');
  const fixture = await seedExpoReading(historyCount, historyCount === 30 ? 'Expo rich content' : `Expo rich content ${historyCount}`);
  const now = new Date();
  for (const platform of ['web', 'ios', 'android']) {
    const user = await prisma.user.findFirstOrThrow({ where: { email: `expo-${platform}-benchmark@example.test` } });
    if (!await prisma.roomMembership.findFirst({ where: { room_id: fixture.roomId, user_id: user.id } })) {
      await prisma.roomMembership.create({ data: { room_id: fixture.roomId, user_id: user.id, created_at: now, updated_at: now } });
    }
    if (historyCount === 2000) {
      // Home only exposes three Rooms. Keep stress navigation independent of
      // unrelated functional fixtures without changing their memberships.
      const viewer = await ensureUser(`expo-${platform}-rich-performance@example.test`, `${platform} rich performance`);
      if (!await prisma.roomMembership.findFirst({ where: { room_id: fixture.roomId, user_id: viewer } })) {
        await prisma.roomMembership.create({ data: { room_id: fixture.roomId, user_id: viewer, created_at: now, updated_at: now } });
      }
    }
  }
  const storage = new StorageService();
  const row = await prisma.chatMessage.findUniqueOrThrow({ where: { author_id_client_nonce: { author_id: fixture.author, client_nonce: `expo-reading-${fixture.roomId}-${historyCount}` } } });
  const blob = async (name: string, type: string, bytes: Buffer) => {
    const key = historyCount === 30 ? `expo-rich-fixture/${name}` : `expo-rich-fixture/${fixture.roomId}/${name}`;
    await storage.put(key, bytes, type);
    let result = await prisma.activeStorageBlob.findFirst({ where: { key } });
    if (!result) result = await prisma.activeStorageBlob.create({ data: { key, filename: name, content_type: type, service_name: 'local', byte_size: bytes.length, checksum: createHash('md5').update(bytes).digest('base64'), created_at: now } });
    else result = await prisma.activeStorageBlob.update({ where: { id: result.id }, data: { byte_size: bytes.length, checksum: createHash('md5').update(bytes).digest('base64') } });
    if (!await prisma.activeStorageAttachment.findFirst({ where: { blob_id: result.id, record_type: 'ChatMessage', record_id: row.id } })) await prisma.activeStorageAttachment.create({ data: { blob_id: result.id, record_type: 'ChatMessage', record_id: row.id, name: 'files', created_at: now } });
    return result;
  };
  const image = await blob('study.png', 'image/png', await readFile('public/icons/icon-512.png'));
  const file = await blob('study.txt', 'text/plain', Buffer.from('Synthetic Chat parity attachment.\n'));
  const samples = 8000 * 8, wav = Buffer.alloc(44 + samples * 2);
  wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) wav.writeInt16LE(Math.round(Math.sin(i * Math.PI * 2 * 220 / 8000) * 1500), 44 + i * 2);
  const audioBlob = await blob('tone.wav', 'audio/wav', wav);
  let audio = await prisma.audioAsset.findFirst({ where: { blob_id: audioBlob.id } });
  if (!audio) audio = await prisma.audioAsset.create({ data: { blob_id: audioBlob.id, owner_id: fixture.author, source_type: 'ChatMessage', source_id: row.id, title: 'Synthetic audio study', original_filename: 'tone.wav', original_mime_type: 'audio/wav', processing_status: 'ready', duration_ms: 8000, waveform_peaks: Array.from({ length: 80 }, (_, i) => 0.2 + Math.abs(Math.sin(i / 7)) * 0.6), created_at: now, updated_at: now } });
  const temporary = await mkdtemp(join(tmpdir(), 'afire-rich-video-'));
  let videoBytes: Buffer;
  try {
    const target = join(temporary, 'study.mp4');
    await promisify(execFile)('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=15', '-t', String(videoSeconds), '-pix_fmt', 'yuv420p', '-c:v', 'libx264', target, '-loglevel', 'error']);
    videoBytes = await readFile(target);
  } finally { await rm(temporary, { recursive: true, force: true }); }
  const videoBlob = await blob('study.mp4', 'video/mp4', videoBytes);
  let video = await prisma.videoAsset.findFirst({ where: { blob_id: videoBlob.id } });
  if (!video) video = await prisma.videoAsset.create({ data: { blob_id: videoBlob.id, owner_id: fixture.author, source_type: 'ChatMessage', source_id: row.id, title: 'Synthetic video study', original_filename: 'study.mp4', original_mime_type: 'video/mp4', processing_status: 'ready', duration_ms: videoSeconds * 1000, width: 320, height: 180, created_at: now, updated_at: now } });
  else video = await prisma.videoAsset.update({ where: { id: video.id }, data: { duration_ms: videoSeconds * 1000 } });
  const content = { type: 'doc', content: [
    { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Rich content study' }] },
    { type: 'paragraph', content: [{ type: 'text', text: 'Bold phrase', marks: [{ type: 'bold' }] }, { type: 'text', text: ', italic phrase', marks: [{ type: 'italic' }] }, { type: 'text', text: ' and ' }, { type: 'mention', attrs: { id: String(fixture.viewer), label: 'Expo Pilot', targetType: 'user' } }] },
    { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Keep the quiet space.' }] }] }] },
    { type: 'image', attrs: { src: `/api/v1/uploads/${image.id}`, alt: 'Synthetic image study', width: 512, height: 512 } },
    { type: 'audio', attrs: { audioAssetId: audio.id, title: audio.title, status: 'ready' } },
    { type: 'paragraph', content: [{ type: 'audioTimestamp', attrs: { audioAssetId: audio.id, title: 'Audio study', seconds: 3 } }] },
    { type: 'video', attrs: { videoAssetId: video.id, title: video.title, status: 'ready', width: 320, height: 180 } },
    { type: 'file', attrs: { src: `/api/v1/uploads/${file.id}`, filename: 'study.txt', size: file.byte_size, contentType: 'text/plain' } },
  ] };
  await prisma.chatMessage.update({ where: { id: row.id }, data: { body: 'Rich content study', content: content as Prisma.InputJsonValue } });
  if (row.entry_id) await prisma.document.updateMany({ where: { docable_type: 'Post', docable_id: row.entry_id }, data: { content: content as Prisma.InputJsonValue, updated_at: now } });
  // Seed the actual published reply contract, including legacy linkage before
  // the authorized history reader materializes an attachment Entry.
  for (const userId of [fixture.viewer, fixture.author]) {
    const existing = await prisma.reply.findFirst({ where: { user_id: userId, OR: [{ chat_message_id: row.id }, ...(row.entry_id ? [{ entry_id: row.entry_id }] : [])] } });
    if (!existing) {
      const reply = await prisma.reply.create({ data: { user_id: userId, entry_id: row.entry_id, chat_message_id: row.entry_id ? null : row.id, status: 'published', published_at: now, created_at: now, updated_at: now } });
      await prisma.document.create({ data: { docable_type: 'Reply', docable_id: reply.id, content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Synthetic response for Chat parity.' }] }] }, version: 1, created_at: now, updated_at: now } });
    }
  }
  storage.onModuleDestroy();
  return { ...fixture, richMessage: row.id, audioId: audio.id, videoId: video.id, imageId: image.id, fileId: file.id };
}
