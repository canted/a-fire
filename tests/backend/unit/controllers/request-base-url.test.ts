import type { Request } from "express"
import { describe, expect, it } from "vitest"
import { getRequestBaseUrl } from "@server/api/request-base-url"

function makeRequest(protocol: string, headers: Record<string, string | undefined>): Request {
  return {
    protocol,
    get: (name: string) => headers[name.toLowerCase()],
  } as Request
}

describe("getRequestBaseUrl", () => {
  it("uses forwarded https protocol behind a proxy", () => {
    const request = makeRequest("http", {
      host: "afire.app",
      "x-forwarded-proto": "https",
    })

    expect(getRequestBaseUrl(request)).toBe("https://afire.app")
  })

  it("uses forwarded host when provided", () => {
    const request = makeRequest("http", {
      host: "internal.fly.dev",
      "x-forwarded-host": "afire.app",
      "x-forwarded-proto": "https",
    })

    expect(getRequestBaseUrl(request)).toBe("https://afire.app")
  })
})
