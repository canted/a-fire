import useSWRInfinite from "swr/infinite";
import useSWRMutation from "swr/mutation";
import { useSWRConfig } from "swr";
import {
  fetchNotices,
  markNoticesSeen,
  markAllContentSeen,
} from "../lib/api/notices";
import type { Notice, NoticesPayload } from "../lib/api/noticeTypes";
import { client } from "../lib/api";
export function useNotices() {
  const query = useSWRInfinite(
    (index: number, previous: NoticesPayload | null) =>
      index && !previous?.nextCursor
        ? null
        : ["notification-inbox", index ? previous!.nextCursor : null],
    ([, cursor]: [string, string | null]) => fetchNotices(client, { cursor }),
    { refreshInterval: 5000, revalidateFirstPage: true },
  );
  const { mutate } = useSWRConfig();
  const seen = useSWRMutation(
    "notices-seen",
    async (_, { arg }: { arg: Notice | "all" }) => {
      // Chat acknowledgement belongs to actual row exposure in the Chat owner.
      if (arg !== "all" && arg.type === "chat") return;
      if (arg === "all") await markAllContentSeen(client);
      else await markNoticesSeen(client, arg.bundledNoticeIds ?? [arg.id]);
      await query.mutate();
      void mutate(
        (key) =>
          Array.isArray(key) &&
          ["unseen-count", "home"].includes(String(key[0])),
      ).catch(() => {});
    },
  );
  const items = [
    ...new Map(
      (query.data || [])
        .flatMap((page) => page.items)
        .map((item) => [item.id, item]),
    ).values(),
  ];
  return {
    query,
    items,
    busy: seen.isMutating,
    hasMore: Boolean(query.data?.at(-1)?.nextCursor),
    mark(arg: Notice | "all") {
      return seen.trigger(arg).then(() => {});
    },
  };
}
