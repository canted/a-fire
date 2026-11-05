import type { ProjectEntryPage, ProjectCopyPage } from "./api/projectEntries";

/** Project-prefix keys share mutation/revocation invalidation with Project detail. */
export function projectTimelineKey(project: string, allowed: boolean, entry: string | undefined, index: number, previous: ProjectEntryPage | null) {
  return !allowed || (index > 0 && !previous?.nextCursor) ? null
    : ["project", project, "timeline", entry ?? null, index ? previous!.nextCursor : null] as const;
}

export function projectTimelineEntries(pages: ProjectEntryPage[] | undefined, allowed: boolean) {
  return allowed ? [...new Map((pages ?? []).flatMap(page => page.entries).map(entry => [entry.id, entry])).values()] : [];
}

export function projectCopyKey(project: string, entry: string | undefined, allowed: boolean, index: number, previous: ProjectCopyPage | null) {
  return !allowed || !entry || (index > 0 && !previous?.nextCursor) ? null
    : ["project", project, "copies", entry, index ? previous!.nextCursor : null] as const;
}

export function projectCopies(pages: ProjectCopyPage[] | undefined, allowed: boolean) {
  return allowed ? [...new Map((pages ?? []).flatMap(page => page.submissions).map(copy => [copy.id, copy])).values()] : [];
}

/** Attach retained replies only when their exact shared copy is present in this page set. */
export function projectTimelineGroups(entries: ProjectEntryPage["entries"]) {
  const children = new Map<number, ProjectEntryPage["entries"]>();
  const sources = new Map(entries.filter(entry => entry.kind === "material").map(entry => [entry.id, entry]));
  const attached = new Set<number>();
  for (const reply of entries) {
    if (reply.kind !== "feedback" || !reply.source_entry_id || !reply.source_shared_entry_id) continue;
    const source = sources.get(reply.source_entry_id);
    if (!source?.submissions.some(copy => copy.id === reply.source_shared_entry_id)) continue;
    children.set(source.id, [...(children.get(source.id) ?? []), reply]);
    attached.add(reply.id);
  }
  return entries.filter(entry => !attached.has(entry.id)).map(entry => ({ entry, savedReplies: children.get(entry.id) ?? [] }));
}
