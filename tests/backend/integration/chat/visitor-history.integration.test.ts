import { RoomsService } from "@server/api/v1/rooms/rooms.service";
import { NotificationInboxSerializer } from "@server/notifications/notification-inbox.serializer";
import { NotificationDeliveryService } from "@server/notifications/notification-delivery.service";
import { AudioAssetsService } from "@server/api/v1/audio-assets/audio-assets.service";
import { VideoAssetsService } from "@server/api/v1/video-assets/video-assets.service";
// @vitest-environment node
import "reflect-metadata";
import { expect, it } from "vitest";
import { UploadsService } from "@server/api/v1/uploads/uploads.service";
import { ChatService } from "@server/api/v2/rooms/chat.service";
import { RoomAccessService } from "@server/api/v1/rooms/room-access.service";
import { PrismaService } from "@server/prisma/prisma.service";
import { loadTestEnvironment } from "@server/runtime/test-environment.mjs";
import { loadEnv } from "@server/runtime/loadEnv";

it("applies current door history policy to listing, direct messages and receipts with real persistence", async () => {
  loadEnv();
  loadTestEnvironment({ requireDatabase: true });
  const prisma = new PrismaService();
  const now = new Date();
  const user = await prisma.user.create({ data: { email: `history-${crypto.randomUUID()}@example.com`, username: "History", created_at: now, updated_at: now } });
  const parent = await prisma.room.create({ data: { name: "Parent", porosity: "open", created_at: now, updated_at: now } });
  const room = await prisma.room.create({ data: { name: "History", parent_id: parent.id, porosity: "open", created_at: now, updated_at: now } });
  const access = new RoomAccessService();
  Object.assign(access, { prisma });
  const audio = new AudioAssetsService();
  const video = new VideoAssetsService();
  Object.assign(audio, { prisma, circleAccess: access });
  Object.assign(video, { prisma, circleAccess: access });
  const media = new UploadsService();
  Object.assign(media, { prisma, circleAccess: access });
  const blob = await prisma.activeStorageBlob.create({ data: { key: crypto.randomUUID(), filename: "chat.png", content_type: "image/png", service_name: "test", byte_size: 1, created_at: now } });
  const image = { type: "image", attrs: { src: `/api/v1/uploads/${blob.id}` } };
  const inbox = new NotificationInboxSerializer();
  Object.assign(inbox, { prisma, circleAccess: access });
  const readUnavailableNotice = (messageId: number) => inbox.serialize([{ id: 1, user_id: user.id, delivery_state: "delivered", notification_event: {
    id: 1, actor_id: user.id, room_id: room.id, created_at: now, event_type: "chat_message_created", payload: { chat_message_id: messageId, excerpt: "Retained snapshot" },
  } }]);
  const notifications = new NotificationDeliveryService();
  Object.assign(notifications, { prisma, circleAccess: access });
  const unavailableNotice = (messageId: number) => notifications.deliverImmediately(user.id, { event_type: "chat_message_created", payload: { chat_message_id: messageId, excerpt: "Retained snapshot" } } as never, { pushEnabled: true } as never);
  const communities = new RoomsService();
  Object.assign(communities, { prisma, circleAccess: access });
  const service = new ChatService();
  Object.assign(service, { prisma, circleAccess: access, rooms: communities });
  try {
    await prisma.roomMembership.create({ data: { room_id: parent.id, user_id: user.id, disabled: false, created_at: now, updated_at: now } });
    await access.visit(room.id, user.id);
    const ids: number[] = [];
    for (let index = 0; index < 15; index++) {
      const message = await prisma.chatMessage.create({ data: {
        room_id: room.id, author_id: user.id, body: `Message ${index}`, masked_alias: "",
        created_at: now, updated_at: now, fire_at: new Date(now.getTime() + 7 * 86400000), expires_at: new Date(now.getTime() + 14 * 86400000),
      } });
      ids.push(message.id);
    }
    // Leave both rows published: no cleanup worker has processed them.
    const expiredIds: number[] = [];
    for (const legacyPin of [false, true]) {
      const expired = await prisma.chatMessage.create({ data: {
        room_id: room.id, author_id: user.id, body: "Expired", masked_alias: "",
        created_at: legacyPin ? new Date(now.getTime() - 15 * 86400000) : now,
        updated_at: now, fire_at: now,
        expires_at: legacyPin ? new Date(now.getTime() + 86400000) : now,
        pinned_at: legacyPin ? now : null,
      } });
      expiredIds.push(expired.id);
      expect(await unavailableNotice(expired.id)).toMatchObject({ inboxItem: null });
      expect(await readUnavailableNotice(expired.id)).toEqual([]);
      await expect(service.message(room.id, expired.id, user.id)).rejects.toThrow("Message not found");
    }
    await service.markMessagesSeen(room.id, user.id, expiredIds);
    expect(await prisma.chatMessageRead.count({ where: { user_id: user.id } })).toBe(0);
    const assetData = { blob_id: blob.id, owner_id: user.id, source_type: "ChatMessage", source_id: ids[0], title: "Media", original_filename: "media", processing_status: "ready", created_at: now, updated_at: now };
    const audioAsset = await prisma.audioAsset.create({ data: assetData });
    const videoAsset = await prisma.videoAsset.create({ data: assetData });
    await expect(audio.getAudioAssetForUser(audioAsset.id, user.id)).resolves.toMatchObject({ id: audioAsset.id });
    await expect(video.getVideoAssetForUser(videoAsset.id, user.id)).resolves.toMatchObject({ id: videoAsset.id });
    await prisma.audioAsset.update({ where: { id: audioAsset.id }, data: { source_id: expiredIds[0] } });
    await prisma.videoAsset.update({ where: { id: videoAsset.id }, data: { source_id: expiredIds[0] } });
    await expect(audio.getAudioAssetForUser(audioAsset.id, user.id)).rejects.toThrow("Forbidden");
    await expect(video.getVideoAssetForUser(videoAsset.id, user.id)).rejects.toThrow("Forbidden");
    await prisma.audioAsset.update({ where: { id: audioAsset.id }, data: { source_id: ids[0] } });
    await prisma.videoAsset.update({ where: { id: videoAsset.id }, data: { source_id: ids[0] } });
    const attachment = await prisma.activeStorageAttachment.create({ data: { blob_id: blob.id, record_type: "ChatMessage", record_id: ids[0], name: "image", created_at: now } });
    await expect(media.assertContentMediaAccess(user.id, image, null)).resolves.toBeUndefined();
    await prisma.activeStorageAttachment.update({ where: { id: attachment.id }, data: { record_id: expiredIds[0] } });
    await expect(media.assertContentMediaAccess(user.id, image, null)).rejects.toThrow("Not Found");
    await prisma.activeStorageAttachment.update({ where: { id: attachment.id }, data: { record_id: ids[0] } });
    const open = await service.listMessages(room.id, user.id, { limit: 5 });
    expect(open.messages.map(row => row.id)).toEqual(ids.slice(-5));
    expect(open.viewer_access).toMatchObject({ kind: "visitor", history_limit: null, can_paginate: true });
    const older = await service.listMessages(room.id, user.id, { before: Number(open.next_cursor), limit: 5 });
    expect(older.messages.map(row => row.id)).toEqual(ids.slice(5, 10));
    expect((await service.message(room.id, ids[0], user.id)).id).toBe(ids[0]);
    await service.markMessagesSeen(room.id, user.id, [ids[0]]);
    expect(await prisma.chatMessageRead.count({ where: { user_id: user.id, message_id: ids[0] } })).toBe(1);
    await prisma.chatMessageRead.deleteMany({ where: { user_id: user.id } });

    await prisma.room.update({ where: { id: room.id }, data: { porosity: "masked" } });
    await expect(media.assertContentMediaAccess(user.id, image, null)).rejects.toThrow("Not Found");
    await prisma.activeStorageAttachment.update({ where: { id: attachment.id }, data: { record_id: ids[14] } });
    await expect(media.assertContentMediaAccess(user.id, image, null)).resolves.toBeUndefined();
    await expect(audio.getAudioAssetForUser(audioAsset.id, user.id)).rejects.toThrow("Forbidden");
    await expect(video.getVideoAssetForUser(videoAsset.id, user.id)).rejects.toThrow("Forbidden");
    expect(await unavailableNotice(ids[0])).toMatchObject({ inboxItem: null });
    expect(await readUnavailableNotice(ids[0])).toEqual([]);
    const limited = await service.listMessages(room.id, user.id, { before: ids[0], limit: 100 });
    expect(limited.messages.map(row => row.id)).toEqual(ids.slice(-10));
    expect(limited.viewer_access).toMatchObject({ history_limit: 10, can_paginate: false });
    expect(limited.present_user_ids).toEqual([]);
    await expect(service.message(room.id, ids[0], user.id)).rejects.toThrow("Message not found");
    await service.markMessagesSeen(room.id, user.id, [ids[0], ids[14]]);
    expect((await prisma.chatMessageRead.findMany({ where: { user_id: user.id } })).map(row => row.message_id)).toEqual([ids[14]]);
  } finally {
    await prisma.activeStorageAttachment.deleteMany({ where: { blob_id: blob.id } });
    await prisma.activeStorageBlob.delete({ where: { id: blob.id } });
    await prisma.chatMessage.deleteMany({ where: { room_id: room.id } });
    await prisma.room.delete({ where: { id: room.id } });
    await prisma.roomMembership.deleteMany({ where: { room_id: parent.id } });
    await prisma.room.delete({ where: { id: parent.id } });
    await prisma.user.delete({ where: { id: user.id } });
    await prisma.$disconnect();
  }
});
