import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import useSWR, { useSWRConfig, unstable_serialize } from "swr";
import useSWRInfinite from "swr/infinite";
import useSWRMutation from "swr/mutation";
import {
  fetchRoomMessages,
  fetchLiveRoomPage,
  type LiveRoomPage,
  mergeRoomMessages,
  sendRoomMessage,
  type Room,
  type RoomPage,
} from "../lib/api/room";
import { scopedDrafts } from "../lib/scopedDrafts";
import { client } from "../lib/api";
import { useSession } from "./useSession";
import { useRoomSubscription } from "./useRoomSubscription";
import type { TiptapDoc } from "../lib/tiptap";
import { emptyRoomDraft, type RoomDraft } from "../lib/chatComposition";

const EMPTY_PAGES: RoomPage[] = [];
export function useRooms() {
  return useSWR("rooms", () => client.get<{ rooms: Room[] }>("/v2/rooms"));
}
export function useRoom(id: string) {
  const { cache } = useSWRConfig();
  const liveKey = ["room", id];
  const live = useSWR<LiveRoomPage>(
    liveKey,
    () =>
      fetchLiveRoomPage(
        client,
        id,
        cache.get(unstable_serialize(liveKey))?.data as
          | LiveRoomPage
          | undefined,
      ),
    // The Room subscription owns focus/reconnect catch-up and ordering after join.
    { revalidateOnFocus: false, revalidateOnReconnect: false },
  );
  // Historical pages only load on request; each request is bounded to 50 messages.
  const history = useSWRInfinite<RoomPage>(
    (index, previous) => {
      const cursor =
        index === 0 ? live.data?.historyCursor : previous?.next_cursor;
      return cursor != null && live.data?.viewer_access?.can_paginate !== false
        ? ["room-history", id, cursor]
        : null;
    },
    ([, , cursor]: [string, string, number]) =>
      fetchRoomMessages(client, id, { before: cursor, limit: 50 }),
    { initialSize: 0, revalidateFirstPage: false, persistSize: true },
  );
  const connection = useRoomSubscription(id, history.mutate);
  // An in-flight history request can finish after membership is downgraded and
  // cache the visitor window. Its null cursor must not end a restored member's
  // history. Refresh that page under current access before using it again.
  const staleVisitorHistory =
    live.data?.viewer_access?.can_paginate === true &&
    history.data?.some((page) => page.viewer_access?.kind === "visitor");
  useEffect(() => {
    if (staleVisitorHistory) void history.mutate().catch(() => {});
  }, [staleVisitorHistory, history.mutate]);
  const pages = useMemo(
    () =>
      live.data?.viewer_access?.can_paginate === false
        ? EMPTY_PAGES
        : (history.data?.filter(
            (page) => page.viewer_access?.kind !== "visitor",
          ) ?? EMPTY_PAGES),
    [live.data?.viewer_access?.can_paginate, history.data],
  );
  const messages = useMemo(
    () =>
      mergeRoomMessages([
        ...pages.slice().reverse(),
        ...(live.data ? [live.data] : []),
      ]),
    [pages, live.data],
  );
  const send = useSWRMutation(
    ["room-send", id],
    async (
      _,
      {
        arg,
      }: {
        arg: {
          body: string;
          content?: TiptapDoc;
          clientNonce?: string;
          draftId?: number;
        };
      },
    ) => {
      const message = await sendRoomMessage(client, id, arg);
      await live.mutate(
        (previous) =>
          previous
            ? {
                ...previous,
                messages: mergeRoomMessages([
                  previous,
                  { messages: [message] },
                ]),
              }
            : previous,
        { revalidate: false },
      );
      return message;
    },
  );
  return {
    live,
    history,
    messages,
    send,
    connection,
    hasOlder:
      (pages.length
        ? pages[pages.length - 1].next_cursor
        : live.data?.historyCursor) != null &&
      live.data?.viewer_access?.can_paginate !== false,
    loadOlder: () => history.setSize((size) => size + 1),
  };
}

export function useRoomDraft(room: string, viewer?: number) {
  const { draftScope } = useSession();
  const store = useMemo(
    () =>
      scopedDrafts(draftScope, emptyRoomDraft, (value) =>
        Boolean(
          value.text.trim() ||
          value.prefix ||
          value.attachment ||
          value.pending ||
          value.staging ||
          value.operation,
        ),
      ),
    [draftScope],
  );
  const scope = `${viewer ?? "pending"}:${room}`;
  const subscribe = useCallback(
    (listener: () => void) => store.subscribe(scope, listener),
    [store, scope],
  );
  const snapshot = useCallback(() => store.read(scope), [store, scope]);
  const value = useSyncExternalStore(subscribe, snapshot, snapshot);
  return {
    ...value,
    read: () => store.read(scope),
    update(
      patch: Partial<RoomDraft> | ((current: RoomDraft) => Partial<RoomDraft>),
      notify = true,
    ) {
      const current = store.read(scope);
      store.write(
        scope,
        {
          ...current,
          ...(typeof patch === "function" ? patch(current) : patch),
        },
        notify,
      );
    },
  };
}
