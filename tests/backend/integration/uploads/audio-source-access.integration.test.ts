// @vitest-environment node
import "reflect-metadata";
import { expect, it, vi } from "vitest";
import { PrismaService } from "@server/prisma/prisma.service";
import { RoomAccessService } from "@server/api/v1/rooms/room-access.service";
import { AudioAssetsService } from "@server/api/v1/audio-assets/audio-assets.service";
import { EntriesReadService } from "@server/api/v1/entries/entries.read.service";
import { loadTestEnvironment } from "@server/runtime/test-environment.mjs";
import { loadEnv } from "@server/runtime/loadEnv";

it("revokes a Room audio uploader's metadata, bytes and waveform access with membership", async () => {
  loadEnv();
  loadTestEnvironment({ requireDatabase: true });
  const prisma = new PrismaService();
  const now = new Date();
  const user = await prisma.user.create({ data: { email: `audio-access-${crypto.randomUUID()}@example.com`, username: "Uploader", created_at: now, updated_at: now } });
  const room = await prisma.room.create({ data: { name: "Closed Room", porosity: "closed", owner_id: user.id, created_at: now, updated_at: now } });
  const post = await prisma.entry.create({ data: { user_id: user.id, room_id: room.id, status: "published", created_at: now, updated_at: now, published_at: now } });
  const blob = await prisma.activeStorageBlob.create({ data: { key: crypto.randomUUID(), filename: "audio.wav", content_type: "audio/wav", service_name: "test", byte_size: 1, created_at: now } });
  const access = new RoomAccessService();
  Object.assign(access, { prisma });
  const storage = { exists: vi.fn(), getStream: vi.fn() };
  const service = new AudioAssetsService();
  Object.assign(service, { prisma, circleAccess: access, storage });
  try {
    await prisma.roomMembership.create({ data: { room_id: room.id, user_id: user.id, disabled: false, created_at: now, updated_at: now } });
    const asset = await prisma.audioAsset.create({ data: { blob_id: blob.id, owner_id: user.id, source_type: "Post", source_id: post.id, title: "Audio", original_filename: "audio.wav", processing_status: "ready", created_at: now, updated_at: now } });
    expect((await service.getAudioAssetForUser(asset.id, user.id)).id).toBe(asset.id);
    await prisma.roomMembership.updateMany({ where: { room_id: room.id, user_id: user.id }, data: { disabled: true } });
    await expect(service.getAudioAssetForUser(asset.id, user.id)).rejects.toThrow("Forbidden");
    await expect(service.streamAudioAssetForUser(asset.id, user.id)).rejects.toThrow("Forbidden");
    await expect(service.getSpectrumForUser(asset.id, user.id)).rejects.toThrow("Forbidden");
    expect(storage.exists).not.toHaveBeenCalled();
    expect(storage.getStream).not.toHaveBeenCalled();
  } finally {
    await prisma.activeStorageBlob.delete({ where: { id: blob.id } });
    await prisma.entry.delete({ where: { id: post.id } });
    await prisma.roomMembership.deleteMany({ where: { room_id: room.id } });
    await prisma.room.delete({ where: { id: room.id } });
    await prisma.user.delete({ where: { id: user.id } });
    await prisma.$disconnect();
  }
});

it("keeps unscoped legacy Entry details and audio private to the Entry author", async () => {
  const prisma = new PrismaService(), now = new Date();
  const author = await prisma.user.create({ data: { email: `legacy-author-${crypto.randomUUID()}@example.com`, username: "Author", created_at: now, updated_at: now } });
  const uploader = await prisma.user.create({ data: { email: `legacy-uploader-${crypto.randomUUID()}@example.com`, username: "Uploader", created_at: now, updated_at: now } });
  const post = await prisma.entry.create({ data: { user_id: author.id, status: "published", created_at: now, updated_at: now } });
  const blob = await prisma.activeStorageBlob.create({ data: { key: crypto.randomUUID(), filename: "private.wav", content_type: "audio/wav", service_name: "test", byte_size: 1, created_at: now } });
  const storage = { exists: vi.fn(), getStream: vi.fn() };
  const service = new AudioAssetsService(), reads = new EntriesReadService();
  Object.assign(service, { prisma, storage });
  Object.assign(reads, { prisma });
  try {
    const asset = await prisma.audioAsset.create({ data: { blob_id: blob.id, owner_id: uploader.id, source_type: "Post", source_id: post.id, title: "Audio", original_filename: "private.wav", processing_status: "ready", created_at: now, updated_at: now } });
    expect((await service.getAudioAssetForUser(asset.id, author.id)).id).toBe(asset.id);
    await expect(reads.fetchEntry(post.id, uploader.id)).rejects.toThrow("private to their author");
    await expect(service.getAudioAssetForUser(asset.id, uploader.id)).rejects.toThrow("Forbidden");
    await expect(service.streamAudioAssetForUser(asset.id, uploader.id)).rejects.toThrow("Forbidden");
    await expect(service.getSpectrumForUser(asset.id, uploader.id)).rejects.toThrow("Forbidden");
    expect(storage.exists).not.toHaveBeenCalled();
    expect(storage.getStream).not.toHaveBeenCalled();
    expect(await prisma.entry.findUniqueOrThrow({ where: { id: post.id } })).toEqual(post);
  } finally {
    await prisma.activeStorageBlob.delete({ where: { id: blob.id } });
    await prisma.entry.delete({ where: { id: post.id } });
    await prisma.user.deleteMany({ where: { id: { in: [author.id, uploader.id] } } });
    await prisma.$disconnect();
  }
});
