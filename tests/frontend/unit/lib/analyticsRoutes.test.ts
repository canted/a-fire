import { describe, expect, it } from "vitest";
import { resolveAnalyticsRoute } from "../../../../frontend/site/lib/analyticsRoutes";

describe("analytics route resolver", () => {
  it("resolves route labels and safe params", () => {
    expect(resolveAnalyticsRoute("/auth/invite/private-token")).toEqual({
      surface: "site",
      route_name: "auth_accept_invite",
      room_id: null,
      board_id: null,
      square_id: null,
      entry_id: null,
      page_id: null,
      note_id: null,
    });

    expect(resolveAnalyticsRoute("/app/entries/42/new-reply")).toEqual({
      surface: "app",
      route_name: "reply_composer",
      room_id: null,
      board_id: null,
      square_id: null,
      entry_id: "42",
      page_id: null,
      note_id: null,
    });

    expect(resolveAnalyticsRoute("/app/user/new", "?communityId=5&boardId=9")).toMatchObject({
      route_name: "user_onboarding",
      room_id: "5",
      board_id: "9",
    });
  });
});
