import { fetchMentionTargets } from "../../../../frontend/src/lib/api/mentions";

const client = {
  get: async (path: string) => {
    expect(path).toBe("/v1/mentions?room_id=7");
    return {
      room_id: 7,
      targets: [
        {
          id: "user:1",
          target_type: "user",
          target_id: "1",
          label: "Ada",
          subtitle: "User",
          avatar_url: "/avatar",
          icon: null,
          href: "/app/square/9",
        },
      ],
    };
  },
};

describe("mentions api", () => {
  it("fetches and normalizes mention targets", async () => {
    const result = await fetchMentionTargets(client as never, 7);

    expect(result).toEqual({
      roomId: 7,
      targets: [
        {
          id: "user:1",
          targetType: "user",
          targetId: "1",
          label: "Ada",
          subtitle: "User",
          avatarUrl: "/avatar",
          icon: null,
          href: "/app/square/9",
        },
      ],
    });
  });
});
