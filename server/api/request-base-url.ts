import type { Request } from "express"

type HeaderValue = string | string[] | undefined

export function getRequestBaseUrl(request: Request): string {
  const forwardedProto = firstHeaderValue(request.get("x-forwarded-proto"))
  const forwardedHost = firstHeaderValue(request.get("x-forwarded-host"))
  const protocol = forwardedProto || request.protocol
  const host = forwardedHost || request.get("host")

  return `${protocol}://${host}`
}

function firstHeaderValue(value: HeaderValue): string | undefined {
  const first = Array.isArray(value) ? value[0] : value
  const normalized = first?.split(",")[0]?.trim()
  return normalized || undefined
}
