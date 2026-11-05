import type { EntryShowResponse, Reply } from "./api/entries";

function replyKey(reply: Reply): string {
  return String(reply.id);
}

function replyTime(reply: Reply): number {
  const raw = reply.published_at ?? reply.created_at;
  if (!raw) return 0;

  const parsed = Date.parse(raw);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function replyIdNumber(reply: Reply): number {
  const parsed = Number(reply.id);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function normalizeReplyForCache(reply: Reply): Reply {
  return {
    ...reply,
    content: reply.content,
    reflections: Array.isArray(reply.reflections) ? reply.reflections : [],
  };
}

export function sortRepliesForDisplay(replies: Reply[]): Reply[] {
  return [...replies].sort((left, right) => {
    const timeDiff = replyTime(left) - replyTime(right);
    if (timeDiff !== 0) return timeDiff;

    const idDiff = replyIdNumber(left) - replyIdNumber(right);
    if (idDiff !== 0) return idDiff;

    return replyKey(left).localeCompare(replyKey(right));
  });
}

export function mergeRepliesForCache(
  currentReplies: Reply[],
  incoming: Reply | Reply[],
): { replies: Reply[]; addedReplyIds: string[] } {
  const incomingReplies = Array.isArray(incoming) ? incoming : [incoming];
  const currentIds = new Set(currentReplies.map(replyKey));
  const repliesById = new Map<string, Reply>();

  currentReplies.forEach((reply) => {
    repliesById.set(replyKey(reply), normalizeReplyForCache(reply));
  });
  incomingReplies.forEach((reply) => {
    repliesById.set(replyKey(reply), normalizeReplyForCache(reply));
  });

  return {
    replies: sortRepliesForDisplay(Array.from(repliesById.values())),
    addedReplyIds: incomingReplies.map(replyKey).filter((id) => !currentIds.has(id)),
  };
}

export function mergeReplyIntoPostResponse(
  current: EntryShowResponse | undefined,
  incoming: Reply | Reply[],
): { response: EntryShowResponse | undefined; addedReplyIds: string[] } {
  if (!current) return { response: current, addedReplyIds: [] };

  const merged = mergeRepliesForCache(current.replies.data, incoming);
  return {
    response: {
      ...current,
      replies: {
        ...current.replies,
        data: merged.replies,
      },
    },
    addedReplyIds: merged.addedReplyIds,
  };
}
