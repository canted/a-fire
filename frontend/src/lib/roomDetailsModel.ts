import type { RoomMember, SideRoom } from "./api/rooms";

export function memberId(member: RoomMember) { return member.user_id ?? member.id; }
export function memberTitle(member: RoomMember) { return member.display_username || "Member"; }
export function memberLocation(member: RoomMember) {
  return member.presence?.is_here ? "Here now" : member.location?.name ? `in ${member.location.name}` : "Away";
}
export function orderMembers(members: RoomMember[], roomId: string | number) {
  return [...members].sort((left, right) => {
    const leftRank = memberLocationRank(left, roomId);
    const rightRank = memberLocationRank(right, roomId);
    if (leftRank !== rightRank) return leftRank - rightRank;
    return memberTitle(left).localeCompare(memberTitle(right));
  });
}
function memberLocationRank(member: RoomMember, roomId: string | number) {
  if (member.presence?.is_here) return 0;
  if (member.location?.room_id !== null && String(member.location?.room_id) === String(roomId)) return 1;
  return 2;
}
export function roomTitle(room: Pick<SideRoom, "name">) { return room.name?.trim() || "Untitled side room"; }
export function introductionPairKey(firstUserId: string | number, secondUserId: string | number) {
  return [String(firstUserId), String(secondUserId)].sort().join(":");
}
export function formatNames(names: string[]) {
  if (names.length === 0) return "No one";
  return new Intl.ListFormat("en", { style: "long", type: "conjunction" }).format(names);
}
