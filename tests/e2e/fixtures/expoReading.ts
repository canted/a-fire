import { createUserCommunityFixture, ensureUser } from './factory';
import { prisma } from './database';

/** Dedicated, additive reading fixture; normal databases are rejected by database.ts. */
export async function seedExpoReading(count = 180, communityName = 'Expo reading parity') {
  const fixture = await createUserCommunityFixture({ email: 'expo-pilot@example.test', username: 'Expo Pilot', roomName: communityName, skipEmailCleanup: true });
  const author = await ensureUser('expo-reader-peer@example.test', 'Reading peer');
  const now = new Date();
  if (!await prisma.roomMembership.findFirst({ where: { room_id: fixture.roomId, user_id: author } })) {
    await prisma.roomMembership.create({ data: { room_id: fixture.roomId, user_id: author, created_at: now, updated_at: now } });
  }
  for (let index = 1; index <= count; index++) {
    await prisma.chatMessage.upsert({ where: { author_id_client_nonce: { author_id: author, client_nonce: `expo-reading-${fixture.roomId}-${index}` } }, update: {}, create: {
      room_id: fixture.roomId, author_id: author, client_nonce: `expo-reading-${fixture.roomId}-${index}`,
      body: `Reading ${index}: ${index % 7 === 0 ? 'A longer observation about the work in progress. '.repeat(5) : 'A short creative update.'}`,
      masked_alias: 'Reading member', fire_at: new Date(+now + 7 * 86400000), expires_at: new Date(+now + 14 * 86400000), created_at: new Date(+now + index), updated_at: now,
    } });
  }
  const messages = await prisma.chatMessage.findMany({ where: { room_id: fixture.roomId }, orderBy: { id: 'asc' }, select: { id: true, body: true } });
  for (const message of messages.slice(99, 101)) {
    const target_path = `/app/rooms/${fixture.roomId}/chat#chat-${message.id}`;
    if (await prisma.notificationEvent.findFirst({ where: { target_path, event_type: 'chat_message_created' } })) continue;
    await prisma.notificationEvent.create({ data: {
      event_type: 'chat_message_created', actor_id: author, room_id: fixture.roomId,
      payload: { chat_message_id: message.id }, target_path, created_at: now, updated_at: now,
      inbox_items: { create: { user_id: fixture.userId, created_at: now, updated_at: now } },
    } });
  }
  return { roomId: fixture.roomId, viewer: fixture.userId, author, first: messages[0], target: messages[19], last: messages.at(-1), count: messages.length };
}
