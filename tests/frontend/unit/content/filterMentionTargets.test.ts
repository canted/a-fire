import { filterMentionTargets } from "../../../../frontend/src/lib/mentionTargets";
import type { MentionTarget } from "../../../../frontend/src/lib/api/mentions";

const targets: MentionTarget[] = [
  { id: "page:2", targetType: "note", targetId: "2", label: "Roadmap", subtitle: "Note", avatarUrl: null, icon: null, href: "/app/note/2" },
  { id: "user:1", targetType: "user", targetId: "1", label: "Ada", subtitle: "User", avatarUrl: null, icon: null, href: "/app/square/1" },
  { id: "circle:7", targetType: "room", targetId: "7", label: "Campfire", subtitle: "Room", avatarUrl: null, icon: null, href: "/app/rooms/7" },
  { id: "page:3", targetType: "note", targetId: "3", label: "Ideas", subtitle: "Note", avatarUrl: null, icon: null, href: "/app/note/3" },
  { id: "activity:4", targetType: "round", targetId: "4", label: "Summer Making", subtitle: "Round", avatarUrl: null, icon: null, href: "/app/board/5/activities/4" },
];

describe("filterMentionTargets", () => {
  it("prioritizes users, notes, and rounds before optional room matches", () => {
    expect(filterMentionTargets(targets, "")).toEqual([targets[1], targets[0], targets[3], targets[4], targets[2]]);
    expect(filterMentionTargets(targets, "road")).toEqual([targets[0]]);
    expect(filterMentionTargets(targets, "round")).toEqual([targets[4]]);
  });

  it("caps results", () => {
    expect(filterMentionTargets(targets, "", 2)).toHaveLength(2);
  });

  it("keeps every available target type discoverable before a query is entered", () => {
    const manyUsers: MentionTarget[] = Array.from({ length: 8 }, (_, index) => ({
      id: `user:${index + 10}`,
      targetType: "user",
      targetId: String(index + 10),
      label: `User ${index + 1}`,
      subtitle: "User",
      avatarUrl: null,
      icon: null,
      href: `/app/square/${index + 10}`,
    }));

    const results = filterMentionTargets([...manyUsers, targets[0], targets[4], targets[2]], "", 8);

    expect(results).toHaveLength(8);
    expect(results.map((target) => target.targetType)).toEqual([
      "user",
      "user",
      "user",
      "user",
      "user",
      "note",
      "round",
      "room",
    ]);
  });
});
