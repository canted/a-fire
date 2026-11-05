import { prisma } from './database';

/** Additive gallery entries in the isolated synthetic Room; no notifications. */
export async function seedExpoWallGallery() {
  const wall = await prisma.roundResult.findFirstOrThrow({ where: { title: 'Synthetic Room Wall', room: { name: 'Expo Wall parity' } }, include: { entries: { include: { entry: true } } } });
  const source = wall.entries.find(entry => entry.entry)?.entry;
  if (!source) throw new Error('Seed the synthetic Wall first.');
  const now = new Date();
  for (let position = 1; position < 8; position++) {
    if (wall.entries.some(entry => entry.position === position)) continue;
    const name = `Gallery contributor ${String(position + 1).padStart(2, '0')}`;
    const post = await prisma.entry.create({ data: { user_id: source.user_id, room_id: wall.room_id, status: 'published', format: 'mixed_media', created_at: now, updated_at: now, published_at: now, reply_mode: 'simple' } });
    await prisma.document.create({ data: { docable_type: 'Post', docable_id: post.id, created_at: now, updated_at: now, content: { type: 'doc', content: Array.from({ length: position % 2 ? 3 : 5 }, (_, line) => ({ type: 'paragraph', content: [{ type: 'text', text: `${name}, thought ${line + 1}. A synthetic contribution for paired gallery and return-position validation.` }] })) } } });
    await prisma.roundResultEntry.create({ data: { round_result_id: wall.id, entry_id: post.id, position, author_name: name } });
  }
  return { room: wall.room_id, wall: wall.id };
}
