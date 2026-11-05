import { vi } from "vitest";
import {
  acceptRoomMemberInvitation,
  roomAccess,
  createRoomMemberInvitation,
  createRoom,
  createSideRoom,
  deleteRoom,
  deleteRoomMember,
  fetchRoomJoinRequests,
  fetchRoomKnocks,
  fetchRoomMembers,
  fetchSideRooms,
  joinRoom,
  normalizeRoomPorosity,
  requestRoomKnock,
  suggestRoomKnock,
  updateRoomJoinRequest,
  updateRoomKnock,
  updateRoom,
} from "../../../../frontend/src/lib/api/rooms";

const client = {
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  delete: vi.fn(),
};

describe("communities api", () => {
  beforeEach(() => {
    client.get.mockReset();
    client.post.mockReset();
    client.patch.mockReset();
    client.delete.mockReset();
  });

  it("sends room porosity when creating a room", async () => {
    client.post.mockResolvedValueOnce({ id: 4, name: "Studio", owner_id: 1, porosity: "masked" });

    await createRoom(client as never, { name: "Studio", porosity: "masked" });

    const formData = client.post.mock.calls[0][1] as FormData;
    expect(client.post.mock.calls[0][0]).toBe("/v2/rooms");
    expect(formData.get("room[name]")).toBe("Studio");
    expect(formData.get("room[porosity]")).toBe("masked");
  });

  it("sends room porosity when updating a room", async () => {
    client.patch.mockResolvedValueOnce({ id: 4, name: "Studio", owner_id: 1, porosity: "open" });

    await updateRoom(client as never, 4, { porosity: "open" });

    const formData = client.patch.mock.calls[0][1] as FormData;
    expect(client.patch.mock.calls[0][0]).toBe("/v2/rooms/4");
    expect(formData.get("room[porosity]")).toBe("open");
  });

  it("fetches community members", async () => {
    client.get.mockResolvedValueOnce({ members: [] });

    await fetchRoomMembers(client as never, 4);

    expect(client.get).toHaveBeenCalledWith("/v2/rooms/4/members");
  });

  it("uses the neutral Open label for open rooms", async () => {
    client.get.mockResolvedValueOnce({
      parent: null,
      can_create: true,
      adjacent_rooms: [{ id: 8, porosity: "open", porosity_label: "Join freely" }],
    });

    const result = await fetchSideRooms(client as never, 4);

    expect(result.adjacent_rooms[0]?.porosity_label).toBe("Open");
  });

  it("uses the v2 side-room and access endpoints", async () => {
    client.get
      .mockResolvedValueOnce({ parent: null, adjacent_rooms: [], can_create: true })
      .mockResolvedValueOnce({ join_requests: [] })
      .mockResolvedValueOnce({ knocks: [] });
    client.post
      .mockResolvedValueOnce({
        room: { id: 6, name: "Ada", owner_id: 1, porosity: "masked" },
        invitations: [],
      })
      .mockResolvedValueOnce({ state: "requested" })
      .mockResolvedValueOnce({ invitation: {} })
      .mockResolvedValueOnce({ invitation: {} })
      .mockResolvedValueOnce({ state: "suggested" })
      .mockResolvedValueOnce({ state: "requested" });
    client.patch
      .mockResolvedValueOnce({ join_request: {} })
      .mockResolvedValueOnce({ knock: {} });

    await fetchSideRooms(client as never, 4);
    await fetchRoomJoinRequests(client as never, 4);
    await fetchRoomKnocks(client as never, 4);
    await createSideRoom(client as never, 4, { name: "Ada", user_ids: [9] });
    await joinRoom(client as never, 6);
    await createRoomMemberInvitation(client as never, 6, 9);
    await acceptRoomMemberInvitation(client as never, 6, 12);
    await suggestRoomKnock(client as never, 6, 9);
    await requestRoomKnock(client as never, 6);
    await updateRoomJoinRequest(client as never, 4, 20, "declined");
    await updateRoomKnock(client as never, 4, 21, "admitted");

    expect(client.get).toHaveBeenNthCalledWith(1, "/v2/rooms/4/adjacent-rooms");
    expect(client.get).toHaveBeenNthCalledWith(2, "/v2/rooms/4/join-requests");
    expect(client.get).toHaveBeenNthCalledWith(3, "/v2/rooms/4/knocks");
    expect(client.post).toHaveBeenNthCalledWith(1, "/v2/rooms/4/adjacent-rooms", { name: "Ada", user_ids: [9] });
    expect(client.post).toHaveBeenNthCalledWith(2, "/v2/rooms/6/join");
    expect(client.post).toHaveBeenNthCalledWith(3, "/v2/rooms/6/member-invitations", { user_id: 9 });
    expect(client.post).toHaveBeenNthCalledWith(4, "/v2/rooms/6/member-invitations/12/accept");
    expect(client.post).toHaveBeenNthCalledWith(5, "/v2/rooms/6/knock-suggestions", { user_id: 9 });
    expect(client.post).toHaveBeenNthCalledWith(6, "/v2/rooms/6/knocks");
    expect(client.patch).toHaveBeenNthCalledWith(1, "/v2/rooms/4/join-requests/20", { status: "declined" });
    expect(client.patch).toHaveBeenNthCalledWith(2, "/v2/rooms/4/knocks/21", { status: "admitted" });
  });

  it("deletes a member from a community", async () => {
    client.delete.mockResolvedValueOnce({ success: true, member_id: 9 });

    const result = await deleteRoomMember(client as never, 4, 9);

    expect(client.delete).toHaveBeenCalledWith("/v2/rooms/4/members/9");
    expect(result).toEqual({ success: true, member_id: 9 });
  });

  it("deletes a room", async () => {
    client.delete.mockResolvedValueOnce({ success: true, room_id: 4 });

    const result = await deleteRoom(client as never, 4);

    expect(client.delete).toHaveBeenCalledWith("/v2/rooms/4");
    expect(result).toEqual({ success: true, room_id: 4 });
  });

  it("normalizes room porosity values", () => {
    expect(normalizeRoomPorosity("masked")).toBe("masked");
    expect(normalizeRoomPorosity("closed")).toBe("closed");
    expect(normalizeRoomPorosity("unexpected")).toBe("open");
    expect(normalizeRoomPorosity(null)).toBe("open");
  });

  it("fails closed when room access is absent", () => {
    expect(roomAccess()).toEqual({
      kind: "visitor",
      can_manage: false,
      can_create_adjacent_room: false,
      can_view_notes: false,
      can_write_wall: false,
      can_participate_rounds: false,
    });
  });
});
