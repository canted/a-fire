import type { MembershipIndexResponse } from "../../../frontend/src/lib/api/profile";
import type { ProjectSummary } from "../../../frontend/src/lib/api/projectEntries";

export const navigationMemberships: MembershipIndexResponse = {
  user: { id: 1, username: "Mira", profile_line: "Songs and field recordings", avatar_url: null },
  memberships: [
    { id: 1, room: { id: 7, name: "Evening Room" }, disabled: false, display_username: "Mira", notify: true },
    { id: 2, room: { id: 8, name: "A side room for long unfinished sketches and conversations" }, disabled: false, display_username: "Mira", notify: false },
  ],
};

export const navigationRooms = {
  rooms: [
    { id: "7", name: "Evening Room", owner_id: 1, canManage: true, porosity: "closed", },
    { id: "8", name: "A side room for long unfinished sketches and conversations", owner_id: 2, canManage: false, porosity: "masked", },
  ],
  currentRoom: null,
};

export const navigationProjects: ProjectSummary[] = [
  { id: 42, name: "Room Score", owner: { id: 1, username: "Mira" }, participants: [], pending_participants: [], rooms: [], viewer_participation: "owner", updated_at: "2026-10-12T12:00:00Z", icon_symbol: "projectAsterisk", icon_color: "orange" },
  { id: 43, name: "A long working title for songs and field recordings", owner: { id: 2, username: "Mara" }, participants: [], pending_participants: [], rooms: [], viewer_participation: "pending", updated_at: "2026-10-12T12:00:00Z", icon_symbol: "projectCross", icon_color: "purple" },
];
