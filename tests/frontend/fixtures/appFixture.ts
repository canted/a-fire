export const fixtureUser = {
  id: 1,
  username: "alex",
  display_username: "Alex",
  avatar_url: "",
  display_avatar_url: "",
};

export const fixtureCommunity = {
  id: 1,
  name: "Evening Room",
  pages: [
    { id: 1, title: "Welcome", icon: "👋" },
    { id: 2, title: "Notes", icon: "📝" },
  ],
  memberBoard: { id: 1, name: "Latest Posts" },
};

export const fixtureBoard = {
  id: 1,
  name: "Latest Posts",
  roomId: fixtureCommunity.id,
  iconUrl: null,
  canManage: true,
  currentUserSquareId: 1,
  replySettings: {
    replyMode: "simple",
    defaultFeedbackTypes: ["impression", "question", "idea"],
    defaultIdeaGuidance: "open",
    canEditReplyMode: true,
  },
  squares: [
    {
      id: 1,
      username: fixtureUser.username,
      latestEntry: {
        id: 1,
        content: {
          type: "doc",
          content: [{ type: "paragraph", content: [{ type: "text", text: "Hello world" }] }],
        },
      },
    },
  ],
};

export const fixturePost = {
  id: 1,
  room_id: fixtureCommunity.id,
  content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Hello world" }] }] },
  reflections: [],
  user: fixtureUser,
  created_at: new Date("2025-12-01T10:00:00.000Z").toISOString(),
  published_at: new Date("2025-12-01T10:00:00.000Z").toISOString(),
};

export const fixtureReplies = [
  {
    id: 1,
    user: fixtureUser,
    created_at: new Date("2025-12-01T10:05:00.000Z").toISOString(),
    published_at: new Date("2025-12-01T10:05:00.000Z").toISOString(),
    content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Reply" }] }] },
  },
];

export const fixtureNotices = [
  {
    id: 1,
    source: "Noah",
    message: "A new update",
    type: "post",
    createdAt: new Date("2025-12-01T10:00:00.000Z"),
    targetUrl: "https://example.com",
    entryId: fixturePost.id,
  },
];

export const fixtureInvites = [
  {
    id: 1,
    email: "invitee@example.com",
    recipient_label: "invitee@example.com",
    token: "token-1",
    status: "pending",
    created_at: new Date("2025-12-01T10:00:00.000Z").toISOString(),
    expires_at: new Date("2025-12-10T10:00:00.000Z").toISOString(),
    used_at: null,
  },
];

export const fixturePagination = { next_page: null };

export const fixturePage = {
  id: 1,
  title: "Welcome",
  icon: "👋",
  content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Page body" }] }] },
  room_id: fixtureCommunity.id,
  version: 1,
  can_manage: true,
  parent_id: null,
};

export const fixturePageTree = {
  pages: [
    {
      id: 1,
      title: "Welcome",
      icon: "👋",
      children: [],
    },
  ],
};
