import { revalidateProjectLists } from "./projectListCache";
import { useSWRConfig } from "swr";
import useSWRMutation from "swr/mutation";
import { useProjects } from "./useProjects";
import { associateEntryProject } from "../lib/api/projectEntries";
import { useEntryQuery } from "./useEntryQuery";
import { client } from "../lib/api";

/** Assign the original post; saving a Chat copy remains owned by useChatSave. */
export function useEntryProject(postId: string) {
  const post = useEntryQuery(postId);
  const room = !post.error ? post.data?.entry.room_id : undefined;
  const projects = useProjects(room ? String(room) : undefined, Boolean(room));
  const { mutate, cache } = useSWRConfig();
  const assignment = useSWRMutation(
    ["post-project", postId],
    async (_, { arg }: { arg: number | null }) => {
      const result = await associateEntryProject(client, postId, arg);
      void revalidateProjectLists(cache).catch(() => {});
      void mutate(
        (key) =>
          key === "projects" ||
          key === "home" ||
          (Array.isArray(key) &&
            [
              "post",
              "projects",
              "project",
              "thread-message",
              "thread-context",
            ].includes(String(key[0]))),
      ).catch(() => {});
      return result;
    },
  );
  return { entry: post, projects, assignment };
}
