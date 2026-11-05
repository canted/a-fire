import type { Prisma } from "@prisma/client";
import { prisma } from "./database";
import type { UserCommunityFixture } from "./factory";



export async function cleanupAllTestData(database: Pick<Prisma.TransactionClient, "$queryRaw" | "$executeRawUnsafe"> = prisma): Promise<void> {
  const tables = [
    "notification_events",
    "notification_inbox_items",
    "notification_preferences",
    "push_subscriptions",
    "roles",
    "reflections",
    "documents",
    "replies",
    "entries",
    "room_memberships",
    "invites",
    "one_time_tokens",
    "rooms",
    "users",
    "active_storage_variant_records",
    "active_storage_attachments",
    "active_storage_blobs",
    "notes",
  ];

  // Boss payloads reference application IDs without foreign keys. Reset them in
  // the same statement so retained jobs cannot collide with new test fixtures.
  // Boss may not have initialized its schema on a fresh test database yet.
  const [queue] = await database.$queryRaw<Array<{ present: boolean }>>`SELECT to_regclass('pgboss.job') IS NOT NULL AS present`;
  const quoted = tables.map((name) => `"${name}"`);
  if (queue.present) quoted.push('"pgboss"."job"');
  // Keep IDs monotonic: a worker may still hold an old payload during reset.
  await database.$executeRawUnsafe(`TRUNCATE TABLE ${quoted.join(", ")} CASCADE`);
}

export async function cleanupFixture(fixture: UserCommunityFixture): Promise<void> {
  const { roomId: contextRoomId, entryId: postId, projectId, sourceEntryId, replyIds, replyUserIds, userId } = fixture;
  await prisma
    .$transaction(
      [
        prisma.reflection.deleteMany({ where: { reflectable_type: "Post", reflectable_id: postId } }),
        prisma.document.deleteMany({
          where: {
            OR: [
              { docable_type: "Post", docable_id: { in: [postId, sourceEntryId] } },
              { docable_type: "Reply", docable_id: { in: replyIds } },
            ],
          },
        }),
        prisma.reply.deleteMany({ where: { id: { in: replyIds } } }),
        prisma.entry.deleteMany({ where: { id: { in: [postId, sourceEntryId] } } }),
        prisma.project.deleteMany({ where: { id: projectId } }),
        prisma.roomMembership.deleteMany({ where: { room_id: contextRoomId } }),
        prisma.room.deleteMany({ where: { id: contextRoomId } }),
        prisma.user.deleteMany({ where: { id: { in: replyUserIds } } }),
        prisma.user.deleteMany({ where: { id: userId } }),
      ],
    )
    .catch(() => {
      // best-effort cleanup
    });
}

export async function cleanupUserByEmail(email: string): Promise<void> {
  await prisma.oneTimeToken.deleteMany({ where: { email } }).catch(() => {});
  const user = await prisma.user.findFirst({ where: { email } });
  if (!user) return;

  const memberships = await prisma.roomMembership.findMany({
    where: { user_id: user.id },
    select: { room_id: true },
  });
  const communities = await prisma.room.findMany({
    where: { owner_id: user.id },
    select: { id: true },
  });

  const communityIds = Array.from(
    new Set([...memberships.map((m) => m.room_id), ...communities.map((c) => c.id)]),
  ).filter((id): id is number => typeof id === "number");

  const posts = await prisma.entry.findMany({
    where: {
      OR: [
        { room_id: { in: communityIds } },
        { user_id: user.id },
      ].filter(Boolean) as any,
    },
    select: { id: true },
  });
  const postIds = posts.map((p) => p.id);

  const replies = postIds.length
    ? await prisma.reply.findMany({ where: { entry_id: { in: postIds } }, select: { id: true, user_id: true } })
    : [];
  const replyIds = replies.map((r) => r.id);
  const replyUserIds = replies.map((r) => r.user_id).filter((id): id is number => typeof id === "number");

  await prisma
    .$transaction(
      [
        prisma.reflection.deleteMany({ where: { reflectable_type: "Post", reflectable_id: { in: postIds } } }),
        prisma.document.deleteMany({
          where: {
            OR: [
              { docable_type: "Post", docable_id: { in: postIds } },
              { docable_type: "Reply", docable_id: { in: replyIds } },
            ],
          },
        }),
        prisma.reply.deleteMany({ where: { id: { in: replyIds } } }),
        prisma.entry.deleteMany({ where: { id: { in: postIds } } }),
        prisma.roomMembership.deleteMany({ where: { room_id: { in: communityIds } } }),
        prisma.room.deleteMany({ where: { id: { in: communityIds } } }),
        prisma.user.deleteMany({ where: { id: { in: replyUserIds } } }),
        prisma.user.deleteMany({ where: { id: user.id } }),
      ],
    )
    .catch(() => {
      // best-effort cleanup
    });
}
