import { revalidateProjectLists } from "./projectListCache";
import { fetchRoomMessages } from "../lib/api/room";
import { useProjects } from "./useProjects";
import { useRef } from "react";
import useSWRInfinite from "swr/infinite";
import useSWR, { useSWRConfig } from "swr";
import useSWRMutation from "swr/mutation";
import {
  eligibleSaveProjects,
  keepChatMessage,
} from "../lib/api/projects";
import {
  fetchChatReplies,
  fetchThreadMessage,
} from "../lib/api/chatThread";
import { client } from "../lib/api";

export function useThreadMessage(room: string, message: string) {
  return useSWR(["thread-message", room, message], () =>
    fetchThreadMessage(client, room, message),
  );
}
export function useThreadReplies(room: string, message: string) {
  const query = useSWRInfinite(
    (index, previous) => index > 0 && previous?.next_cursor == null ? null : ["thread-replies", room, message, index === 0 ? 0 : previous.next_cursor],
    ([, roomId, messageId, after]: [string, string, string, number]) => fetchChatReplies(client, roomId, messageId, after || undefined),
  );
  const pages = query.data ?? [];
  return { ...query, data: pages.length ? { replies: pages.flatMap(page => page.replies) } : undefined,
    hasNextPage: pages.length > 0 && pages[pages.length - 1].next_cursor != null,
    fetchNextPage: () => query.setSize(size => size + 1) };

}
export function useChatSave(message: string) {
  const projects = useProjects();
  const { mutate, cache } = useSWRConfig();
  const flight = useRef<Promise<unknown> | null>(null);
  const save = useSWRMutation(
    ["chat-save", message],
    async (_, { arg }: { arg: number }) => {
      const result = await keepChatMessage(client, arg, message);
      // Saving succeeded even if a later cache refresh cannot reach the server.
      void revalidateProjectLists(cache).catch(() => {});
      void mutate(
        (key) =>
          key === "projects" ||
          key === "home" ||
          (Array.isArray(key) && (String(key[0]).startsWith("project") || key[0] === "board" || key[0] === "room-home")),
      ).catch(() => {});
      return result;
    },
  );
  return {
    projects,
    eligible: eligibleSaveProjects(projects.data?.projects ?? []),
    save,
    submit(project: number) {
      if (flight.current) return flight.current;
      const pending = save.trigger(project).finally(() => {
        flight.current = null;
      });
      flight.current = pending;
      return pending;
    },
  };
}

export function useThreadContext(room: string) {
  return useSWR(["thread-context", room], () =>
    fetchRoomMessages(client, room, { limit: 50 }),
  );
}

/** Ephemeral success feedback shared by the picker and its retained Room. */
export function useChatSaveFeedback(room: string) {
  return useSWR<string | null>(["chat-save-feedback", room], null, {
    fallbackData: null,
  });
}
