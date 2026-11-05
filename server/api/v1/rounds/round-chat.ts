import { roundRoomId } from "./round-scope"
import { Prisma } from "@prisma/client"

const NEVER_EXPIRES = new Date("9999-12-31T00:00:00Z")
export type RoundChatCard = {
  wall_id?: number;
  id: number; name: string; description: string | null;
  status: string; completed: boolean; submitted_count: number; participant_count: number;
  occurred_at: string; event_label: string;
}

/** Durable, retry-safe milestones; plugin state determines when phases are reached. */
export async function syncRoundChat(prisma: Pick<Prisma.TransactionClient, "round" | "chatMessage">, activityId: number, now = new Date(), phase?: { at: Date | null; label: string }) {
  const activity = await prisma.round.findUnique({ where: { id: activityId }, include: {
    _count: { select: { participations: { where: { role: "participant", status: "active" } }, submission_records: { where: { superseded_at: null } } } },
  } })
  if (!activity || activity.status === "cancelled") return []
  const circleId = roundRoomId(activity)
  if (!circleId) return []
  const messages: Array<{ id: number; room_id: number }> = []
  const events: Array<[string, string, Date | null]> = [
    ["created", "Round created", activity.created_at],
    ["started", "Round started", activity.status !== "draft" ? activity.started_at : null],
    ["next-phase", phase?.label ?? "Feedback started", activity.status !== "draft" ? (phase ? phase.at : activity.submit_by) : null],
  ]
  for (const [key, label, at] of events) {
    if (!at || at > now || (activity.closed_at && at > activity.closed_at)) continue
    const card: RoundChatCard = {
      id: activity.id, name: activity.name,
      description: activity.prompt,
      status: key === "created" ? "draft" : "active",
      completed: false, submitted_count: activity._count.submission_records,
      participant_count: activity._count.participations, occurred_at: at.toISOString(), event_label: label,
    }
    const where = { author_id_client_nonce: { author_id: activity.host_id, client_nonce: `round:${activity.id}:${key}` } }
    const message = await prisma.chatMessage.upsert({
      where,
      update: {},
      create: {
        room_id: circleId, author_id: activity.host_id, timeline_kind: "round_event",
        client_nonce: `round:${activity.id}:${key}`, body: `${label}: ${activity.name}`,
        content: { round_event: card }, masked_alias: "", fire_at: NEVER_EXPIRES, expires_at: NEVER_EXPIRES,
        created_at: at, updated_at: at,
      },
    }).catch(async error => {
      // Empty-update upserts can race in Prisma. The unique key is the durable
      // arbiter when a worker and an HTTP completion run concurrently.
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error
      return prisma.chatMessage.findUniqueOrThrow({ where })
    })
    messages.push(message)
  }
  return messages
}
