import { useEffect, useRef } from "react";
import { randomUuid } from "../lib/randomId";
import useSWR, { useSWRConfig } from "swr";
import useSWRMutation from "swr/mutation";
import useSWRInfinite, { unstable_serialize } from "swr/infinite";
import { registrations } from "../lib/infiniteQueryRegistry";
import { fetchProjectListPage, projectListItems, type ProjectListPage } from "../lib/api/projects";
import { projectTimelineKey } from "../lib/projectTimeline";
import { revalidateProjectLists } from "./projectListCache";
import {
  moveProjectEntry,
  deleteProjectEntry,
  fetchProject,
  fetchProjectEntry,
  createProjectEntry,
  updateProjectEntry,
  respondToProjectInvitation,
  type ProjectEntry,
  type ProjectEntryInput,
} from "../lib/api/projectEntries";
import { client } from "../lib/api";

export function useProjects(room?: string, enabled = true) {
  const { cache, mutate } = useSWRConfig();
  const getKey = (index: number, previous: ProjectListPage | null) => !enabled || (index > 0 && !previous?.nextCursor) ? null
    : ["projects", room ?? null, "page", index ? previous!.nextCursor! : ""] as const;
  const query = useSWRInfinite(getKey, ([, roomId, , cursor]) => fetchProjectListPage(client, roomId ?? undefined, cursor),
    { revalidateAll: true, revalidateOnMount: true });
  useEffect(() => {
    if (!enabled) return;
    const entry = { queryKey: ["projects", room ?? null], cacheKey: unstable_serialize(getKey), revalidate: () => query.mutate(),
      update: (updater: unknown) => query.mutate(previous => {
        const next = (typeof updater === "function" ? updater(previous ? { pages: previous } : undefined) : updater) as { pages?: ProjectListPage[] } | undefined;
        let previousPage: ProjectListPage | null = null;
        (next?.pages ?? previous ?? []).forEach((page, index) => {
          const key = getKey(index, previousPage);
          if (key) void mutate(key, next ? page : undefined, false);
          previousPage = page;
        });
        return next?.pages;
      }, false) };
    const entries = registrations(cache);
    entries.add(entry);
    return () => { entries.delete(entry); };
  });
  return { ...query, data: enabled && !query.error && query.data ? { projects: projectListItems(query.data) } : undefined,
    hasMore: Boolean(enabled && !query.error && query.data?.at(-1)?.nextCursor),
    loadMore: () => query.setSize(size => size + 1) };
}
export function useProject(id?: string | number) {
  return useSWR(id ? ["project", String(id)] : null, () =>
    fetchProject(client, id!),
  );
}
export function useProjectEntryRead(projectId: string, entryId?: string) {
  return useSWR(entryId ? ["project-entry", projectId, entryId] : null,
    () => fetchProjectEntry(client, projectId, entryId!));
}
export function useProjectInvitation(id: string) {
  const { mutate, cache } = useSWRConfig();
  return useSWRMutation(
    ["project-invitation", id],
    async (_, { arg }: { arg: "accept" | "decline" }) => {
      const result = await respondToProjectInvitation(client, id, arg);
      if (arg === "decline")
        await mutate(
          (key) =>
            Array.isArray(key) &&
            ["project", "project-entry", "project-entry-draft"].includes(
              String(key[0]),
            ) &&
            String(key[1]) === id,
          undefined,
          { revalidate: false },
        );
      else await mutate(["project", id], result, { revalidate: false });
      void revalidateProjectLists(cache).catch(() => {});
      void mutate(
        (key) =>
          key === "projects" || (Array.isArray(key) && key[0] === "home"),
      ).catch(() => {});
      return result;
    },
  );
}

/** A new-entry visit allocates once; saving/focus must never create a second draft. */
export function useProjectEntry(
  projectId: string,
  entryId?: string,
  canCreate = false,
  requestKey?: string,
) {
  const visit = useRef(randomUuid()).current;
  const creationRequest = requestKey ?? visit;
  const opened = useRef<{ projectId: string; creationRequest: string; entry?: ProjectEntry }>({
    projectId, creationRequest,
  });
  if (opened.current.projectId !== projectId || opened.current.creationRequest !== creationRequest) opened.current = { projectId, creationRequest };
  const { mutate, cache } = useSWRConfig();
  const key = entryId
    ? ["project-entry", projectId, entryId]
    : ["project-entry-draft", projectId, creationRequest];
  const query = useSWR(
    entryId || canCreate ? key : null,
    () =>
      entryId
        ? fetchProjectEntry(client, projectId, entryId)
        : opened.current.entry
          ? Promise.resolve(opened.current.entry)
          : createProjectEntry(client, projectId, { fresh: true, request_key: creationRequest }).then(
              (entry) => {
                opened.current.entry = entry;
                return entry;
              },
            ),
    { revalidateOnFocus: false, revalidateOnReconnect: false },
  );
  const save = useSWRMutation(
    ["project-entry-save", projectId, entryId],
    async (_, { arg }: { arg: ProjectEntryInput }) => {
      const entry = query.data;
      if (!entry?.can_edit)
        throw new Error(
          "You can edit your own entries while you are a project member.",
        );
      const result = await updateProjectEntry(client, projectId, entry.id, arg);
      if (opened.current.entry?.id === result.id) opened.current.entry = result;
      await query.mutate(result, { revalidate: false });
      await mutate(["project-entry", projectId, String(result.id)], result, {
        revalidate: false,
      });
      // Page keys and the infinite aggregate are distinct SWR caches. Clear the
      // retained aggregate after persistence so navigation cannot reuse an older save.
      await Promise.all([undefined, String(result.id)].map(source => mutate(
        unstable_serialize((index, previous) => projectTimelineKey(projectId, true, source, index, previous)),
        undefined,
        { revalidate: true },
      )));
      void revalidateProjectLists(cache).catch(() => {});
      void mutate(
        (value) =>
          value === "projects" ||
          (Array.isArray(value) &&
            (value[0] === "home" ||
              (value[0] === "project" && String(value[1]) === projectId))),
      ).catch(() => {});
      return result;
    },
  );
  return { query, save };
}


/** Private originals stay in one Project; Room copies are independent. */
export function useProjectEntryManagement(projectId: string, entryId: number) {
  const { mutate, cache } = useSWRConfig();
  return useSWRMutation(["project-entry-management", projectId, entryId],
    async (_, { arg }: { arg: { destination: number | null; revision: number } }) => {
      const result = arg.destination === null
        ? await deleteProjectEntry(client, projectId, entryId, arg.revision)
        : await moveProjectEntry(client, projectId, entryId, arg.destination, arg.revision);
      const affected = [...new Set([projectId, ...(arg.destination === null ? [] : [String(arg.destination)])])];
      // Clear both infinite aggregates and individual pages, including entry-filtered timelines.
      await Promise.all(affected.flatMap(id => [undefined, String(entryId)].map(source => mutate(
        unstable_serialize((index, previous) => projectTimelineKey(id, true, source, index, previous)),
        undefined, { revalidate: false },
      ))));
      await mutate(key => Array.isArray(key) && (
        key[0] === "project" && key[2] === "timeline" && affected.includes(String(key[1]))
      ), undefined, { revalidate: false });
      void mutate(key => Array.isArray(key) && key[0] === "project" && key.length === 2 && affected.includes(String(key[1]))).catch(() => {});
      void revalidateProjectLists(cache).catch(() => {});
      void mutate(key => Array.isArray(key) && key[0] === "home").catch(() => {});
      return result;
    });
}
