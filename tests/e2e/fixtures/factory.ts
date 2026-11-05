import { faker } from "@faker-js/faker";
import { cleanupUserByEmail } from "./cleanup";
import { factories, prisma } from "../factories";

export type UserCommunityFixture = {
  userId: number;
  roomId: number;
  membershipId: number;
  entryId: number;
  projectId: number;
  sourceEntryId: number;
  postText: string;
  replyIds: number[];
  replyUserIds: number[];
  pageId?: number;
  pageTitle?: string;
  pageIcon?: string;
};

const doc = (text: string) => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});

const E2E_COMMUNITY_NAME = "E2E Community";

export async function ensureUser(email: string, username = "e2e-user", now = new Date()): Promise<number> {
  const normalized = email.toLowerCase();
  const existing = await prisma.user.findFirst({ where: { email: normalized } });
  if (existing) return existing.id;
  const created = await factories.user
    .props({
      email: () => normalized,
      username: () => username,
      created_at: () => now,
      updated_at: () => now,
    })
    .create();
  return created.id;
}

export async function createUserCommunityFixture(
  options: {
    email?: string;
    username?: string;
    roomName?: string;
    boardName?: string;
    squareName?: string;
    withReplies?: number;
    withOtp?: boolean;
    withPage?: boolean;
    pageTitle?: string;
    pageIcon?: string;
    skipEmailCleanup?: boolean;
  } = {},
): Promise<UserCommunityFixture> {
  const now = new Date();
  const {
    email,
    username,
    roomName: communityName = E2E_COMMUNITY_NAME,
    withReplies = 0,
    withOtp = false,
    withPage = false,
    skipEmailCleanup = false,
  } = options;
  const pageTitle = options.pageTitle ?? "E2E Reflection Page";
  const pageIcon = options.pageIcon ?? "🧪";

  if (email && !skipEmailCleanup) {
    await cleanupUserByEmail(email.toLowerCase());
  }

  const userEmail = email?.toLowerCase() ?? faker.internet.email().toLowerCase();
  const userName = username ?? faker.internet.username().slice(0, 30);
  const userId = await ensureUser(userEmail, userName, now);
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });

  const community =
    (await prisma.room.findFirst({
      where: { owner_id: user.id, name: communityName },
    })) ??
    (await factories.room
      .props({
        name: () => communityName,
        owner_id: () => user.id,
        created_at: () => now,
        updated_at: () => now,
      })
      .create());

  const membership =
    (await prisma.roomMembership.findFirst({
      where: { room_id: community.id, user_id: user.id },
    })) ??
    (await factories.communityMembership
      .props({
        room_id: () => community.id,
        user_id: () => user.id,
        notify: () => true,
        created_at: () => now,
        updated_at: () => now,
        disabled: () => false,
      })
      .create());

  const postText = faker.lorem.sentence();
  const project = await prisma.project.create({ data: { owner_id: user.id, name: `Private studies ${community.id}`, created_at: now, updated_at: now } });
  const source = await prisma.entry.create({ data: { user_id: user.id, project_id: project.id, creation_origin: "project_material", status: "published", published_at: now, created_at: now, updated_at: now } });
  await prisma.document.create({ data: { docable_type: "Post", docable_id: source.id, content: doc(postText), created_at: now, updated_at: now } });
  const post = await factories.entry
    .props({
      user_id: () => user.id,
      room_id: () => community.id,
      source_entry_id: () => source.id,
      status: () => "published",
      created_at: () => now,
      updated_at: () => now,
      published_at: () => now,
    })
    .create();

  await factories.document
    .props({
      docable_type: () => "Post",
      docable_id: () => post.id,
      content: () => doc(postText),
      version: () => 1,
      created_at: () => now,
      updated_at: () => now,
    })
    .create();


  if (withOtp && email) {
    await factories.oneTimeToken
      .props({
        email: () => email.toLowerCase(),
        token: () => faker.string.numeric(6),
        user_id: () => user.id,
        invite_id: () => null,
        purpose: () => "login",
        expires_at: () => new Date(now.getTime() + 5 * 60 * 1000),
        sent_at: () => now,
        created_at: () => now,
        updated_at: () => now,
      })
      .create();
  }

  const replyIds: number[] = [];
  const replyUserIds: number[] = [];

  let pageId: number | undefined;
  if (withPage) {
    const page =
      (await prisma.page.findFirst({
        where: { room_id: community.id, title: pageTitle },
      })) ??
      (await factories.page
        .props({
          room_id: () => community.id,
          title: () => pageTitle,
          icon: () => pageIcon,
          created_at: () => now,
          updated_at: () => now,
        })
        .create());
    pageId = Number(page.id);
  }

  for (let i = 0; i < withReplies; i += 1) {
    const replyUser = await factories.user
      .props({
        created_at: () => now,
        updated_at: () => now,
      })
      .create();
    replyUserIds.push(replyUser.id);
    await factories.communityMembership
      .props({
        room_id: () => community.id,
        user_id: () => replyUser.id,
        notify: () => true,
        created_at: () => now,
        updated_at: () => now,
        disabled: () => false,
      })
      .create();
    const reply = await factories.reply
      .props({
        user_id: () => replyUser.id,
        entry_id: () => post.id,
        status: () => "published",
        created_at: () => now,
        updated_at: () => now,
        published_at: () => now,
      })
      .create();
    replyIds.push(reply.id);
    await factories.document
      .props({
        docable_type: () => "Reply",
        docable_id: () => reply.id,
        content: () => doc(`Reply ${i + 1}`),
        version: () => 1,
        created_at: () => now,
        updated_at: () => now,
      })
      .create();
  }

  return {
    userId: user.id,
    roomId: community.id,
    membershipId: membership.id,
    entryId: post.id,
    projectId: project.id,
    sourceEntryId: source.id,
    postText,
    replyIds,
    replyUserIds,
    pageId,
    pageTitle: withPage ? pageTitle : undefined,
    pageIcon: withPage ? pageIcon : undefined,
  };
}
