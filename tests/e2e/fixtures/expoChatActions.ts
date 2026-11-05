import { prisma } from './database';

/** Synthetic-only additions to the existing guarded rich-content fixture. */
export async function seedExpoChatActions() {
  const room = await prisma.room.findFirstOrThrow({ where: { name: 'Expo rich content' } });
  const original = await prisma.chatMessage.findFirstOrThrow({ where: { room_id: room.id, client_nonce: { startsWith: `expo-reading-${room.id}-` } }, orderBy: { id: 'asc' } });
  const now = new Date();
  const nonce = `expo-actions-thread-${room.id}`;
  const message = await prisma.chatMessage.upsert({ where: { author_id_client_nonce: { author_id: original.author_id, client_nonce: nonce } }, update: {}, create: {
    room_id: room.id, author_id: original.author_id, client_nonce: nonce, masked_alias: original.masked_alias, fire_at: new Date(now.getTime() + 86400000), expires_at: new Date(now.getTime() + 864000000), status: 'published', timeline_kind: 'message', body: 'Historical thread source for parity', content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Historical thread source for parity' }] }] }, created_at: now, updated_at: now,
  } });
  let reply = await prisma.reply.findFirst({ where: { chat_message_id: message.id, user_id: original.author_id } });
  if (!reply) {
    reply = await prisma.reply.create({ data: { chat_message_id: message.id, user_id: original.author_id, status: 'published', published_at: now, created_at: now, updated_at: now } });
    await prisma.document.create({ data: { docable_type: 'Reply', docable_id: reply.id, content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'An old reply remains readable.' }] }] }, version: 1, created_at: now, updated_at: now } });
  }
  let project = await prisma.project.findFirst({ where: { owner_id: original.author_id, name: 'Chat parity destination' } });
  if (!project) project = await prisma.project.create({ data: { owner_id: original.author_id, name: 'Chat parity destination', created_at: now, updated_at: now } });
  await prisma.projectRoom.upsert({ where: { project_id_room_id: { project_id: project.id, room_id: room.id } }, update: {}, create: { project_id: project.id, room_id: room.id, created_at: now } });
  for (const platform of ['web', 'ios', 'android']) {
    const user = await prisma.user.findFirstOrThrow({ where: { email: `expo-${platform}-benchmark@example.test` } });
    await prisma.projectParticipation.upsert({ where: { project_id_user_id: { project_id: project.id, user_id: user.id } }, update: { status: 'accepted' }, create: { project_id: project.id, user_id: user.id, invited_by_id: original.author_id, status: 'accepted', invited_at: now, responded_at: now, created_at: now, updated_at: now } });
  }
  return { room: room.id, message: message.id, reply: reply.id, project: project.id };
}
