import useSWRInfinite from "swr/infinite";
import { fetchProjectCopyPage, type ProjectCopyPage, fetchProjectEntryPage, type ProjectEntryPage } from "../lib/api/projectEntries";
import { projectCopyKey, projectCopies, projectTimelineEntries, projectTimelineKey } from "../lib/projectTimeline";
import { client } from "../lib/api";

export function useProjectTimeline(project: string, allowed: boolean, entry?: string) {
  const query = useSWRInfinite(
    (index: number, previous: ProjectEntryPage | null) => projectTimelineKey(project, allowed, entry, index, previous),
    ([, id, , source, cursor]: readonly [string, string, string, string | null, string | null]) => fetchProjectEntryPage(client, id, cursor, source ?? undefined),
    { revalidateAll: true, revalidateOnMount: true, refreshInterval: 15000 },
  );
  return { query, entries: projectTimelineEntries(query.data, allowed && !query.error), hasMore: Boolean(allowed && !query.error && query.data?.at(-1)?.nextCursor) };
}

export function useProjectCopies(project: string, entry: string | undefined, allowed: boolean) {
  const query = useSWRInfinite(
    (index: number, previous: ProjectCopyPage | null) => projectCopyKey(project, entry, allowed, index, previous),
    ([, id, , source, cursor]: readonly [string, string, string, string, string | null]) => fetchProjectCopyPage(client, id, source, cursor),
    { revalidateAll: true, revalidateOnMount: true, refreshInterval: 15000 },
  );
  return { query, submissions: projectCopies(query.data, allowed && !query.error), hasMore: Boolean(allowed && !query.error && query.data?.at(-1)?.nextCursor) };
}
