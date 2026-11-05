import type { RoomHistoryPage } from "./api/rounds";

export function roomHistoryPageKey(room: string, access: "member" | "visitor" | undefined, index: number, previous: RoomHistoryPage | null) {
  return !access || (index > 0 && !previous?.nextCursor)
    ? null
    : ["room-history", room, access, index ? previous!.nextCursor : null] as const;
}

export function roomHistoryItems(pages: RoomHistoryPage[] | undefined, allowed: boolean) {
  return allowed ? [...new Map((pages ?? []).flatMap(page => page.items).map(item => [item.id, item])).values()] : [];
}
