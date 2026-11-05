import { createUserCommunityFixture } from './factory';
import { prisma } from './database';

/** Additive, authorized entry with several reply pages. */
export async function seedExpoReplyTargets() {
  const fixture = await createUserCommunityFixture({ email: 'expo-web-benchmark@example.test', username: 'web benchmark', roomName: `Expo reply targets ${Date.now()}`, skipEmailCleanup: true });
  const now = new Date();
  for (const platform of ['ios', 'android']) {
    const user = await prisma.user.findFirstOrThrow({ where: { email: `expo-${platform}-benchmark@example.test` } });
    await prisma.roomMembership.create({ data: { room_id: fixture.roomId, user_id: user.id, disabled: false, notify: false, created_at: now, updated_at: now } });
  }
  const post = await prisma.entry.create({ data: { user_id: fixture.userId, room_id: fixture.roomId, status: 'published', creation_origin: 'circle_entry', format: 'mixed_media', published_at: now, created_at: now, updated_at: now } });
  const document = (text: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });
  await prisma.document.create({ data: { docable_type: 'Post', docable_id: post.id, content: document('Synthetic reply target source.'), version: 1, created_at: now, updated_at: now } });
  const replies = [];
  for (let index = 1; index <= 80; index++) {
    const date = new Date(now.getTime() + index * 1000);
    const reply = await prisma.reply.create({ data: { entry_id: post.id, user_id: fixture.userId, status: 'published', published_at: date, created_at: date, updated_at: date } });
    await prisma.document.create({ data: { docable_type: 'Reply', docable_id: reply.id, content: document(`Reply target ${index}: synthetic pagination and reveal check.`), version: 1, created_at: date, updated_at: date } });
    replies.push(reply.id);
  }
  return { room: fixture.roomId, entry: post.id, target: replies[69], first: replies[0], last: replies[79] };
}
