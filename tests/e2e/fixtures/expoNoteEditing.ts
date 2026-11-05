import { prisma } from './database';
import { encodeTiptapContentAsYdocState } from '../../../server/realtime/hocuspocus.service';
import type { Prisma } from '@prisma/client';
import type { TiptapDoc } from '../../../frontend/src/lib/tiptap';

/** Owner-only confirmation fixtures and a shared video Note, all synthetic. */
export async function seedExpoNoteControlParity() {
  const make = async (roomId: number, title: string, content: TiptapDoc) => {
    const existing = await prisma.page.findFirst({ where: { room_id: roomId, title } });
    if (existing) return existing.id;
    const now = new Date();
    const page = await prisma.page.create({ data: { title, room_id: roomId, created_at: now, updated_at: now } });
    await prisma.document.create({ data: { docable_type: 'Note', docable_id: page.id, content: content as Prisma.InputJsonValue, ydoc_state: encodeTiptapContentAsYdocState(content), version: 1, created_at: now, updated_at: now } });
    return page.id;
  };
  const notes: Record<string, number> = {};
  for (const platform of ['ios', 'android'] as const) {
    const owner = await prisma.user.findFirstOrThrow({ where: { email: `expo-${platform}-benchmark@example.test` } });
    const room = await prisma.room.findFirstOrThrow({ where: { owner_id: owner.id, name: { startsWith: `Expo ${platform} management` } } });
    notes[platform] = await make(room.id, `Expo ${platform} confirmation parity`, { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Synthetic Note retained after cancelling deletion.' }] }] });
  }
  const room = await prisma.room.findFirstOrThrow({ where: { id: 2859, name: 'Expo Wall parity' } });
  const video = await prisma.videoAsset.findFirstOrThrow({ where: { title: 'Synthetic video study', original_filename: 'study.mp4', processing_status: 'ready' } });
  notes.video = await make(room.id, 'Expo inline video parity', { type: 'doc', content: [{ type: 'video', attrs: { videoAssetId: video.id, title: video.title } }] });
  return notes;
}

/** Additive Notes in the established synthetic Room; never mutate a user Note. */
export async function seedExpoNoteEditing(baseNoteId: number, platform: 'ios' | 'android' | 'web') {
  const base = await prisma.page.findUniqueOrThrow({ where: { id: baseNoteId } });
  if (base.title !== 'Expo destination persistence' || !base.room_id) throw new Error('Expected the synthetic destination fixture');
  const audio = await prisma.audioAsset.findFirstOrThrow({ where: { title: 'Synthetic audio study', original_filename: 'tone.wav', processing_status: 'ready' } });
  const stamp = Date.now();
  const make = async (name: string, content: TiptapDoc) => {
    const now = new Date();
    const page = await prisma.page.create({ data: { title: `Expo ${platform} ${name} ${stamp}`, room_id: base.room_id, created_at: now, updated_at: now } });
    await prisma.document.create({ data: { docable_type: 'Note', docable_id: page.id, content: content as Prisma.InputJsonValue, ydoc_state: encodeTiptapContentAsYdocState(content), version: 1, created_at: now, updated_at: now } });
    return { id: page.id, title: page.title };
  };
  const body = `Synthetic ${platform} block transfer.`;
  const source = await make('move source', { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: body }] }] });
  const target = await make('move target', { type: 'doc', content: [{ type: 'paragraph' }] });
  const note = await make('audio reply', { type: 'doc', content: [{ type: 'audio', attrs: { audioAssetId: audio.id, nodeId: `fixture-audio-${platform}`, title: audio.title } }] });
  return { source, target, body, note, audio: audio.id, audioNode: `fixture-audio-${platform}` };
}

/** Shared, disposable inline-media comparison fixture for all three clients. */
export async function seedExpoInlineMedia() {
  const room = await prisma.room.findFirstOrThrow({ where: { id: 2859, name: 'Expo Wall parity' } });
  const existing = await prisma.page.findFirst({ where: { room_id: room.id, title: 'Expo inline media parity' } });
  if (existing) return { id: existing.id, title: existing.title };
  const image = await prisma.activeStorageBlob.findFirstOrThrow({ where: { key: 'expo-rich-fixture/study.png', content_type: 'image/png' } });
  const audio = await prisma.audioAsset.findFirstOrThrow({ where: { title: 'Synthetic audio study', original_filename: 'tone.wav', processing_status: 'ready' } });
  const now = new Date();
  const page = await prisma.page.create({ data: { title: 'Expo inline media parity', room_id: room.id, created_at: now, updated_at: now } });
  const content: TiptapDoc = { type: 'doc', content: [
    { type: 'paragraph', content: [{ type: 'text', text: 'Synthetic inline image and audio comparison.' }] },
    { type: 'image', attrs: { src: `/api/v1/uploads/${image.id}`, alt: 'Synthetic inline image', width: 512, height: 512 } },
    { type: 'audio', attrs: { audioAssetId: audio.id, nodeId: 'inline-media-audio', title: audio.title } },
  ] };
  await prisma.document.create({ data: { docable_type: 'Note', docable_id: page.id, content: content as Prisma.InputJsonValue, ydoc_state: encodeTiptapContentAsYdocState(content), version: 1, created_at: now, updated_at: now } });
  return { id: page.id, title: page.title };
}
