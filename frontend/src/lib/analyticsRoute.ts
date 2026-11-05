/** Route templates only: invite tokens and unknown paths never enter analytics. */
const routes = ["/app/agent-connections", "/app/notification-preferences", "/app/projects/new", "/app/new-entry", "/app/rooms/all", "/app/rooms/new", "/app/activity", "/app/projects", "/app/user/new", "/app/notices", "/app/profile", "/auth/verify", "/auth", "/app", "/", "/app/projects/[projectId]/entries/[entryId]/media/[mediaIndex]", "/app/rooms/[roomId]/members/[memberUserId]/introductions", "/app/rooms/[roomId]/chat/messages/[messageId]/save", "/app/projects/[projectId]/entries/[entryId]/share", "/app/projects/[projectId]/entries/[entryId]/edit", "/app/rooms/[roomId]/chat/messages/[messageId]", "/app/projects/[projectId]/entries/[entryId]", "/app/rooms/[roomId]/members/[memberUserId]", "/app/rooms/[roomId]/first-entry-prompt", "/app/projects/[projectId]/entries/new", "/app/rooms/[roomId]/adjacent-rooms", "/app/rooms/[roomId]/participation", "/app/rooms/[roomId]/round-history", "/app/entries/[entryId]/new-reply", "/app/note/[pageId]/audio-reply", "/app/entries/[entryId]/project", "/app/projects/[projectId]/edit", "/app/rooms/[roomId]/rounds/new", "/app/rooms/[roomId]/new-entry", "/app/rooms/[roomId]/notes/new", "/app/rooms/[roomId]/settings", "/app/rooms/[roomId]/invites", "/app/rooms/[roomId]/profile", "/app/rooms/[roomId]/history", "/app/rounds/[roundId]/edit", "/app/rooms/[roomId]/rounds", "/app/projects/[projectId]", "/app/rooms/[roomId]/notes", "/app/rooms/[roomId]/chat", "/app/entries/[entryId]", "/app/rounds/[roundId]", "/auth/invite/[token]", "/app/rooms/[roomId]", "/app/note/[pageId]"] as const;
const orderedRoutes = [...routes].sort((a, b) => {
  const left = a.split('/'); const right = b.split('/');
  for (let i = 0; i < Math.min(left.length, right.length); i++) {
    const difference = Number(left[i].startsWith('[')) - Number(right[i].startsWith('['));
    if (difference) return difference;
  }
  return 0;
});
export function analyticsRoute(path: string): { route_name: string; project_id?: number; entry_id?: number; room_id?: number; round_id?: number } {
  const parts = path.split(/[?#]/)[0].split('/').filter(Boolean);
  for (const route of orderedRoutes) {
    const pattern = route.split('/').filter(Boolean);
    if (pattern.length !== parts.length) continue;
    if (!pattern.every((part, i) => part.startsWith('[') || part === parts[i])) continue;
    const result: ReturnType<typeof analyticsRoute> = { route_name: route };
    pattern.forEach((part, i) => {
      const key = ({ '[projectId]': 'project_id', '[entryId]': 'entry_id', '[roomId]': 'room_id', '[roundId]': 'round_id' } as const)[part as '[projectId]'];
      if (key && /^\d+$/.test(parts[i]) && Number.isSafeInteger(Number(parts[i]))) result[key] = Number(parts[i]);
    });
    return result;
  }
  return { route_name: 'unknown' };
}
