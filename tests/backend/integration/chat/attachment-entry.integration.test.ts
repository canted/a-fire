import { LinkPreviewsService } from "@server/api/v1/link-previews/link-previews.service";
import { grantRoomVisit } from "@server/api/v1/rooms/room-visit-lease";
import "reflect-metadata";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Prisma } from "@prisma/client";
import { BadRequestException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { PrismaService } from "@server/prisma/prisma.service";
import { BossService } from "@server/queue/boss.service";
import { StorageService } from "@server/storage/storage.service";
import { ImageVariantsService } from "@server/uploads/images/image-variants.service";
import { RoomsService } from "@server/api/v1/rooms/rooms.service";
import { RoomAccessService } from "@server/api/v1/rooms/room-access.service";
import { EntriesReadService } from "@server/api/v1/entries/entries.read.service";
import { EntriesService } from "@server/api/v1/entries/entries.service";
import { RepliesService } from "@server/api/v1/replies/replies.service";
import { ChatService } from "@server/api/v2/rooms/chat.service";
import { UploadsService } from "@server/api/v1/uploads/uploads.service";
import { VideoAssetsService } from "@server/api/v1/video-assets/video-assets.service";
import { AudioAssetsService } from "@server/api/v1/audio-assets/audio-assets.service";
import { ProjectEntriesService } from "@server/api/v1/projects/project-entries.service";
import { loadTestEnvironment } from "@server/runtime/test-environment.mjs";
import { withTestDependencies } from "@tests/backend/helpers/service";

async function fixture() {
  loadTestEnvironment({ requireDatabase: true });
  const prisma = new PrismaService(), boss = new BossService();
  const root = await mkdtemp(path.join(os.tmpdir(), "afire-chat-entry-"));
  const storage = withTestDependencies(new StorageService(), { localRoot: root, useS3: false });
  const images = withTestDependencies(new ImageVariantsService(), { prisma, storage });
  const access = withTestDependencies(new RoomAccessService(), { prisma });
  const uploads = withTestDependencies(new UploadsService(), { prisma, storage, images, circleAccess: access, boss });

  const realtime = { emit: vi.fn(), chatRoom: (id: number) => `chat:${id}`, entryRoom: (id: number) => `post:${id}`, boardRoom: (id: number) => `board:${id}` };
  const now = new Date(), suffix = crypto.randomUUID();
  const users = await Promise.all(["author", "member", "visitor", "outsider"].map(username => prisma.user.create({ data: { email: `${username}-${suffix}@entry.test`, username, created_at: now, updated_at: now } })));
  const [author, member, visitor, outsider] = users;
  const circle = await prisma.room.create({ data: { name: "Attachment test room", owner_id: author.id, created_at: now, updated_at: now } });
  await prisma.roomMembership.createMany({ data: [author, member].map(user => ({ room_id: circle.id, user_id: user.id, disabled: false, created_at: now, updated_at: now })) });
  await prisma.roomKnock.create({ data: { room_id: circle.id, user_id: visitor.id, status: "admitted", created_at: now, updated_at: now } });
  await grantRoomVisit(prisma, circle.id, visitor.id, "knock", now);
  const communities = withTestDependencies(new RoomsService(), { prisma, circleAccess: access });
  const read = withTestDependencies(new EntriesReadService(), { prisma, circleAccess: access, linkPreviews: { serializeAttachment: vi.fn().mockResolvedValue(null), attachmentsForOwners: vi.fn().mockResolvedValue(new Map()) } });
  const notifications = { createChatPreservationNotification: vi.fn(), createDirectChatAnnouncement: vi.fn(), createPostNotification: vi.fn(), createMentionNotifications: vi.fn().mockResolvedValue([]), enqueueNotificationEvents: vi.fn() };
  const posts = withTestDependencies(new EntriesService(), { prisma, uploads, circleAccess: access, read, realtime, notifications, boardsDetailService: { fetchBoard: vi.fn().mockResolvedValue({ squares: [] }) } });
  const chat = withTestDependencies(new ChatService(), { prisma, entries: posts, uploads, boss, realtime, circleAccess: access, rooms: communities });
  const replies = withTestDependencies(new RepliesService(), { prisma, boss, realtime, circleAccess: access, linkPreviews: { prepareAttachment: vi.fn().mockResolvedValue(null), applyPreparedAttachment: vi.fn().mockResolvedValue(null), upsertAttachment: vi.fn(), serializeAttachment: vi.fn().mockResolvedValue(null) } });
  const audio = withTestDependencies(new AudioAssetsService(), { prisma, storage, circleAccess: access });
  const video = withTestDependencies(new VideoAssetsService(), { prisma, storage, circleAccess: access });
  const entries = withTestDependencies(new ProjectEntriesService(), { prisma, uploads, circleAccess: access });
  const blobIds: number[] = [];
  // Historical data is seeded explicitly: the current API must not create media drafts.
  const draft = () => prisma.chatMessage.create({ data: {
    room_id: circle.id, author_id: author.id, status: "draft", body: "Historical attachment",
    masked_alias: "author", client_nonce: crypto.randomUUID(), fire_at: now,
    expires_at: new Date(now.getTime() + 86400000), created_at: now, updated_at: now,
  } });
  const file = async (messageId: number, name = "notes.txt") => {
    const buffer = Buffer.from("Synthetic attachment for regression testing.");
    const key = crypto.randomUUID();
    await storage.put(key, buffer, "text/plain");
    const blob = await prisma.activeStorageBlob.create({ data: { key, filename: name, content_type: "text/plain", byte_size: buffer.length, service_name: "local", created_at: now } });
    await prisma.activeStorageAttachment.create({ data: { record_type: "ChatMessage", record_id: messageId, blob_id: blob.id, name: "file", created_at: now } });
    blobIds.push(blob.id);
    return { type: "file", attrs: { src: `/api/v1/uploads/${blob.id}`, filename: blob.filename, size: blob.byte_size, contentType: blob.content_type ?? "application/octet-stream" } };
  };
  const doc = (...content: Prisma.InputJsonValue[]) => ({ type: "doc", content });
  const roomEntry = async () => {
    const project = await prisma.project.create({ data: { owner_id: author.id, name: "Private source", created_at: now, updated_at: now } });
    const source = await prisma.entry.create({ data: { user_id: author.id, project_id: project.id, creation_origin: "project_material", status: "published", created_at: now, updated_at: now } });
    const post = await prisma.entry.create({ data: { user_id: author.id, room_id: circle.id, source_entry_id: source.id, status: "published", published_at: now, created_at: now, updated_at: now } });
    const content = doc({ type: "paragraph", content: [{ type: "text", text: "Independent Room entry" }] });
    await prisma.document.createMany({ data: [source.id, post.id].map(docable_id => ({ docable_type: "Post", docable_id, content, created_at: now, updated_at: now })) });
    return { entry: post };
  };
  const send = (draftId: number, content: Prisma.InputJsonValue) => chat.sendMessage(circle.id, author.id, { draftId, content, body: "A synthetic attachment" });
  const close = async () => {
    try {
    const postRows = await prisma.entry.findMany({ where: { user_id: { in: users.map(user => user.id) } }, select: { id: true } });
    const postIds = postRows.map(post => post.id);
    const messageRows = await prisma.chatMessage.findMany({ where: { room_id: circle.id }, select: { id: true } });
    const messageIds = messageRows.map(message => message.id);
    const replyRows = await prisma.reply.findMany({ where: { OR: [{ entry_id: { in: postIds } }, { chat_message_id: { in: messageIds } }] }, select: { id: true } });
    const events = await prisma.notificationEvent.findMany({ where: { room_id: circle.id }, select: { id: true } });
    for (const event of events) await prisma.$executeRaw`DELETE FROM pgboss.job WHERE data->>'eventId'=${String(event.id)}`;
    await prisma.$transaction(async tx => {
      // A running test worker may already have fanned out the queued event.
      // Lock parents before deleting children so a late fanout cannot race cleanup.
      await tx.$queryRaw`SELECT id FROM notification_events WHERE room_id = ${circle.id} FOR UPDATE`;
      await tx.notificationPushDelivery.deleteMany({ where: { notification_event_id: { in: events.map(event => event.id) } } });
      await tx.notificationInboxItem.deleteMany({ where: { notification_event_id: { in: events.map(event => event.id) } } });
      await tx.notificationEvent.deleteMany({ where: { room_id: circle.id } });
    });
    await prisma.document.deleteMany({ where: { OR: [{ docable_type: "Post", docable_id: { in: postIds } }, { docable_type: "Reply", docable_id: { in: replyRows.map(reply => reply.id) } }] } });
    await prisma.linkPreviewAttachment.deleteMany({ where: { owner_type: "Reply", owner_id: { in: replyRows.map(reply => reply.id) } } });
    await prisma.reply.deleteMany({ where: { id: { in: replyRows.map(reply => reply.id) } } });
    const audioIds = (await prisma.audioAsset.findMany({ where: { blob_id: { in: blobIds } }, select: { id: true } })).map(row => row.id);
    const videoIds = (await prisma.videoAsset.findMany({ where: { blob_id: { in: blobIds } }, select: { id: true } })).map(row => row.id);
    for (const id of audioIds) await prisma.$executeRaw`DELETE FROM pgboss.job WHERE data->>'audioAssetId'=${String(id)}`;
    for (const id of videoIds) await prisma.$executeRaw`DELETE FROM pgboss.job WHERE data->>'videoAssetId'=${String(id)}`;
    await prisma.activeStorageAttachment.deleteMany({ where: { blob_id: { in: blobIds } } });
    await prisma.audioAsset.deleteMany({ where: { blob_id: { in: blobIds } } });
    await prisma.videoAsset.deleteMany({ where: { blob_id: { in: blobIds } } });
    await prisma.chatMessage.deleteMany({ where: { room_id: circle.id } });
    await prisma.entrySubject.deleteMany({ where: { entry_id: { in: postIds } } });
    await prisma.entry.deleteMany({ where: { id: { in: postIds } } });
    await prisma.project.deleteMany({ where: { owner_id: { in: users.map(user => user.id) } } });
    await prisma.activeStorageVariantRecord.deleteMany({ where: { blob_id: { in: blobIds } } });
    await prisma.activeStorageBlob.deleteMany({ where: { id: { in: blobIds } } });
    await prisma.roomMembership.deleteMany({ where: { room_id: circle.id } });
    await prisma.room.delete({ where: { id: circle.id } });
    await prisma.user.deleteMany({ where: { id: { in: users.map(user => user.id) } } });
    } finally { await boss.onModuleDestroy(); await prisma.$disconnect(); await rm(root, { recursive: true, force: true }); }
  };
  await boss.start();
  return { prisma, boss, notifications, root, storage, access, uploads, sharedEntries: posts, realtime, chat, replies, read, audio, video, projectEntries: entries, room: circle, author, member, visitor, outsider, now, draft, file, doc, send, roomEntry, blobIds, close };
}

it("rolls back new reply content and notification events when durable queue insertion fails", async () => {
  const f = await fixture();
  try {
    const sent = await f.roomEntry();
    const previews = withTestDependencies(new LinkPreviewsService(), { prisma: f.prisma });
    Object.assign(f.replies, { linkPreviews: previews });
    const content = f.doc({ type: "paragraph", content: [{ type: "text", text: `Atomic reply ${crypto.randomUUID()}` }] });
    const previewUrl = `https://example.com/${crypto.randomUUID()}`;
    const link_preview = { source_url: previewUrl, hidden: true };
    const enqueue = vi.spyOn(f.boss, "enqueueInTransaction").mockRejectedValueOnce(new Error("queue unavailable"));
    await expect(f.replies.create(sent.entry!.id, f.member.id, { status: "published", content, link_preview })).rejects.toThrow("queue unavailable");
    expect(await f.prisma.reply.count({ where: { entry_id: sent.entry!.id } })).toBe(0);
    expect(await f.prisma.document.count({ where: { docable_type: "Reply", content: { equals: content } } })).toBe(0);
    expect(await f.prisma.linkPreviewAttachment.count({ where: { source_url: previewUrl } })).toBe(0);
    expect(await f.prisma.notificationEvent.count({ where: { room_id: f.room.id, event_type: "reply_created" } })).toBe(0);
    expect(f.realtime.emit).not.toHaveBeenCalled();
    enqueue.mockRestore();
    const reply = await f.replies.create(sent.entry!.id, f.member.id, { status: "published", content, link_preview });
    expect(reply.status).toBe("published");
    expect(await f.prisma.linkPreviewAttachment.count({ where: { owner_type: "Reply", owner_id: Number(reply.id), source_url: previewUrl } })).toBe(1);
    expect(await f.prisma.document.count({ where: { docable_type: "Reply", docable_id: Number(reply.id) } })).toBe(1);
    const event = await f.prisma.notificationEvent.findFirstOrThrow({ where: { room_id: f.room.id, event_type: "reply_created" } });
    const jobs = await f.prisma.$queryRaw<Array<{ id: string }>>`SELECT id FROM pgboss.job WHERE name = 'notifications.fanout' AND data->>'eventId' = ${String(event.id)}`;
    expect(jobs).toHaveLength(1);
  } finally { await f.close(); }
}, 30_000);

it("rolls back reply publication failures and emits one durable event for concurrent publish requests", async () => {
  const f = await fixture();
  try {
    const sent = await f.roomEntry();
    const initial = f.doc({ type: "paragraph", content: [{ type: "text", text: "Draft content" }] });
    const published = f.doc({ type: "paragraph", content: [{ type: "text", text: "Published content" }] });
    const draft = await f.replies.create(sent.entry!.id, f.member.id, { content: initial });
    const id = Number(draft.id);
    const previews = withTestDependencies(new LinkPreviewsService(), { prisma: f.prisma });
    Object.assign(f.replies, { linkPreviews: previews });
    const enqueue = vi.spyOn(f.boss, "enqueueInTransaction").mockRejectedValueOnce(new Error("queue unavailable"));
    await expect(f.replies.update(sent.entry!.id, id, f.member.id, { status: "published", content: published })).rejects.toThrow("queue unavailable");
    expect(await f.prisma.reply.findUnique({ where: { id } })).toMatchObject({ status: "draft", published_at: null });
    expect(await f.prisma.document.findUnique({ where: { docable_type_docable_id: { docable_type: "Reply", docable_id: id } } })).toMatchObject({ content: initial });
    expect(await f.prisma.notificationEvent.count({ where: { room_id: f.room.id, event_type: "reply_created" } })).toBe(0);
    enqueue.mockRestore();

    let release!: () => void;
    const ready = new Promise<void>(resolve => { release = resolve; });
    let preparations = 0;
    const prepare = vi.spyOn(previews, "prepareAttachment").mockImplementation(async () => {
      if (++preparations === 2) release();
      await ready;
      return null;
    });
    const results = await Promise.all([
      f.replies.publish(sent.entry!.id, id, f.member.id, { content: published, expected_revision: draft.revision }),
      f.replies.publish(sent.entry!.id, id, f.member.id, { content: published, expected_revision: draft.revision }),
    ]);
    prepare.mockRestore();
    expect(results.map(reply => reply.status)).toEqual(["published", "published"]);
    const retried = await f.replies.publish(sent.entry!.id, id, f.member.id, { content: initial, expected_revision: draft.revision });
    expect(retried).toMatchObject({ id, status: "published", content: published, revision: results[0].revision });
    expect((await f.prisma.document.findUniqueOrThrow({ where: { docable_type_docable_id: { docable_type: "Reply", docable_id: id } } })).content).toEqual(published);
    const events = await f.prisma.notificationEvent.findMany({ where: { room_id: f.room.id, event_type: "reply_created" } });
    expect(events).toHaveLength(1);
    const jobs = await f.prisma.$queryRaw<Array<{ id: string }>>`SELECT id FROM pgboss.job WHERE name = 'notifications.fanout' AND data->>'eventId' = ${String(events[0].id)}`;
    expect(jobs).toHaveLength(1);
    await f.replies.update(sent.entry!.id, id, f.member.id, { content: initial });
    expect(await f.prisma.notificationEvent.count({ where: { room_id: f.room.id, event_type: "reply_created" } })).toBe(1);
    await expect(f.replies.update(sent.entry!.id, id, f.member.id, { status: "draft", content: initial })).rejects.toThrow("already published");
    expect((await f.prisma.reply.findUniqueOrThrow({ where: { id } })).status).toBe("published");
  } finally { await f.close(); }
}, 30_000);

it("rejects concurrent new media drafts without creating messages or entries", async () => {
  const f = await fixture();
  try {
    const attempts = await Promise.allSettled([f.chat.createDraftMessage(f.room.id, f.author.id, { clientNonce: "same-draft" }), f.chat.createDraftMessage(f.room.id, f.author.id, { clientNonce: "same-draft" })]);
    for (const attempt of attempts) {
      expect(attempt.status).toBe("rejected");
      if (attempt.status === "rejected") expect(attempt.reason.message).toBe("Chat supports text and links. New media drafts are unavailable.");
    }
    expect(await f.prisma.chatMessage.count({ where: { room_id: f.room.id } })).toBe(0);
    expect(await f.prisma.entry.count({ where: { room_id: f.room.id } })).toBe(0);
    expect(f.realtime.emit).not.toHaveBeenCalled();
  } finally { await f.close(); }
}, 30_000);

it("rejects legacy draft publishing repeatedly without consuming its media or notifying", async () => {
  const f = await fixture();
  try {
    const draft = await f.draft(), content = f.doc(await f.file(draft.id));
    for (let attempt = 0; attempt < 2; attempt++) await expect(f.send(draft.id, content)).rejects.toThrow("Chat supports text and links.");
    expect(await f.prisma.entry.count({ where: { room_id: f.room.id } })).toBe(0);
    expect(await f.prisma.chatMessage.findUnique({ where: { id: draft.id } })).toMatchObject({ status: "draft", entry_id: null });
    expect(await f.prisma.activeStorageAttachment.count({ where: { record_type: "ChatMessage", record_id: draft.id } })).toBe(1);
    expect(await f.prisma.notificationEvent.count({ where: { room_id: f.room.id } })).toBe(0);
    expect(f.realtime.emit).not.toHaveBeenCalled();
  } finally { await f.close(); }
}, 30_000);

it("permits visitor replies only while the Entry remains visible", async () => {
  const f = await fixture();
  try {
    await f.prisma.room.update({ where: { id: f.room.id }, data: { porosity: "masked" } });
    const draft = await f.draft(), node = await f.file(draft.id), sent = await f.roomEntry();
    await f.prisma.activeStorageAttachment.updateMany({ where: { record_type: "ChatMessage", record_id: draft.id }, data: { record_type: "Post", record_id: sent.entry.id } });
    await f.prisma.document.update({ where: { docable_type_docable_id: { docable_type: "Post", docable_id: sent.entry.id } }, data: { content: f.doc(node) } });
    const post = await f.prisma.entry.findUniqueOrThrow({ where: { id: sent.entry!.id } });
    expect(await f.access.canReadPublishedPostWithRoomHistory(post, await f.access.require(f.room.id, f.visitor.id))).toBe(true);
    await expect(f.read.fetchEntry(post.id, f.visitor.id)).resolves.toMatchObject({ entry: { viewer_access: { kind: "visitor", can_reply: true }, feedback_request: { reply_mode: "simple" } } });
    await expect(f.uploads.streamUpload(f.blobIds[0], f.visitor.id)).resolves.toHaveProperty("filename", "notes.txt");
    const visitorDraft = await f.replies.create(post.id, f.visitor.id, {});
    expect(visitorDraft.id).toBeTruthy();
    const uploadFile = { buffer: Buffer.from("Visitor attachment"), originalname: "visitor.txt", mimetype: "text/plain", size: 18 } as Express.Multer.File;
    const visitorUpload = await f.uploads.createUpload(f.visitor.id, uploadFile, { reply_id: Number(visitorDraft.id) });
    f.blobIds.push(Number(visitorUpload.id));
    const draftAudio = await f.prisma.audioAsset.create({ data: { blob_id: Number(visitorUpload.id), owner_id: f.visitor.id, source_type: "Reply", source_id: Number(visitorDraft.id), title: "Draft recording", original_filename: "draft.wav", processing_status: "ready", created_at: new Date(), updated_at: new Date() } });
    await expect(f.audio.getAudioAssetForUser(draftAudio.id, f.visitor.id)).resolves.toMatchObject({ id: draftAudio.id });

    await expect(f.uploads.streamUpload(Number(visitorUpload.id), f.visitor.id)).resolves.toHaveProperty("filename", "visitor.txt");
    await expect(f.uploads.streamUpload(Number(visitorUpload.id), f.member.id)).rejects.toBeInstanceOf(NotFoundException);

    await expect(f.read.fetchEntry(post.id, f.outsider.id)).rejects.toBeInstanceOf(ForbiddenException);
    const reply = await f.replies.create(post.id, f.member.id, { content: f.doc({ type: "paragraph", content: [{ type: "text", text: "A response" }] }), status: "published" });
    expect(reply.id).toBeTruthy();
    await f.roomEntry();
    expect(await f.access.canReadPublishedPostWithRoomHistory(post, await f.access.require(f.room.id, f.visitor.id))).toBe(false);
    await expect(f.replies.create(post.id, f.visitor.id, {})).rejects.toBeInstanceOf(ForbiddenException);
    await expect(f.replies.update(post.id, Number(visitorDraft.id), f.visitor.id, { content: f.doc({ type: "paragraph", content: [{ type: "text", text: "Now hidden" }] }) })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(f.replies.publish(post.id, Number(visitorDraft.id), f.visitor.id)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(f.uploads.createUpload(f.visitor.id, uploadFile, { reply_id: Number(visitorDraft.id) })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(f.audio.getAudioAssetForUser(draftAudio.id, f.visitor.id)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(f.uploads.streamUpload(Number(visitorUpload.id), f.visitor.id)).rejects.toBeInstanceOf(NotFoundException);

    await expect(f.read.fetchEntry(post.id, f.visitor.id)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(f.uploads.streamUpload(f.blobIds[0], f.visitor.id)).rejects.toBeInstanceOf(NotFoundException);
    await expect(f.uploads.streamUpload(f.blobIds[0], f.member.id)).resolves.toHaveProperty("filename", "notes.txt");
    await f.prisma.room.update({ where: { id: f.room.id }, data: { porosity: "open" } });
    const visitorReply = await f.replies.publish(post.id, Number(visitorDraft.id), f.visitor.id, { content: f.doc({ type: "paragraph", content: [{ type: "text", text: "Visible again" }] }) });
    expect(visitorReply.status).toBe("published");
    await expect(f.read.fetchEntry(post.id, f.visitor.id)).resolves.toMatchObject({ entry: { id: post.id } });
    await expect(f.uploads.streamUpload(f.blobIds[0], f.visitor.id)).resolves.toHaveProperty("filename", "notes.txt");
    await f.prisma.entry.update({ where: { id: post.id }, data: { status: "deleted" } });
    await expect(f.read.fetchEntry(post.id, f.member.id)).rejects.toBeInstanceOf(NotFoundException);
    await expect(f.replies.create(post.id, f.member.id, {})).rejects.toBeInstanceOf(ForbiddenException);
    await expect(f.uploads.streamUpload(f.blobIds[0], f.member.id)).rejects.toBeInstanceOf(NotFoundException);

    await expect(f.read.fetchEntry(post.id, f.visitor.id)).rejects.toBeInstanceOf(NotFoundException);
    await expect(f.uploads.streamUpload(f.blobIds[0], f.visitor.id)).rejects.toBeInstanceOf(NotFoundException);

  } finally { await f.close(); }
}, 30_000);

it("rejects other drafts' files and malformed nodes without publishing or exposing private media", async () => {
  const f = await fixture();
  try {
    const own = await f.draft(), other = await f.draft(), node = await f.file(other.id);
    await expect(f.send(own.id, f.doc(node))).rejects.toBeInstanceOf(BadRequestException);
    await expect(f.send(own.id, f.doc({ ...node, attrs: { ...node.attrs, src: "https://invalid.test/private" } }))).rejects.toBeInstanceOf(BadRequestException);
    await expect(f.chat.sendMessage(f.room.id, f.author.id, { body: "Direct reference", content: f.doc(node), clientNonce: "direct" })).rejects.toBeInstanceOf(BadRequestException);
    expect(await f.prisma.entry.count({ where: { room_id: f.room.id } })).toBe(0);
    expect(await f.prisma.chatMessage.count({ where: { room_id: f.room.id, status: "published" } })).toBe(0);
    await f.chat.deleteDraftMessage(f.room.id, other.id, f.author.id);
    expect(await f.prisma.activeStorageBlob.findUnique({ where: { id: f.blobIds[0] } })).toBeNull();
  } finally { await f.close(); }
}, 30_000);

it("keeps private Chat snapshots independently without sharing the project with the Room", async () => {
  const f = await fixture();
  try {
    const sent = await f.chat.sendMessage(f.room.id, f.author.id, { body: "Save this text", clientNonce: "saved-text" });
    const project = await f.prisma.project.create({ data: { name: "Private notes", owner_id: f.member.id, created_at: f.now, updated_at: f.now } });
    const saved = await f.projectEntries.keepChatMessage(project.id, f.member.id, sent.id);
    expect(saved).toMatchObject({ source_chat_message_id: sent.id, source_shared_entry_id: null });
    await expect(f.projectEntries.show(project.id, saved.id, f.author.id)).rejects.toBeInstanceOf(NotFoundException);
    await f.prisma.chatMessage.update({ where: { id: sent.id }, data: { status: "deleted" } });
    await expect(f.projectEntries.show(project.id, saved.id, f.member.id)).resolves.toMatchObject({ content: saved.content, source_available: false });
  } finally { await f.close(); }
}, 30_000);


it("uses canonical Room display overrides for Entry authors and replies", async () => {
  const f = await fixture();
  try {
    for (const [user, name] of [[f.author, "Room artist"], [f.member, "Room listener"]] as const) await f.prisma.roomMembership.updateMany({ where: { room_id: f.room.id, user_id: user.id }, data: { username_override: name } });
    const sent = await f.roomEntry();
    const reply = await f.replies.create(sent.entry!.id, f.member.id, { status: "published", content: f.doc({ type: "paragraph", content: [{ type: "text", text: "Room response" }] }) });
    expect(reply).toMatchObject({ display_username: "Room listener", display_avatar_url: null });
    const detail = await f.read.fetchEntry(sent.entry!.id, f.visitor.id);
    expect(detail.entry.user).toMatchObject({ display_username: "Room artist", display_avatar_url: null });
    expect(detail.replies.data[0].user).toMatchObject({ display_username: "Room listener", display_avatar_url: null });
    await expect(f.read.fetchEntry(sent.entry!.id, f.outsider.id)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(f.replies.create(sent.entry!.id, f.visitor.id, {})).resolves.toMatchObject({ status: "draft", user: { id: f.visitor.id } });
  } finally { await f.close(); }
}, 30_000);


it("rejects uploads to legacy Chat drafts before storing bytes or queuing media", async () => {
  const f = await fixture();
  try {
    const draft = await f.draft();
    const put = vi.spyOn(f.storage, "put");
    const enqueue = vi.spyOn(f.boss, "enqueueInTransaction");
    const bytes = Buffer.from("Synthetic audio");
    await expect(f.uploads.createUpload(f.author.id, { buffer: bytes, originalname: "pending.mp3", mimetype: "audio/mpeg", size: bytes.length } as Express.Multer.File, { chat_message_id: draft.id })).rejects.toBeInstanceOf(BadRequestException);
    expect(put).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
    expect(await f.prisma.audioAsset.count({ where: { source_type: "ChatMessage", source_id: draft.id } })).toBe(0);
    expect(await f.prisma.chatMessage.findUnique({ where: { id: draft.id } })).toMatchObject({ status: "draft" });
    put.mockRestore(); enqueue.mockRestore();
  } finally { await f.close(); }
}, 30_000);


it("pages historical replies with stable ordering and rechecks access on later pages", async () => {
  const f = await fixture();
  try {
    const message = await f.draft();
    await f.prisma.chatMessage.update({ where: { id: message.id }, data: { status: "published", pinned_at: f.now } });
    await f.prisma.reply.createMany({ data: Array.from({ length: 55 }, (_, index) => ({
      chat_message_id: message.id, user_id: f.author.id, status: "published",
      published_at: index < 50 ? f.now : null, created_at: f.now, updated_at: f.now,
    })) });
    const first = await f.replies.listForChatMessage(f.room.id, message.id, f.member.id);
    expect(first.replies).toHaveLength(50);
    expect(first.next_cursor).toBe(first.replies[49].id);
    await f.prisma.reply.update({ where: { id: first.next_cursor! }, data: { status: "deleted" } });
    const second = await f.replies.listForChatMessage(f.room.id, message.id, f.member.id, first.next_cursor!);
    expect(second.replies).toHaveLength(5);
    expect(second.next_cursor).toBeNull();
    const tail = await f.replies.listForChatMessage(f.room.id, message.id, f.member.id, second.replies[0].id);
    expect(tail.replies.map(reply => reply.id)).toEqual(second.replies.slice(1).map(reply => reply.id));
    const unrelated = await f.draft();
    const foreign = await f.prisma.reply.create({ data: { chat_message_id: unrelated.id, user_id: f.author.id, status: "published", published_at: f.now, created_at: f.now, updated_at: f.now } });
    await expect(f.replies.listForChatMessage(f.room.id, message.id, f.member.id, foreign.id)).rejects.toBeInstanceOf(BadRequestException);
    expect(new Set([...first.replies, ...second.replies].map(reply => reply.id)).size).toBe(55);
    await expect(f.replies.listForChatMessage(f.room.id, message.id, f.member.id, -1)).rejects.toBeInstanceOf(BadRequestException);
    await f.prisma.chatMessage.update({ where: { id: message.id }, data: { expires_at: new Date(0) } });
    await expect(f.replies.listForChatMessage(f.room.id, message.id, f.member.id, first.next_cursor!)).rejects.toBeInstanceOf(NotFoundException);
  } finally { await f.close(); }
}, 30_000);
