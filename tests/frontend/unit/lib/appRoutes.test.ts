import { APP_ROOT_PATH, appPath, appRoutes } from "../../../../frontend/src/lib/appRoutes";

describe("appRoutes", () => {
  it("normalizes signed-in paths under /app exactly once", () => {
    expect(appPath()).toBe(APP_ROOT_PATH);
    expect(appPath("entries/post-1")).toBe("/app/entries/post-1");
    expect(appPath("/entries/post-1")).toBe("/app/entries/post-1");
    expect(appPath("/app/entries/post-1")).toBe("/app/entries/post-1");
    expect(appPath("/app/app/entries/post-1")).toBe("/app/entries/post-1");
    expect(appPath("?boardId=7")).toBe("/app?boardId=7");
  });

  it("builds explicit app urls for onboarding and community routes", () => {
    expect(appRoutes.profile()).toBe("/app/profile");
    expect(appRoutes.userOnboarding({ roomId: 10 })).toBe(
      "/app/user/new?roomId=10",
    );
    expect(appRoutes.roomProfile(42)).toBe("/app/rooms/42/profile");
    expect(appRoutes.rooms()).toBe("/app/rooms");
    expect(appRoutes.roomFirstEntryPrompt(42)).toBe("/app/rooms/42/first-entry-prompt");
    expect(appRoutes.roomNotes(42)).toBe("/app/rooms/42/notes");
    expect(appRoutes.roomNoteNew(42)).toBe("/app/rooms/42/notes/new");
    expect(appRoutes.roomInvites(42)).toBe("/app/rooms/42/settings#invites");
    expect(appRoutes.roomMembers(42)).toBe("/app/rooms/42#members");
    expect(appRoutes.roomRounds(42)).toBe("/app/rooms/42/rounds");
    expect(appRoutes.roomAdjacentRooms(42)).toBe("/app/rooms/42/adjacent-rooms");
    expect(appRoutes.roomChatAt(42, 11)).toBe("/app/rooms/42/chat#chat-11");
    expect(appRoutes.roomRoundNew(22)).toBe("/app/rooms/22/rounds/new");
    expect(appRoutes.round(9)).toBe("/app/rounds/9");
    expect(appRoutes.roundEdit(9)).toBe("/app/rounds/9/edit");
    expect(appRoutes.roomMember(22, 5)).toBe("/app/rooms/22/members/5");
  });
});

it("keeps current Round destinations through sign-in and rejects retired containers", async () => {
  const { safeRoomReturn } = await import("../../../../frontend/src/lib/roomLinks");
  for (const path of [appRoutes.round(9), appRoutes.roundEdit(9), appRoutes.roomRoundNew(22), appRoutes.roomRoundNew(22, "feedback"), "/app/rounds/9?contribution=cover"]) expect(safeRoomReturn(path)).toBe(path);
  for (const path of ["/app/board/22", "/app/board/22/activities/9", "/app/square/5", "/app/square/5/new-post", "/app/new-entry?square_id=5", "/app/rounds/9?next=https://example.com"]) expect(safeRoomReturn(path)).toBe("/app");
});
