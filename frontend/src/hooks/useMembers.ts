import useSWR from "swr";
import useSWRInfinite from "swr/infinite";
import useSWRMutation from "swr/mutation";
import {
  fetchMemberProfile,
  nextMemberHistoryPage,
  type MemberProfileTarget,
  type MemberEntriesPayload,
} from "../lib/api/members";
import {
  fetchRoomMemberIntroductions,
  markIntroductionsSeen,
  retractIntroduction,
} from "../lib/api/introductions";
import { fetchRoom } from "../lib/api/rooms";
import { client } from "../lib/api";
import { appRoutes } from "../lib/appRoutes";
export function useMemberProfile(target: MemberProfileTarget) {
  const key = ["room-member-posts", target.roomId, target.memberUserId];
  const profilePath = appRoutes.roomMember(target.roomId, target.memberUserId);
  const query = useSWRInfinite(
    (index: number, previous: MemberEntriesPayload | null) =>
      index && (!previous || !nextMemberHistoryPage(previous))
        ? null
        : [...key, index ? nextMemberHistoryPage(previous!) : ""],
    (cacheKey: Array<string | number>) =>
      fetchMemberProfile(client, target, cacheKey.at(-1) as string | number),
    { refreshInterval: 15000, revalidateFirstPage: true },
  );
  const profile = !query.error ? query.data?.[0] : undefined;
  const roomQuery = useSWR(
    profile?.roomId ? ["managed-room", profile.roomId] : null,
    () => fetchRoom(client, profile!.roomId!),
  );
  return {
    query,
    profilePath,
    profile,
    room: roomQuery,
    entries: [
      ...new Map(
        (query.data ?? [])
          .flatMap((page) => page.entries)
          .map((post) => [post.id, post]),
      ).values(),
    ],
    hasMore: Boolean(query.data?.at(-1) && nextMemberHistoryPage(query.data.at(-1)!)),
  };
}
export function useMemberIntroductions(target: MemberProfileTarget, highlighted?: string) {
  const key = ["room-member-introductions", target.roomId, target.memberUserId];
  const profilePath = appRoutes.roomMember(target.roomId, target.memberUserId);
  const pages = useSWRInfinite(
    (index, previous) => index && !previous?.nextCursor ? null : [...key, highlighted ?? '', index ? previous.nextCursor : ''],
    (cacheKey: string[]) => {
      const page = { cursor: cacheKey.at(-1) || undefined, target: highlighted };
      return fetchRoomMemberIntroductions(client, target.roomId, target.memberUserId, page);
    },
  );
  const first = pages.data?.[0];
  const query = { ...pages, data: first ? { ...first, introductions: [...new Map(pages.data!.flatMap(page => page.introductions).map(item => [item.id, item])).values()] } : undefined };
  const hasMore = Boolean(pages.data?.at(-1)?.nextCursor);
  const roomId = !query.error ? query.data?.roomId : undefined;
  const roomQuery = useSWR(
    roomId ? ["managed-room", roomId] : null,
    () => fetchRoom(client, roomId!),
  );
  const action = useSWRMutation(
    ["member-introduction-action", ...key],
    async (_, { arg }: { arg: { kind: "seen" | "retract"; id: string } }) => {
      if (arg.kind === "seen") await markIntroductionsSeen(client, [arg.id]);
      else await retractIntroduction(client, arg.id);
      await query.mutate();
    },
  );
  return { query, room: roomQuery, action, profilePath, hasMore, loadMore: () => pages.setSize(pages.size + 1) };
}
