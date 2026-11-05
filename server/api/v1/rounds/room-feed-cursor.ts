import { BadRequestException } from "@nestjs/common"

export type RoomFeedCursor = { room: number; at: string; kind: number; id: number; user?: number }

export function parseRoomFeedCursor(value: string | undefined, room: number, kinds: number[], user?: number): RoomFeedCursor | null {
  if (value === undefined) return null
  try {
    if (value.length > 512 || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error()
    const cursor = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as RoomFeedCursor
    if (cursor.room !== room || !kinds.includes(cursor.kind) || cursor.user !== user || !Number.isSafeInteger(cursor.id) || cursor.id < 1
      || typeof cursor.at !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(cursor.at)
      || !Number.isFinite(Date.parse(cursor.at))
      || new Date(cursor.at).toISOString().slice(0, 23) !== cursor.at.slice(0, 23)) throw new Error()
    return cursor
  } catch { throw new BadRequestException("Invalid Room feed cursor") }
}

