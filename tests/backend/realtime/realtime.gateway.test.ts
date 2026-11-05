import { RealtimeGateway } from "@server/realtime/realtime.gateway";
import { vi } from "vitest";

type SocketMock = {
  id: string;
  data: Record<string, unknown>;
  handshake: { auth?: Record<string, unknown>; headers: Record<string, unknown> };
  disconnect: ReturnType<typeof vi.fn>;
  join: ReturnType<typeof vi.fn>;
  leave: ReturnType<typeof vi.fn>;
};

const makeSocket = (auth?: Record<string, unknown>, headers: Record<string, unknown> = {}): SocketMock => ({
  id: "socket-1",
  data: {},
  handshake: { auth, headers },
  disconnect: vi.fn(),
  join: vi.fn(),
  leave: vi.fn(),
});

const makeDeps = () => ({
  auth: { verifyAccessToken: vi.fn() },
  prisma: {
    user: { update: vi.fn() },
    entry: { findUnique: vi.fn(), findFirst: vi.fn() },
    board: { findUnique: vi.fn() },
    roomStructureArchive: { findUnique: vi.fn().mockResolvedValue(null) },
    square: { findFirst: vi.fn() },
    page: { findUnique: vi.fn() },
    roomMembership: { findFirst: vi.fn() },
    chatPresenceSession: {
      upsert: vi.fn().mockResolvedValue({ id: 1 }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      findMany: vi.fn().mockResolvedValue([{ user_id: 1 }]),
    },
  },
  realtime: {
    setServer: vi.fn(),
    markUserActive: vi.fn(),
    markUserInactive: vi.fn(),
    notificationRoom: vi.fn().mockReturnValue("notification:1"),
    entryRoom: vi.fn().mockReturnValue("entry:1"),
    boardRoom: vi.fn().mockReturnValue("board:1"),
    noteRoom: vi.fn().mockReturnValue("page:1"),
    chatRoom: vi.fn().mockReturnValue("chat:2"),
    emit: vi.fn(),
  },
  notificationActivity: { recordActivity: vi.fn().mockResolvedValue(undefined) },
  circleAccess: { resolve: vi.fn().mockResolvedValue(null), canReadPublishedPostWithRoomHistory: vi.fn().mockResolvedValue(false) },
});

describe("RealtimeGateway", () => {
  const makeGateway = () => {
    const gateway = new RealtimeGateway();
    const deps = makeDeps();
    (gateway as any).authService = deps.auth;
    (gateway as any).prisma = deps.prisma;
    (gateway as any).realtime = deps.realtime;
    (gateway as any).notificationActivity = deps.notificationActivity;
    (gateway as any).circleAccess = deps.circleAccess;
    return { gateway, deps };
  };

  it("checks current access on delivery after subscription", async () => {
    const { gateway, deps } = makeGateway();
    const socket = makeSocket();
    socket.data.userId = 1;
    deps.circleAccess.resolve.mockResolvedValue({ kind: "member" });
    await gateway.subscribe(socket as any, { channel: "ChatChannel", id: 2 });
    gateway.afterInit();
    const authorize = deps.realtime.setServer.mock.calls[0][1];
    deps.circleAccess.resolve.mockResolvedValue(null);
    expect(await authorize(socket, "ChatChannel", "chat:2")).toBe(false);
    expect(await authorize(socket, "NotificationChannel", "notification:2")).toBe(false);
    expect(await authorize(socket, "EntryChannel", "chat:2")).toBe(false);
    expect(await authorize(socket, "NotificationChannel", "notification:1")).toBe(true);
  });

  it("uses refresh-only delivery for visitors and denies invisible Entry channels", async () => {
    const { gateway, deps } = makeGateway();
    const socket = makeSocket();
    socket.data.userId = 1;
    deps.circleAccess.resolve.mockResolvedValue({ kind: "visitor" });
    deps.prisma.board.findUnique.mockResolvedValue({ room_id: 2 });
    deps.prisma.entry.findUnique.mockResolvedValue({ id: 3, status: "published", room_id: 2 });
    deps.circleAccess.canReadPublishedPostWithRoomHistory.mockResolvedValue(true);
    gateway.afterInit();
    const authorize = deps.realtime.setServer.mock.calls[0][1];
    expect(await authorize(socket, "BoardChannel", "board:1")).toBe(false);
    expect(await authorize(socket, "ChatChannel", "chat:2")).toBe("refresh");
    expect(await authorize(socket, "EntryChannel", "entry:3")).toBe("refresh");
    deps.circleAccess.canReadPublishedPostWithRoomHistory.mockResolvedValue(false);
    expect(await authorize(socket, "EntryChannel", "entry:3")).toBe(false);
  });

  it("requires live source access for member Chat-attachment subscriptions but preserves independent Entries", async () => {
    const { gateway, deps } = makeGateway();
    const socket = makeSocket();
    socket.data.userId = 1;
    deps.circleAccess.resolve.mockResolvedValue({ kind: "member" });
    deps.prisma.entry.findUnique.mockResolvedValue({ id: 3, status: "published", room_id: 2, creation_origin: "chat_attachment" });
    deps.circleAccess.canReadPublishedPostWithRoomHistory.mockResolvedValue(false);
    await gateway.subscribe(socket as any, { channel: "EntryChannel", id: 3 });
    expect(socket.join).not.toHaveBeenCalled();
    deps.prisma.entry.findUnique.mockResolvedValue({ id: 3, status: "published", room_id: 2, source_entry_id: 12, creation_origin: null });
    await gateway.subscribe(socket as any, { channel: "EntryChannel", id: 3 });
    expect(socket.join).toHaveBeenCalledWith("entry:1");
  });

  it("authenticates via auth token", async () => {
    const { gateway, deps } = makeGateway();
    deps.auth.verifyAccessToken.mockReturnValue({ userId: 1 });
    const socket = makeSocket({ token: "tok" });

    await gateway.handleConnection(socket as any);

    expect(socket.data.userId).toBe(1);
    expect(deps.realtime.markUserActive).toHaveBeenCalledWith(1);
    expect(deps.notificationActivity.recordActivity).toHaveBeenCalledWith(1);
  });

  it("disconnects when auth fails", async () => {
    const { gateway, deps } = makeGateway();
    deps.auth.verifyAccessToken.mockImplementation(() => {
      throw new Error("bad");
    });
    const socket = makeSocket({ token: "bad" });

    await gateway.handleConnection(socket as any);

    expect(socket.disconnect).toHaveBeenCalled();
  });

  it("subscribes notification channel", async () => {
    const { gateway, deps } = makeGateway();
    const socket = makeSocket();
    socket.data.userId = 1;

    await gateway.subscribe(socket as any, { channel: "NotificationChannel" });

    expect(socket.join).toHaveBeenCalledWith("notification:1");
    expect(deps.notificationActivity.recordActivity).not.toHaveBeenCalled();
  });

  it("subscribes to an unscoped legacy entry only as its author", async () => {
    const { gateway, deps } = makeGateway();
    const socket = makeSocket();
    socket.data.userId = 1;
    deps.prisma.entry.findUnique.mockResolvedValue({ id: 1, user_id: 1, room_id: null, square: null });

    await gateway.subscribe(socket as any, { channel: "EntryChannel", id: 1 });

    expect(socket.join).toHaveBeenCalledWith("entry:1");
  });

  it.each([
    { user_id: 2, room_id: null, square: null },
    { user_id: 1, room_id: null, project_id: 8, creation_origin: "project_material" },
  ])("denies private or missing Room scope for subscription and delivery", async post => {
    const { gateway, deps } = makeGateway();
    const socket = makeSocket(); socket.data.userId = 1;
    deps.prisma.entry.findUnique.mockResolvedValue({ id: 1, status: "published", ...post });
    await gateway.subscribe(socket as any, { channel: "EntryChannel", id: 1 });
    expect(socket.join).not.toHaveBeenCalled();
    gateway.afterInit();
    const authorize = deps.realtime.setServer.mock.calls[0][1];
    expect(await authorize(socket, "EntryChannel", "entry:1")).toBe(false);
    expect(deps.circleAccess.resolve).not.toHaveBeenCalled();
  });

  it("blocks post subscription when membership missing", async () => {
    const { gateway, deps } = makeGateway();
    const socket = makeSocket();
    socket.data.userId = 1;
    deps.prisma.entry.findUnique.mockResolvedValue({ id: 1, room_id: 2, square: { room_id: 2 } });
    deps.prisma.roomMembership.findFirst.mockResolvedValue(null);

    await gateway.subscribe(socket as any, { channel: "EntryChannel", id: 1 });

    expect(socket.join).not.toHaveBeenCalled();
  });

  it.each(["draft", "published", "deleted"])("does not join private project entries to circle PostChannels (%s)", async (status) => {
    const { gateway, deps } = makeGateway();
    const socket = makeSocket();
    socket.data.userId = 1;
    deps.prisma.entry.findUnique.mockResolvedValue({
      id: 1, status, project_id: 8, creation_origin: "project_material", room_id: null, square_id: null, square: null,
    });

    await gateway.subscribe(socket as any, { channel: "EntryChannel", id: 1 });

    expect(socket.join).not.toHaveBeenCalled();
    expect(deps.circleAccess.resolve).not.toHaveBeenCalled();
  });

  it("denies Roomless Board subscriptions despite an owned Square", async () => {
    const { gateway, deps } = makeGateway();
    const socket = makeSocket();
    socket.data.userId = 1;
    deps.prisma.board.findUnique.mockResolvedValue({ id: 1, room_id: null });
    deps.prisma.square.findFirst.mockResolvedValue({ id: 9 });

    // @ts-expect-error Retired channels can still arrive over an untrusted socket.
    await gateway.subscribe(socket as any, { channel: "BoardChannel", id: 1 });

    expect(socket.join).not.toHaveBeenCalled();
    expect(deps.prisma.square.findFirst).not.toHaveBeenCalled();
  });

  it("rejects invalid Board identities before database lookup or subscription", async () => {
    const { gateway, deps } = makeGateway();
    const socket = makeSocket(); socket.data.userId = 1;
    for (const id of [1.5, -1, 2147483648, Infinity]) {
      // @ts-expect-error Retired channels can still arrive over an untrusted socket.
    await gateway.subscribe(socket as any, { channel: "BoardChannel", id });
    }
    expect(socket.join).not.toHaveBeenCalled();
    expect(deps.prisma.board.findUnique).not.toHaveBeenCalled();
    expect(deps.prisma.roomStructureArchive.findUnique).not.toHaveBeenCalled();
    expect(deps.circleAccess.resolve).not.toHaveBeenCalled();
  });

  it("denies deleted Notes on subscription and delivery", async () => {
    const { gateway, deps } = makeGateway();
    const socket = makeSocket(); socket.data.userId = 1;
    deps.prisma.page.findUnique.mockResolvedValue({ id: 1, room_id: 2, deleted_at: new Date() });
    deps.circleAccess.resolve.mockResolvedValue({ kind: "member" });
    await gateway.subscribe(socket as any, { channel: "NoteChannel", id: 1 });
    expect(socket.join).not.toHaveBeenCalled();
    gateway.afterInit();
    const authorize = deps.realtime.setServer.mock.calls[0][1];
    expect(await authorize(socket, "NoteChannel", "page:1")).toBe(false);
    expect(deps.circleAccess.resolve).not.toHaveBeenCalled();
  });

  it("subscribes to page for members", async () => {
    const { gateway, deps } = makeGateway();
    const socket = makeSocket();
    socket.data.userId = 1;
    deps.prisma.page.findUnique.mockResolvedValue({ id: 1, room_id: 2 });
    deps.circleAccess.resolve.mockResolvedValue({ kind: "member" });

    await gateway.subscribe(socket as any, { channel: "NoteChannel", id: 1 });

    expect(socket.join).toHaveBeenCalledWith("page:1");
  });

  it("subscribes members to chat and records circle presence", async () => {
    const { gateway, deps } = makeGateway();
    const socket = makeSocket();
    socket.data.userId = 1;
    deps.circleAccess.resolve.mockResolvedValue({ kind: "member" });

    await gateway.subscribe(socket as any, { channel: "ChatChannel", id: 2 });

    expect(socket.join).toHaveBeenCalledWith("chat:2");
    expect(deps.prisma.chatPresenceSession.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { room_id_connection_id: { room_id: 2, connection_id: "socket-1" } },
      }),
    );
    expect(deps.realtime.emit).toHaveBeenCalledWith(
      "ChatChannel",
      "chat:2",
      expect.objectContaining({ type: "presence", room_id: 2, present_user_ids: [1] }),
    );
  });

  it("subscribes admitted and porosity visitors to chat through the shared circle resolver", async () => {
    const { gateway, deps } = makeGateway();
    const socket = makeSocket();
    socket.data.userId = 1;
    deps.circleAccess.resolve.mockResolvedValue({ kind: "visitor", source: "knock" });

    await gateway.subscribe(socket as any, { channel: "ChatChannel", id: 2 });

    expect(deps.circleAccess.resolve).toHaveBeenCalledWith(2, 1);
    expect(socket.join).toHaveBeenCalledWith("chat:2");
    expect(deps.prisma.chatPresenceSession.upsert).toHaveBeenCalled();
  });

  it("subscribes a visitor to the latest published post when the square pointer is missing", async () => {
    const { gateway, deps } = makeGateway();
    const socket = makeSocket();
    socket.data.userId = 1;
    deps.circleAccess.resolve.mockResolvedValue({ kind: "visitor", source: "porosity" });
    deps.prisma.entry.findUnique.mockResolvedValue({
      id: 1,
      status: "published",
      room_id: 2,
      square: { id: 9, room_id: 2, current_entry_id: null },
    });
    deps.circleAccess.canReadPublishedPostWithRoomHistory.mockResolvedValue(true);

    await gateway.subscribe(socket as any, { channel: "EntryChannel", id: 1 });

    expect(socket.join).toHaveBeenCalledWith("entry:1");
  });

  it("rechecks access on repeated subscriptions", async () => {
    const { gateway, deps } = makeGateway();
    const socket = makeSocket();
    socket.data.userId = 1;
    deps.circleAccess.resolve.mockResolvedValue({ kind: "member" });

    await gateway.subscribe(socket as any, { channel: "ChatChannel", id: 2 });
    deps.circleAccess.resolve.mockResolvedValue(null);
    await gateway.subscribe(socket as any, { channel: "ChatChannel", id: 2 });

    expect(socket.join).toHaveBeenCalledTimes(1);
    expect(deps.circleAccess.resolve).toHaveBeenCalledTimes(2);
  });

  it("closes presence after access expires without renewing a visit", async () => {
    const { gateway, deps } = makeGateway();
    const socket = makeSocket();
    socket.data.userId = 1;
    socket.data.chatCircleIds = [2];
    deps.circleAccess.resolve.mockResolvedValue(null);
    await gateway.refreshChatPresence(socket as any, { id: 2 });
    expect(socket.leave).toHaveBeenCalledWith("chat:2");
    expect(socket.data.chatCircleIds).toEqual([]);
    expect(deps.prisma.chatPresenceSession.updateMany).toHaveBeenCalledWith({
      where: { room_id: 2, connection_id: socket.id, user_id: 1, left_at: null },
      data: { left_at: expect.any(Date), last_seen_at: expect.any(Date) },
    });
  });

  it("unsubscribes from channels", () => {
    const { gateway } = makeGateway();
    const socket = makeSocket();
    socket.data.userId = 1;

    gateway.unsubscribe(socket as any, { channel: "EntryChannel", id: 1 });
    gateway.unsubscribe(socket as any, { channel: "NotificationChannel" });

    expect(socket.leave).toHaveBeenCalledWith("entry:1");
    expect(socket.leave).toHaveBeenCalledWith("notification:1");
  });

});
