// Keep system entries separate and group only adjacent messages by one author.
export function groupChatAuthors<T>(entries: T[], authorOf: (entry: T) => string | number | undefined): T[][] {
  const groups: T[][] = [];
  entries.forEach((entry, index) => {
    const author = authorOf(entry);
    if (index > 0 && author !== undefined && author === authorOf(entries[index - 1])) {
      groups[groups.length - 1].push(entry);
    } else {
      groups.push([entry]);
    }
  });
  return groups;
}

export type VirtualMessageGroup<T> = { key: string; ids: string[]; entries: T[]; continuation: boolean; continues: boolean };
/** Persistent numeric ID buckets bound even a single author's long run to eight
 * messages, without shifting all chunk boundaries on prepend or append. */
export function virtualMessageGroups<T>(entries: T[], idOf: (entry: T) => string, authorOf: (entry: T) => string | number | undefined): VirtualMessageGroup<T>[] {
  const groups = groupChatAuthors(entries, entry => {
    const author = authorOf(entry);
    if (author === undefined) return undefined;
    const id = idOf(entry);
    const numeric = id.match(/(?:^|-)(\d+)$/)?.[1];
    return entries.length <= 48 ? `${typeof author}:${author}` : `${typeof author}:${author}:${numeric ? Math.floor(Number(numeric) / 8) : id}`;
  });
  return groups.map((group, index) => ({
    key: idOf(group[0]), ids: group.map(idOf), entries: group,
    continuation: index > 0 && authorOf(group[0]) !== undefined && authorOf(group[0]) === authorOf(groups[index - 1].at(-1)!),
    continues: index < groups.length - 1 && authorOf(group[0]) !== undefined && authorOf(group.at(-1)!) === authorOf(groups[index + 1][0]),
  }));
}
