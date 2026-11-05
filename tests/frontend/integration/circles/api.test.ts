import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createRoom,
  fetchRoom,
  fetchRoomFirstEntryPrompts,
  fetchRoomMembers,
  updateRoom,
  updateRoomFirstEntryPrompts,
} from "../../../../frontend/src/lib/api/rooms";
import { ApiClient } from "../../../../frontend/site/lib/api/client";

describe("communities api", () => {
  const client = Object.assign(new ApiClient(), {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
  });

  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("fetches a room by id", async () => {
    client.get.mockResolvedValue({ id: 1 });

    await fetchRoom(client, 1);

    expect(client.get).toHaveBeenCalledWith("/v2/rooms/1");
  });

  it("fetches room members by id", async () => {
    client.get.mockResolvedValue({ members: [] });

    await fetchRoomMembers(client, 1);

    expect(client.get).toHaveBeenCalledWith("/v2/rooms/1/members");
  });

  it("fetches first-post prompt settings by room id", async () => {
    client.get.mockResolvedValue({ members: [] });

    await fetchRoomFirstEntryPrompts(client, 1);

    expect(client.get).toHaveBeenCalledWith("/v2/rooms/1/first-entry-prompts");
  });

  it("creates a room with multipart data", async () => {
    const file = new File(["content"], "logo.png", { type: "image/png" });
    client.post.mockResolvedValue({ id: 2 });

    await createRoom(client, { name: "New Club", avatar: file });

    const [path, form] = client.post.mock.calls[0];
    expect(path).toBe("/v2/rooms");
    expect(form).toBeInstanceOf(FormData);
    expect((form as FormData).get("room[name]")).toBe("New Club");
    expect((form as FormData).get("room[avatar]")).toBe(file);
  });

  it("updates a room and supports avatar removal", async () => {
    client.patch.mockResolvedValue({ id: 3 });

    await updateRoom(client, 3, { name: "Renamed", remove_avatar: true });

    const [path, form] = client.patch.mock.calls[0];
    expect(path).toBe("/v2/rooms/3");
    expect((form as FormData).get("room[name]")).toBe("Renamed");
    expect((form as FormData).get("room[remove_avatar]")).toBe("true");
  });

  it("updates first-post prompt settings as json", async () => {
    client.patch.mockResolvedValue({ members: [] });

    await updateRoomFirstEntryPrompts(client, 3, {
      room_prompt: "Post one thing.",
      member_prompts: [{ membership_id: 1, prompt: null }],
    });

    expect(client.patch).toHaveBeenCalledWith("/v2/rooms/3/first-entry-prompts", {
      room_prompt: "Post one thing.",
      member_prompts: [{ membership_id: 1, prompt: null }],
    });
  });
});
