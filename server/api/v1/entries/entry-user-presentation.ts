import type { PrismaClient } from "@prisma/client"
import { identityImageUrls } from "../uploads/identity-images"
import type { MembershipMap, EntryUser } from "./entries.types"

export async function entryMembershipMap(database: Pick<PrismaClient, "roomMembership" | "$queryRaw">, communityId: number | null | undefined, userIds: number[]): Promise<MembershipMap> {
  if (!communityId || userIds.length === 0) return new Map()

  const memberships = await database.roomMembership.findMany({
    where: { room_id: Number(communityId ?? 0) ?? Number(0), user_id: { in: userIds.map((id) => Number(id ?? 0) ?? Number(0)) }, disabled: false },
    include: { user: true },
  })

  const avatarMap = await identityImageUrls(database, "User", memberships.map(membership => membership.user_id))

  const map: MembershipMap = new Map()
  memberships.forEach((membership) => {
    map.set(`${membership.user_id}:${communityId}`, {
      displayUsername: membership.username_override || membership.user.username,
      displayAvatarUrl: avatarMap.get(membership.user_id) ?? null,
    })
  })

  return map
}

export function serializeEntryUser(user: { id: number; username: string }, membership?: { displayUsername: string; displayAvatarUrl: string | null }): EntryUser {
  return {
    id: Number(user.id ?? 0),
    username: user.username,
    avatar_url: null,
    display_username: membership?.displayUsername ?? user.username,
    display_avatar_url: membership?.displayAvatarUrl ?? null,
  }
}

