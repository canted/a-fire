import type { RoomParticipationPage } from "./api/rounds";

export function roomParticipationPageKey(room: string, identity: string | undefined, index: number, previous: RoomParticipationPage | null) {
  return !identity || (index > 0 && !previous?.nextCursor)
    ? null
    : ["room-participation", room, identity, index ? previous!.nextCursor : null] as const;
}

export function roomParticipationItems(pages: RoomParticipationPage[] | undefined, allowed: boolean) {
  return allowed ? [...new Map((pages ?? []).flatMap(page => page.items).map(item => [item.id, item])).values()] : [];
}
