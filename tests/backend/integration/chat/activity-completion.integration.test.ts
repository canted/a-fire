import { RoomAccessService } from "@server/api/v1/rooms/room-access.service";
import { BoardsDetailService } from "@server/api/v1/boards/boards.detail.service";
import "reflect-metadata";
import { Prisma } from "@prisma/client";
import { expect, it } from "vitest";
import { PrismaService } from "@server/prisma/prisma.service";
import { ArtBeforeChorusRoundService } from "@server/api/v1/rounds/runtime/art-before-chorus.activity.service";
import { ChatService } from "@server/api/v2/rooms/chat.service";

import { loadEnv } from "@server/runtime/loadEnv";
import { loadTestEnvironment } from "@server/runtime/test-environment.mjs";

it("atomically publishes final contributions and one exact-Wall link, without pinned chat copies", async () => {
  loadEnv();
  loadTestEnvironment({ requireDatabase: true });
  const prisma = new PrismaService();
  const now = new Date();
  const users: number[] = [];
  const posts: number[] = [];
  const sources: number[] = [];
  const projects: number[] = [];
  let targetRoomId: number | undefined;
  let activityId: number | undefined;
  try {
    for (let index = 0; index < 3; index++) {
      const user = await prisma.user.create({ data: { email: `activity-chat-${crypto.randomUUID()}@example.com`, username: `Contributor ${index}`, created_at: now, updated_at: now } });
      users.push(user.id);
    }
    targetRoomId = (await prisma.room.create({ data: { name: "Activity chat test", owner_id: users[0], created_at: now, updated_at: now } })).id;
    activityId = (await prisma.round.create({ data: {
      room_id: targetRoomId, host_id: users[0], name: "Separate originals", template_key: "art_before_chorus",
      status: "active", created_at: now, updated_at: now, started_at: now, submit_by: now,
      feedback_due_at: new Date(now.getTime() + 60_000),
    } })).id;
    for (const userId of users) {
      await prisma.roomMembership.create({ data: { room_id: targetRoomId, user_id: userId, created_at: now, updated_at: now } });
      const project = await prisma.project.create({ data: { owner_id: userId, name: "Private source", created_at: now, updated_at: now } });
      projects.push(project.id);
      const source = await prisma.entry.create({ data: { user_id: userId, project_id: project.id, creation_origin: "project_material", status: "published", created_at: now, updated_at: now } });
      sources.push(source.id);
      await prisma.activityParticipation.create({ data: { round_id: activityId, user_id: userId, role: "participant", status: "active", joined_at: now, created_at: now, updated_at: now } });
      for (const kind of ["cover", "response"]) {
        const post = await prisma.entry.create({ data: { user_id: userId, source_entry_id: source.id, room_id: targetRoomId, round_id: activityId, created_at: now, updated_at: now } });
        posts.push(post.id);
        await prisma.activityArtifact.create({ data: { round_id: activityId, user_id: userId, entry_id: post.id, kind, submitted_at: now, created_at: now, updated_at: now } });
        await prisma.document.create({ data: { docable_type: "Post", docable_id: post.id, created_at: now, updated_at: now,
          content: { type: "doc", content: kind === "cover" ? [{ type: "image", attrs: { src: "/cover.jpg" } }] : [
            { type: "image", attrs: { src: "/chosen-cover.jpg" } }, { type: "audio", attrs: { audioAssetId: 42 } },
          ] },
        } });
      }
    }
    const covers = await prisma.activityArtifact.findMany({ where: { round_id: activityId, kind: "cover" }, orderBy: { user_id: "asc" } });
    for (let index = 0; index < users.length; index++) {
      await prisma.activityArtifact.update({ where: { entry_id: posts[index * 2 + 1] }, data: { source_artifact_id: covers[(index + 1) % users.length].id } });
      await prisma.entry.update({ where: { id: posts[index * 2 + 1] }, data: { format: "mixed_media", format_data: { name: "Sketch", image_url: "/chosen-cover.jpg", audio_asset_id: 42 } } });
    }
    const activity = new ArtBeforeChorusRoundService();
    Object.assign(activity, { prisma });
    await activity.syncChat(activityId);
    await activity.finalize(activityId);
    expect(await prisma.chatMessage.count({ where: { room_id: targetRoomId, timeline_kind: "message" } })).toBe(0);
    expect(await prisma.entry.count({ where: { id: { in: posts }, status: "draft" } })).toBe(6);

    await prisma.round.update({ where: { id: activityId }, data: { feedback_due_at: now } });
    // A missing source must roll back both the archive and all participant posts.
    const removed = await prisma.document.findUniqueOrThrow({ where: { docable_type_docable_id: { docable_type: "Post", docable_id: posts[5] } } });
    await prisma.document.delete({ where: { id: removed.id } });
    await expect(activity.finalize(activityId)).rejects.toThrow("Missing document");
    expect((await prisma.round.findUniqueOrThrow({ where: { id: activityId } })).status).toBe("active");
    expect(await prisma.chatMessage.count({ where: { room_id: targetRoomId, pinned_at: { not: null } } })).toBe(0);
    await prisma.document.create({ data: { ...removed, content: removed.content ?? Prisma.JsonNull } });
    await Promise.all([activity.finalize(activityId), activity.finalize(activityId)]);
    const messages = await prisma.chatMessage.findMany({ where: { room_id: targetRoomId, entry_origin: "wall_publication" }, orderBy: { id: "asc" } });
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ entry_id: null, pinned_at: null, entry_origin: "wall_publication", timeline_kind: "round_event" });
    const wall = await prisma.roundResult.findUniqueOrThrow({ where: { round_id: activityId }, include: { entries: { orderBy: { position: "asc" } } } });
    expect(wall.entries.map(entry => entry.entry_id)).toEqual([posts[1], posts[3], posts[5]]);
    expect(await prisma.roundResult.count({ where: { round_id: activityId } })).toBe(1);
    await activity.syncChat(activityId);
    expect(await prisma.chatMessage.count({ where: { room_id: targetRoomId, timeline_kind: "round_event" } })).toBe(4);
    expect(await prisma.entry.count({ where: { id: { in: posts }, status: "published" } })).toBe(3);
    const access = new RoomAccessService(); Object.assign(access, { prisma });
    const home = new BoardsDetailService(); Object.assign(home, { prisma, circleAccess: access, activityLifecycle: { reconcileCircle: async () => false } });
    const roomHome = await home.fetchRoomHome(targetRoomId, users[0]);
    expect(roomHome.members.map(member => member.latestEntry?.id).sort()).toEqual([posts[1], posts[3], posts[5]].map(String).sort());
    const participations = await prisma.activityParticipation.findMany({ where: { round_id: activityId }, orderBy: { user_id: "asc" } });
    expect(participations.map(member => member.submitted_entry_id)).toEqual([posts[1], posts[3], posts[5]]);
    expect(await prisma.activitySubmission.count({ where: { round_id: activityId } })).toBe(3);
    const chat = new ChatService();
    Object.assign(chat, {
      prisma,
      circleAccess: { require: async () => ({ kind: "member" }) },
      rooms: { listMembersForChat: async () => ({ members: [] }) },
    });
    const timeline = await chat.listMessages(targetRoomId, users[0], {});
    expect(timeline.messages.filter(message => message.round_event)).toHaveLength(4);
    const announcement = timeline.messages.find(message => message.id === messages[0].id);
    expect(announcement).toMatchObject({ author: null, mine: false, can_convert: false, round_event: { wall_id: wall.id, event_label: "Wall published", occurred_at: wall.published_at.toISOString() } });
    expect((await prisma.entry.findUniqueOrThrow({ where: { id: posts[1] } })).format_data).toMatchObject({ round_attribution: { template_key: "art_before_chorus", cover_contributor_name: "Contributor 1" } });
    const doc = await prisma.document.findUniqueOrThrow({ where: { docable_type_docable_id: { docable_type: "Post", docable_id: posts[1] } } });
    expect((doc.content as { content: { type: string }[] }).content.map(node => node.type)).toEqual(["image", "audio"]);

  } finally {
    if (targetRoomId) await prisma.chatMessage.deleteMany({ where: { room_id: targetRoomId } });
    if (activityId) await prisma.activityArtifact.deleteMany({ where: { round_id: activityId } });
    if (activityId) await prisma.activitySubmission.deleteMany({ where: { round_id: activityId } });
    if (activityId) await prisma.activityParticipation.deleteMany({ where: { round_id: activityId } });
    await prisma.document.deleteMany({ where: { docable_type: "Post", docable_id: { in: posts } } });
    await prisma.entry.deleteMany({ where: { id: { in: posts } } });
    await prisma.entry.deleteMany({ where: { id: { in: sources } } });
    await prisma.project.deleteMany({ where: { id: { in: projects } } });
    if (activityId) await prisma.round.delete({ where: { id: activityId } });
    if (targetRoomId) await prisma.roomMembership.deleteMany({ where: { room_id: targetRoomId } });
    if (targetRoomId) await prisma.room.delete({ where: { id: targetRoomId } });
    await prisma.user.deleteMany({ where: { id: { in: users } } });
    await prisma.$disconnect();
  }
}, 20_000);
