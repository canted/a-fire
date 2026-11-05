import type { RoomPorosity } from "./rooms.types"

export function porosityLabel(value?: string | null): "Open" | "Visit only" | "Knock only" {
  if (value === "masked") return "Visit only"
  if (value === "closed") return "Knock only"
  return "Open"
}

export function serializePorosity(value?: string | null): RoomPorosity {
  if (value === "masked" || value === "closed") return value
  return "open"
}

export function cleanName(value: string | null | undefined) {
  const name = value?.trim()
  return name || null
}
