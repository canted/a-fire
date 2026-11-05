import { describe, expect, it, vi, beforeEach } from "vitest";
import { createInvite, expireInvite, fetchInviteSuggestions, fetchInvites, resendInvite } from "../../../../frontend/src/lib/api/invites";
import { ApiClient } from "../../../../frontend/site/lib/api/client";

describe("invites api", () => {
  const client = Object.assign(new ApiClient(), {
    get: vi.fn(),
    post: vi.fn(),
  });

  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("builds invite query params", async () => {
    client.get.mockResolvedValue({ invites: [], permissions: { new_room_invite_allowed: false } });

    await fetchInvites(client, { roomId: "5", status: "expired", search: "team" });

    expect(client.get).toHaveBeenCalledWith("/v1/invites?room_id=5&status=expired&search=team");
  });

  it("creates a room invite", async () => {
    client.post.mockResolvedValue({ id: 1 });

    await createInvite(client, { email: "a@example.com", invite_type: "room_invite", room_id: 9 });

    expect(client.post).toHaveBeenCalledWith("/v1/invites", {
      invite: { email: "a@example.com", invite_type: "room_invite", room_id: 9 },
    });
  });

  it("creates a suggested member invite", async () => {
    client.post.mockResolvedValue({ id: 1 });

    await createInvite(client, { invitee_membership_id: 10, invite_type: "room_invite", room_id: 9 });

    expect(client.post).toHaveBeenCalledWith("/v1/invites", {
      invite: { invitee_membership_id: 10, invite_type: "room_invite", room_id: 9 },
    });
  });

  it("fetches invite suggestions for a room", async () => {
    client.get.mockResolvedValue({ suggestions: [] });

    await fetchInviteSuggestions(client, 5, "jas");

    expect(client.get).toHaveBeenCalledWith("/v1/invites/suggestions?room_id=5&q=jas");
  });

  it("expires an invite", async () => {
    client.post.mockResolvedValue({ id: 2 });

    await expireInvite(client, 2);

    expect(client.post).toHaveBeenCalledWith("/v1/invites/2/expire");
  });

  it("resends an invite", async () => {
    client.post.mockResolvedValue({ id: 3 });

    await resendInvite(client, 3);

    expect(client.post).toHaveBeenCalledWith("/v1/invites/3/resend");
  });
});
