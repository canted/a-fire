import type { Prisma } from "@prisma/client"

/** Reminder completion is one published reply to a submitted Entry, not a reply count. */
export async function completedFeedbackUsers(
  database: Pick<Prisma.TransactionClient, "reply">,
  postIds: number[],
  eligibleUserIds: number[],
): Promise<Set<number>> {
  if (!postIds.length || !eligibleUserIds.length) return new Set()
  const users = await database.reply.groupBy({
    by: ["user_id"],
    where: { entry_id: { in: postIds }, user_id: { in: eligibleUserIds }, status: "published" },
  })
  return new Set(users.flatMap(user => user.user_id === null ? [] : [user.user_id]))
}
