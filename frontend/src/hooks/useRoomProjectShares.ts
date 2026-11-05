import useSWRInfinite from "swr/infinite";
import { client } from "../lib/api";
import type { EntryShow } from "../lib/api/entries";

type SharePage = {
  project: { name: string };
  room: EntryShow["room"];
  items: EntryShow[];
  nextCursor: number | null;
};

export function useRoomProjectShares(id: string) {
  const query = useSWRInfinite<SharePage>(
    (index, previous: SharePage | null) => index && !previous?.nextCursor ? null
      : ["room-project-shares", id, index ? previous!.nextCursor : null],
    ([, entryId, cursor]) => client.get<SharePage>(
      `/v1/entries/${entryId}/project-shares${cursor ? `?cursor=${cursor}` : ""}`),
  );
  return { ...query, items: query.data?.flatMap(page => page.items) ?? [],
    hasMore: Boolean(query.data?.at(-1)?.nextCursor),
    loadMore: () => query.setSize(size => size + 1) };
}
